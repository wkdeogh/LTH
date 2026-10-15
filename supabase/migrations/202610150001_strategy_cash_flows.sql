begin;

create table if not exists public.strategy_cash_flows (
  id uuid primary key,
  strategy_id uuid not null references public.strategies(id) on delete cascade,
  requested_date date not null,
  amount numeric(18,4) not null check (amount <> 0),
  timing text not null check (timing in ('immediate','next_round')),
  status text not null check (status in ('pending','applied','cancelled')),
  applied_date date,
  applied_round_id uuid references public.completed_rounds(id) on delete set null,
  reference_price numeric(18,4),
  memo text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  cancelled_at timestamptz,
  check ((status='applied') = (applied_date is not null))
);
create index if not exists strategy_cash_flows_pending on public.strategy_cash_flows(strategy_id) where status='pending';
alter table public.strategy_adjustments drop constraint if exists strategy_adjustments_kind_check;
alter table public.strategy_adjustments add constraint strategy_adjustments_kind_check check (kind in ('baseline','correction','cash_flow'));

create or replace function public.record_strategy_cash_flow(
  p_strategy_id uuid,p_id uuid,p_expected_version bigint,p_date date,p_amount numeric,p_timing text,p_reference_price numeric,p_memo text
) returns void language plpgsql set search_path=public as $$
declare s public.strategies%rowtype; saved public.strategy_cash_flows%rowtype; after_row public.strategies%rowtype;
  last_date date; pending numeric; next_t numeric; next_mode text;
begin
  select * into s from public.strategies where id=p_strategy_id for update;
  if not found or s.is_archived then raise exception 'STRATEGY_NOT_ACTIVE'; end if;
  select * into saved from public.strategy_cash_flows where id=p_id;
  if found then
    if saved.strategy_id<>p_strategy_id or saved.requested_date<>p_date or saved.amount<>p_amount
      or saved.timing<>p_timing or saved.memo<>coalesce(p_memo,'') then raise exception 'REQUEST_CONFLICT'; end if;
    if saved.status='cancelled' then raise exception 'REQUEST_CANCELLED'; end if;
    return;
  end if;
  if s.version<>p_expected_version then raise exception 'STALE_STRATEGY'; end if;
  if p_amount is null or p_amount=0 or p_amount<>round(p_amount,4) or p_amount::text in ('NaN','Infinity','-Infinity')
    or p_timing is null or p_timing not in ('immediate','next_round') then raise exception 'INVALID_CASH_FLOW'; end if;
  select greatest(s.started_at,(select max(executed_at) from public.executions where strategy_id=s.id),
    (select max(effective_date) from public.strategy_adjustments where strategy_id=s.id),
    (select max(requested_date) from public.strategy_cash_flows where strategy_id=s.id)) into last_date;
  if p_date is null or p_date<last_date or p_date>(now() at time zone 'Asia/Seoul')::date then raise exception 'CASH_FLOW_DATE_ORDER'; end if;
  select coalesce(sum(amount),0) into pending from public.strategy_cash_flows where strategy_id=s.id and status='pending';
  if s.principal+p_amount+pending<=0 then raise exception 'INVALID_PRINCIPAL'; end if;
  if p_timing='immediate' then
    if s.principal+p_amount<=0 then raise exception 'INVALID_PRINCIPAL'; end if;
    if s.cash_balance+p_amount<0 then raise exception 'INSUFFICIENT_CASH'; end if;
    if s.position_qty>0 and (p_reference_price is null or p_reference_price<=0 or p_reference_price::text in ('NaN','Infinity','-Infinity')) then raise exception 'MISSING_REFERENCE_PRICE'; end if;
    next_t := case when s.position_qty=0 then 0 else round(s.split_count*s.position_qty*p_reference_price/(s.cash_balance+p_amount+s.position_qty*p_reference_price),10) end;
    next_mode := case when s.mode='normal' and next_t>s.split_count-1 and s.position_qty>0 then 'reverse' else s.mode end;
    update public.strategies set principal=principal+p_amount,cash_balance=cash_balance+p_amount,t_value=next_t,mode=next_mode,
      reverse_started_at=case when s.mode='normal' and next_mode='reverse' then p_date else s.reverse_started_at end,
      reverse_first_sell_done=case when s.mode='normal' and next_mode='reverse' then false else s.reverse_first_sell_done end
      where id=s.id returning * into after_row;
    insert into public.strategy_adjustments(id,strategy_id,effective_date,kind,before_state,after_state,reason)
      values(p_id,s.id,p_date,'cash_flow',to_jsonb(s),to_jsonb(after_row),coalesce(p_memo,''));
  else
    -- Increment the version so an order prepared before this reservation cannot miss it.
    update public.strategies set version=version where id=s.id;
  end if;
  insert into public.strategy_cash_flows(id,strategy_id,requested_date,amount,timing,status,applied_date,reference_price,memo)
    values(p_id,s.id,p_date,p_amount,p_timing,case when p_timing='immediate' then 'applied' else 'pending' end,
      case when p_timing='immediate' then p_date else null end,p_reference_price,coalesce(p_memo,''));
end;
$$;

create or replace function public.cancel_strategy_cash_flow(p_strategy_id uuid,p_id uuid,p_expected_version bigint)
returns void language plpgsql set search_path=public as $$
declare s public.strategies%rowtype; f public.strategy_cash_flows%rowtype;
begin
  select * into s from public.strategies where id=p_strategy_id for update;
  if not found or s.is_archived then raise exception 'STRATEGY_NOT_ACTIVE'; end if;
  select * into f from public.strategy_cash_flows where id=p_id and strategy_id=s.id for update;
  if f.status='cancelled' then return; end if;
  if s.version<>p_expected_version then raise exception 'STALE_STRATEGY'; end if;
  if f.id is null or f.status<>'pending' then raise exception 'CASH_FLOW_NOT_PENDING'; end if;
  if s.principal+(select coalesce(sum(amount),0) from public.strategy_cash_flows where strategy_id=s.id and status='pending' and id<>f.id)<=0 then
    raise exception 'INVALID_PRINCIPAL'; end if;
  update public.strategy_cash_flows set status='cancelled',cancelled_at=clock_timestamp() where id=f.id;
  update public.strategies set version=version where id=s.id;
end;
$$;

create or replace function public.commit_strategy_execution(
  p_strategy_id uuid, p_request_id uuid, p_expected_version bigint, p_input jsonb,
  p_executions jsonb, p_snapshots jsonb, p_final jsonb, p_round jsonb, p_result jsonb
) returns jsonb language plpgsql set search_path=public as $$
declare
  s public.strategies%rowtype; saved public.strategy_write_requests%rowtype;
  e jsonb; snap jsonb; eid uuid; rid uuid; trade_date date;
  pending numeric; before_flow jsonb;
  ordinal integer := 0; stamp timestamptz := clock_timestamp(); last_date date;
begin
  select * into s from public.strategies where id=p_strategy_id for update;
  if not found or s.is_archived then raise exception 'STRATEGY_NOT_ACTIVE'; end if;
  select * into saved from public.strategy_write_requests where id=p_request_id;
  if found then
    if saved.strategy_id<>p_strategy_id or saved.input<>p_input then raise exception 'REQUEST_CONFLICT'; end if;
    if saved.cancelled then raise exception 'REQUEST_CANCELLED'; end if;
    return saved.result;
  end if;
  if s.version<>p_expected_version then raise exception 'STALE_STRATEGY'; end if;
  if jsonb_array_length(p_executions) not between 1 and 2 or jsonb_array_length(p_executions)<>jsonb_array_length(p_snapshots) then
    raise exception 'INVALID_EXECUTION_BATCH';
  end if;
  trade_date := (p_executions->0->>'executed_at')::date;
  select greatest(
    (select max(executed_at) from public.executions where strategy_id=s.id),
    (select max(effective_date) from public.strategy_adjustments where strategy_id=s.id and kind in ('correction','cash_flow'))
    ,(select max(requested_date) from public.strategy_cash_flows where strategy_id=s.id and status<>'cancelled')
  ) into last_date;
  if trade_date < last_date then raise exception 'EXECUTION_DATE_ORDER'; end if;
  if trade_date > (now() at time zone 'America/New_York')::date or extract(isodow from trade_date) in (6,7) then
    raise exception 'INVALID_EXECUTION_DATE';
  end if;
  for e in select value from jsonb_array_elements(p_executions) loop
    if (e->>'executed_at')::date<>trade_date then raise exception 'INVALID_EXECUTION_BATCH'; end if;
    eid := (e->>'id')::uuid; snap := p_snapshots->ordinal;
    insert into public.strategy_snapshots(strategy_id,execution_id,snapshot_date,principal,mode,cash_balance,position_qty,avg_price,t_value,started_at,reverse_started_at,reverse_first_sell_done,note,created_at,after_cash_balance,after_position_qty)
    values(s.id,eid,trade_date,s.principal,s.mode,(snap->>'cash_balance')::numeric,(snap->>'position_qty')::integer,
      (snap->>'avg_price')::numeric,(snap->>'t_value')::numeric,s.started_at,s.reverse_started_at,s.reverse_first_sell_done,
      '체결 입력 전 상태',stamp+ordinal*interval '1 millisecond',(snap->>'after_cash_balance')::numeric,(snap->>'after_position_qty')::integer);
    insert into public.executions(id,strategy_id,executed_at,side,order_type,quantity,avg_execution_price,total_amount,t_effect,memo,created_at,request_id)
    values(eid,s.id,trade_date,e->>'side',e->>'order_type',(e->>'quantity')::integer,(e->>'avg_execution_price')::numeric,
      (e->>'total_amount')::numeric,e->>'t_effect',e->>'memo',stamp+ordinal*interval '1 millisecond',p_request_id);
    ordinal := ordinal+1;
  end loop;
  if p_round is not null and p_round<>'null'::jsonb then
    if (p_final->>'position_qty')::integer<>0 or p_executions->0->>'side'<>'sell' then raise exception 'INVALID_ROUND_CLOSE'; end if;
    insert into public.completed_rounds(strategy_id,round_number,symbol,split_count,started_at,ended_at,started_principal,ending_cash_balance,
      profit_amount,profit_rate,execution_count,buy_count,sell_count,total_buy_amount,total_sell_amount,ending_t_value)
    select s.id,coalesce((select max(round_number) from public.completed_rounds where strategy_id=s.id),0)+1,s.symbol,s.split_count,
      s.started_at,trade_date,s.principal,(p_final->>'cash_balance')::numeric,(p_round->>'profit_amount')::numeric,(p_round->>'profit_rate')::numeric,
      count(*),count(*) filter(where side='buy'),count(*) filter(where side='sell'),
      coalesce(sum(total_amount) filter(where side='buy'),0),coalesce(sum(total_amount) filter(where side='sell'),0),(p_round->>'ending_t_value')::numeric
    from public.executions where strategy_id=s.id and round_id is null and executed_at between s.started_at and trade_date
    returning id into rid;
    update public.executions set round_id=rid where strategy_id=s.id and round_id is null and executed_at between s.started_at and trade_date;
  end if;
  if rid is not null then
    select coalesce(sum(amount),0) into pending from public.strategy_cash_flows where strategy_id=s.id and status='pending';
    if (p_final->>'cash_balance')::numeric+pending<0 then raise exception 'INSUFFICIENT_CASH'; end if;
    if (p_final->>'principal')::numeric+pending<=0 then raise exception 'INVALID_PRINCIPAL'; end if;
    before_flow := to_jsonb(s) || p_final;
    p_final := p_final || jsonb_build_object('cash_balance',(p_final->>'cash_balance')::numeric+pending,'principal',(p_final->>'principal')::numeric+pending);
    if exists(select 1 from public.strategy_cash_flows where strategy_id=s.id and status='pending') then
      insert into public.strategy_adjustments(strategy_id,effective_date,kind,before_state,after_state,reason,created_at)
        values(s.id,trade_date,'cash_flow',before_flow,to_jsonb(s)||p_final,'다음 라운드 입출금 반영',stamp+interval '10 milliseconds');
      update public.strategy_cash_flows set status='applied',applied_date=trade_date,applied_round_id=rid
        where strategy_id=s.id and status='pending';
    end if;
  end if;
  if (p_final->>'cash_balance')::numeric<0 or (p_final->>'position_qty')::integer<0 or (p_final->>'avg_price')::numeric<0 or (p_final->>'t_value')::numeric<0 then
    raise exception 'INVALID_FINAL_STATE';
  end if;
  update public.strategies set principal=(p_final->>'principal')::numeric,cash_balance=(p_final->>'cash_balance')::numeric,
    position_qty=(p_final->>'position_qty')::integer,avg_price=(p_final->>'avg_price')::numeric,t_value=(p_final->>'t_value')::numeric,
    mode=p_final->>'mode',reverse_first_sell_done=(p_final->>'reverse_first_sell_done')::boolean,
    reverse_started_at=(p_final->>'reverse_started_at')::date,started_at=(p_final->>'started_at')::date where id=s.id;
  insert into public.strategy_write_requests(id,strategy_id,input,result) values(p_request_id,s.id,p_input,p_result);
  return p_result;
end;
$$;

create or replace function public.correct_strategy_state(p_strategy_id uuid,p_expected_version bigint,p_date date,p_state jsonb,p_reason text)
returns void language plpgsql set search_path=public as $$
declare s public.strategies%rowtype; after_row public.strategies%rowtype; last_date date;
begin
  select * into s from public.strategies where id=p_strategy_id for update;
  if not found or s.is_archived then raise exception 'STRATEGY_NOT_ACTIVE'; end if;
  if s.version<>p_expected_version then raise exception 'STALE_STRATEGY'; end if;
  select greatest((select max(executed_at) from public.executions where strategy_id=s.id),
    (select max(effective_date) from public.strategy_adjustments where strategy_id=s.id),
    (select max(requested_date) from public.strategy_cash_flows where strategy_id=s.id)) into last_date;
  if p_date is null or p_date<last_date or p_date>(now() at time zone 'Asia/Seoul')::date then raise exception 'CORRECTION_DATE_ORDER'; end if;
  if (p_state->>'principal')::numeric<=0 or (p_state->>'cash_balance')::numeric<0 or (p_state->>'position_qty')::integer<0
    or (p_state->>'avg_price')::numeric<0 or (p_state->>'t_value')::numeric<0 then raise exception 'INVALID_FINAL_STATE'; end if;
  if p_state->>'symbol'<>s.symbol and exists(select 1 from public.executions where strategy_id=s.id) then raise exception 'SYMBOL_HAS_HISTORY'; end if;
  if (p_state->>'principal')::numeric+(select coalesce(sum(amount),0) from public.strategy_cash_flows where strategy_id=s.id and status='pending')<=0 then raise exception 'INVALID_PRINCIPAL'; end if;
  update public.strategies set name=p_state->>'name',symbol=p_state->>'symbol',split_count=(p_state->>'split_count')::integer,
    principal=(p_state->>'principal')::numeric,cash_balance=(p_state->>'cash_balance')::numeric,position_qty=(p_state->>'position_qty')::integer,
    avg_price=(p_state->>'avg_price')::numeric,t_value=(p_state->>'t_value')::numeric,mode=p_state->>'mode',
    reverse_started_at=case when p_state->>'mode'='normal' then null when s.mode='normal' then p_date else s.reverse_started_at end,
    reverse_first_sell_done=case when p_state->>'mode'<>s.mode then false else s.reverse_first_sell_done end
    where id=s.id returning * into after_row;
  insert into public.strategy_adjustments(strategy_id,effective_date,kind,before_state,after_state,reason)
    values(s.id,p_date,'correction',to_jsonb(s),to_jsonb(after_row),coalesce(p_reason,''));
end;
$$;

create or replace function public.cancel_latest_execution(p_strategy_id uuid,p_execution_id uuid)
returns void language plpgsql set search_path=public as $$
declare s public.strategies%rowtype; e public.executions%rowtype; snap public.strategy_snapshots%rowtype;
  r public.completed_rounds%rowtype; ids uuid[];
begin
  select * into s from public.strategies where id=p_strategy_id for update;
  if not found or s.is_archived then raise exception 'STRATEGY_NOT_ACTIVE'; end if;
  select * into e from public.executions where strategy_id=s.id order by created_at desc,id desc limit 1;
  if e.id is null or e.id<>p_execution_id then raise exception '가장 최근에 입력한 체결만 취소할 수 있습니다.'; end if;
  if exists(select 1 from public.strategy_adjustments where strategy_id=s.id and kind in ('correction','cash_flow') and created_at>e.created_at
    and not (kind='cash_flow' and reason='다음 라운드 입출금 반영' and effective_date=e.executed_at and e.round_id is not null)) then
    raise exception '상태 보정 이후에는 이전 체결을 취소할 수 없습니다.';
  end if;
  if exists(select 1 from public.strategy_cash_flows where strategy_id=s.id and greatest(created_at,cancelled_at)>e.created_at) then
    raise exception '입출금 기록 이후에는 이전 체결을 취소할 수 없습니다.';
  end if;
  select array_agg(id order by created_at,id) into ids from public.executions
    where strategy_id=s.id and (id=e.id or (e.request_id is not null and request_id=e.request_id));
  select * into snap from public.strategy_snapshots where execution_id=ids[1] limit 1;
  if snap.id is null then
    select * into snap from public.strategy_snapshots where strategy_id=s.id and created_at<=e.created_at order by created_at desc,id desc limit 1;
  end if;
  if snap.id is null or e.created_at-snap.created_at>interval '5 minutes' then raise exception '체결 직전 상태를 찾을 수 없습니다.'; end if;
  if snap.mode='reverse' and coalesce(snap.reverse_started_at,s.reverse_started_at) is null then raise exception '리버스 시작일을 확인할 수 없습니다.'; end if;
  if e.round_id is not null then
    select * into r from public.completed_rounds where id=e.round_id and strategy_id=s.id for update;
    if r.id is null or e.side<>'sell' or r.ended_at<>e.executed_at then raise exception '라운드 종료 상태를 확인할 수 없습니다.'; end if;
    if exists(select 1 from public.strategy_cash_flows where applied_round_id=r.id) then
      delete from public.strategy_adjustments where strategy_id=s.id and kind='cash_flow'
        and reason='다음 라운드 입출금 반영' and effective_date=e.executed_at and created_at>e.created_at;
      update public.strategy_cash_flows set status='pending',applied_date=null,applied_round_id=null where applied_round_id=r.id;
    end if;
    delete from public.completed_rounds where id=r.id;
  end if;
  delete from public.executions where id=any(ids);
  update public.strategies set principal=coalesce(snap.principal,r.started_principal,s.principal),cash_balance=snap.cash_balance,
    position_qty=snap.position_qty,avg_price=snap.avg_price,t_value=snap.t_value,mode=snap.mode,
    reverse_started_at=case when snap.mode='normal' then null else coalesce(snap.reverse_started_at,s.reverse_started_at) end,
    reverse_first_sell_done=coalesce(snap.reverse_first_sell_done,false),started_at=coalesce(snap.started_at,s.started_at) where id=s.id;
  update public.strategy_adjustments set effective_date=coalesce((select max(executed_at) from public.executions where strategy_id=s.id),snap.started_at,s.started_at),
    before_state=(select to_jsonb(restored) from public.strategies restored where id=s.id),
    after_state=(select to_jsonb(restored) from public.strategies restored where id=s.id)
    where strategy_id=s.id and kind='baseline' and created_at>e.created_at;
  delete from public.strategy_snapshots where execution_id=any(ids) or id=snap.id;
  update public.strategy_write_requests set cancelled=true where id=e.request_id;
end;
$$;


alter table public.strategy_cash_flows enable row level security;
revoke all on public.strategy_cash_flows from public,anon,authenticated;
grant all on public.strategy_cash_flows to service_role;
revoke all on function public.record_strategy_cash_flow(uuid,uuid,bigint,date,numeric,text,numeric,text) from public;
revoke all on function public.cancel_strategy_cash_flow(uuid,uuid,bigint) from public;
grant execute on function public.record_strategy_cash_flow(uuid,uuid,bigint,date,numeric,text,numeric,text) to service_role;
grant execute on function public.cancel_strategy_cash_flow(uuid,uuid,bigint) to service_role;
notify pgrst,'reload schema';
commit;
