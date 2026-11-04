begin;

-- Cash reconciliation is a ledger adjustment, separate from round trading P/L.
alter table public.strategy_cash_flows add column if not exists source text not null default 'manual'
  check (source in ('manual','meritz_round','meritz_withdrawal'));

create or replace function public.sync_meritz_cash(p_strategy uuid,p_account text,p_version bigint,
  p_cash numeric,p_date date,p_source text,p_round uuid default null,p_reference_price numeric default null) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare s public.strategies%rowtype; delta numeric; capital numeric; next_t numeric;
  after_row public.strategies%rowtype; fid uuid:=gen_random_uuid(); next_mode text; last_date date; stamp timestamptz;
begin
  select * into s from public.strategies where id=p_strategy for update;
  if not found or s.is_archived then raise exception 'STRATEGY_NOT_ACTIVE'; end if;
  if s.version<>p_version then raise exception 'STALE_STRATEGY'; end if;
  if not exists(select 1 from public.meritz_links where strategy_id=s.id and account_key=p_account) then raise exception 'BROKER_ACCOUNT_MISMATCH'; end if;
  if p_cash is null or p_cash::text in ('NaN','Infinity','-Infinity') or p_cash<0 or p_cash<>round(p_cash,4)
    or p_date is null or p_date>(now() at time zone 'America/New_York')::date
    or p_source is null or p_source not in ('meritz_round','meritz_withdrawal') then raise exception 'INVALID_BROKER_CASH'; end if;
  select greatest((select max(executed_at) from public.executions where strategy_id=s.id),
    (select max(effective_date) from public.strategy_adjustments where strategy_id=s.id),
    (select max(requested_date) from public.strategy_cash_flows where strategy_id=s.id and status<>'cancelled')) into last_date;
  if p_date<last_date then raise exception 'CASH_FLOW_DATE_ORDER'; end if;
  if exists(select 1 from public.meritz_days where strategy_id=s.id and session_date<p_date and status in ('pending','review')) then
    raise exception 'BROKER_UNRECONCILED_DAYS'; end if;
  delta:=p_cash-s.cash_balance;
  if p_source='meritz_round' then
    if s.position_qty<>0 or p_round is null or p_round is distinct from
      (select id from public.completed_rounds where strategy_id=s.id order by round_number desc limit 1)
      or exists(select 1 from public.executions where strategy_id=s.id and round_id is null) then raise exception 'INVALID_ROUND_CASH_SYNC'; end if;
    capital:=case when s.compounding_type='compound' then p_cash else s.principal+delta end;
    next_t:=0;
  else
    if s.cash_balance<=0 or p_cash*100>s.cash_balance*95 then return jsonb_build_object('changed',false); end if;
    capital:=s.principal+delta;
    next_t:=case when s.position_qty=0 then 0 else round(s.t_value*s.principal/nullif(capital,0),10) end;
  end if;
  if capital<=0 or next_t is null or next_t<0 or capital+
    (select coalesce(sum(amount),0) from public.strategy_cash_flows where strategy_id=s.id and status='pending')<=0 then raise exception 'INVALID_PRINCIPAL'; end if;
  if delta=0 and capital=s.principal and next_t=s.t_value then return jsonb_build_object('changed',false); end if;
  next_mode:=case when s.mode='normal' and next_t>s.split_count-1 then 'reverse' else s.mode end;
  update public.strategies set cash_balance=p_cash,principal=capital,t_value=next_t,mode=next_mode,
    reverse_started_at=case when next_mode<>s.mode then p_date else s.reverse_started_at end,
    reverse_first_sell_done=case when next_mode<>s.mode then false else s.reverse_first_sell_done end
    where id=s.id returning * into after_row;
  if delta<>0 then
    -- Execution batches and pending flows have ordered future millisecond stamps.
    -- Keep this adjustment strictly after them for chart replay and undo guards.
    select greatest(clock_timestamp(),
      (select max(created_at)+interval '1 millisecond' from public.executions where strategy_id=s.id),
      (select max(created_at)+interval '1 millisecond' from public.strategy_adjustments where strategy_id=s.id)) into stamp;
    insert into public.strategy_cash_flows(id,strategy_id,requested_date,amount,timing,status,applied_date,reference_price,memo,source,created_at)
      values(fid,s.id,p_date,delta,'immediate','applied',p_date,coalesce(p_reference_price,s.avg_price),
        case when p_source='meritz_round' then '라운드 종료 후 현금 증감 · 메리츠 예수금 반영' else '주문 전 5% 이상 현금 감소 · 예수금 차액 반영' end,p_source,stamp);
    insert into public.strategy_adjustments(id,strategy_id,effective_date,kind,before_state,after_state,reason,created_at)
      values(fid,s.id,p_date,'cash_flow',to_jsonb(s),to_jsonb(after_row),
        case when p_source='meritz_round' then '라운드 종료 후 현금 증감 · 메리츠 예수금 반영' else '주문 전 현금 감소 · 원금과 T 재산정' end,stamp);
  end if;
  return jsonb_build_object('changed',true,'amount',delta,'round_id',p_round);
end;
$$;
revoke all on function public.sync_meritz_cash(uuid,text,bigint,numeric,date,text,uuid,numeric) from public,anon,authenticated;
grant execute on function public.sync_meritz_cash(uuid,text,bigint,numeric,date,text,uuid,numeric) to service_role;

create or replace function public.commit_meritz_day(p_day uuid,p_account text,p_version bigint,p_fills jsonb,
  p_executions jsonb,p_snapshots jsonb,p_final jsonb,p_round jsonb) returns jsonb
language plpgsql set search_path=public as $$
declare d public.meritz_days%rowtype; f jsonb; result jsonb; s public.strategies%rowtype; rid uuid;
begin
  select * into d from public.meritz_days where id=p_day for update;
  if not found then raise exception 'BROKER_DAY_NOT_FOUND'; end if;
  if not exists(select 1 from public.meritz_links where strategy_id=d.strategy_id and account_key=p_account) then
    raise exception 'BROKER_ACCOUNT_MISMATCH';
  end if;
  if d.status in ('applied','matched') then
    if d.broker_fills<>p_fills then raise exception 'BROKER_FILL_CHANGED'; end if;
    return jsonb_build_object('already_applied',true);
  end if;
  if jsonb_array_length(p_fills)=0 then raise exception 'BROKER_FILLS_EMPTY'; end if;
  for f in select value from jsonb_array_elements(p_fills) loop
    insert into public.meritz_fill_claims(account_key,order_date,order_no,fill_no,day_id)
    values(p_account,f->>'orderDate',f->>'orderNo',f->>'fillNo',p_day);
  end loop;
  result:=public.commit_strategy_execution(d.strategy_id,p_day,p_version,
    jsonb_build_object('source','meritz','fills',p_fills),p_executions,p_snapshots,p_final,p_round,
    jsonb_build_object('path','/strategies/'||d.strategy_id,'notice','execution-saved'));
  if p_round is not null and p_round<>'null'::jsonb and p_final ? 'broker_cash' then
    select * into s from public.strategies where id=d.strategy_id;
    select id into rid from public.completed_rounds where strategy_id=s.id order by round_number desc limit 1;
    -- The execution commit has already applied pending manual flows. Compare
    -- against that result so the same bank deposit is never added twice.
    -- Mark this day before syncing; the transaction rolls everything back on error.
    update public.meritz_days set status='applied' where id=p_day;
    perform public.sync_meritz_cash(s.id,p_account,s.version,(p_final->'broker_cash'->>'amount')::numeric,
      (p_final->'broker_cash'->>'date')::date,'meritz_round',rid);
  end if;
  update public.meritz_days set status='applied',broker_fills=p_fills,error=null where id=p_day;
  return result;
end;
$$;


-- Matching manually saved executions and refreshing a closed round are atomic.
create or replace function public.match_meritz_day(p_day uuid,p_account text,p_version bigint,p_fills jsonb,p_cash numeric default null)
returns void language plpgsql security invoker set search_path=public as $$
declare d public.meritz_days%rowtype; s public.strategies%rowtype; rid uuid;
begin
  select * into d from public.meritz_days where id=p_day for update;
  if not found then raise exception 'BROKER_DAY_NOT_FOUND'; end if;
  select * into s from public.strategies where id=d.strategy_id for update;
  if s.version<>p_version then raise exception 'STALE_STRATEGY'; end if;
  if not exists(select 1 from public.meritz_links where strategy_id=s.id and account_key=p_account) then raise exception 'BROKER_ACCOUNT_MISMATCH'; end if;
  if d.status in ('applied','matched') then
    if d.broker_fills<>p_fills then raise exception 'BROKER_FILL_CHANGED'; end if;
    return;
  end if;
  update public.meritz_days set status='matched',broker_fills=p_fills,error=null where id=p_day;
  if p_cash is not null then
    select id into rid from public.completed_rounds where strategy_id=s.id and ended_at=d.session_date order by round_number desc limit 1;
    perform public.sync_meritz_cash(s.id,p_account,s.version,p_cash,(now() at time zone 'America/New_York')::date,'meritz_round',rid);
  end if;
end;
$$;
revoke all on function public.match_meritz_day(uuid,text,bigint,jsonb,numeric) from public,anon,authenticated;
grant execute on function public.match_meritz_day(uuid,text,bigint,jsonb,numeric) to service_role;

commit;
