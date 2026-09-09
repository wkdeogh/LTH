begin;
alter table public.strategies add column if not exists version bigint not null default 0;
alter table public.strategy_snapshots add column if not exists after_cash_balance numeric(18,4);
alter table public.strategy_snapshots add column if not exists after_position_qty integer;
alter table public.executions add column if not exists request_id uuid;

create table if not exists public.strategy_write_requests (
  id uuid primary key,
  strategy_id uuid not null references public.strategies(id) on delete cascade,
  input jsonb not null,
  result jsonb not null,
  cancelled boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.strategy_adjustments (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategies(id) on delete cascade,
  effective_date date not null,
  kind text not null check (kind in ('baseline','correction')),
  before_state jsonb not null,
  after_state jsonb not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists strategy_one_baseline on public.strategy_adjustments(strategy_id) where kind='baseline';
create index if not exists strategy_adjustments_date on public.strategy_adjustments(strategy_id,effective_date,created_at);

insert into public.strategy_adjustments(strategy_id,effective_date,kind,before_state,after_state)
select s.id, coalesce((select max(executed_at) from public.executions where strategy_id=s.id), s.started_at),
  'baseline', to_jsonb(s), to_jsonb(s) from public.strategies s
where not exists(select 1 from public.strategy_adjustments a where a.strategy_id=s.id)
  and exists(select 1 from public.executions where strategy_id=s.id)
  and (select id from public.executions where strategy_id=s.id order by executed_at desc,created_at desc,id desc limit 1)
    = (select id from public.executions where strategy_id=s.id order by created_at desc,id desc limit 1);

create or replace function public.bump_strategy_version() returns trigger language plpgsql set search_path=public as $$
begin new.version := old.version + 1; new.updated_at := clock_timestamp(); return new; end;
$$;
drop trigger if exists strategies_version on public.strategies;
create trigger strategies_version before update on public.strategies for each row execute function public.bump_strategy_version();

create or replace function public.commit_strategy_execution(
  p_strategy_id uuid, p_request_id uuid, p_expected_version bigint, p_input jsonb,
  p_executions jsonb, p_snapshots jsonb, p_final jsonb, p_round jsonb, p_result jsonb
) returns jsonb language plpgsql set search_path=public as $$
declare
  s public.strategies%rowtype; saved public.strategy_write_requests%rowtype;
  e jsonb; snap jsonb; eid uuid; rid uuid; trade_date date;
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
    (select max(effective_date) from public.strategy_adjustments where strategy_id=s.id and kind='correction')
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
    (select max(effective_date) from public.strategy_adjustments where strategy_id=s.id)) into last_date;
  if p_date is null or p_date<last_date or p_date>(now() at time zone 'Asia/Seoul')::date then raise exception 'CORRECTION_DATE_ORDER'; end if;
  if (p_state->>'principal')::numeric<=0 or (p_state->>'cash_balance')::numeric<0 or (p_state->>'position_qty')::integer<0
    or (p_state->>'avg_price')::numeric<0 or (p_state->>'t_value')::numeric<0 then raise exception 'INVALID_FINAL_STATE'; end if;
  if p_state->>'symbol'<>s.symbol and exists(select 1 from public.executions where strategy_id=s.id) then raise exception 'SYMBOL_HAS_HISTORY'; end if;
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
  if exists(select 1 from public.strategy_adjustments where strategy_id=s.id and kind='correction' and created_at>e.created_at) then
    raise exception '상태 보정 이후에는 이전 체결을 취소할 수 없습니다.';
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

alter table public.strategy_write_requests enable row level security;
alter table public.strategy_adjustments enable row level security;
revoke all on public.strategy_write_requests,public.strategy_adjustments from public,anon,authenticated;
grant all on public.strategy_write_requests,public.strategy_adjustments to service_role;
revoke all on function public.bump_strategy_version() from public;
revoke all on function public.commit_strategy_execution(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public;
revoke all on function public.correct_strategy_state(uuid,bigint,date,jsonb,text) from public;
revoke all on function public.cancel_latest_execution(uuid,uuid) from public;
grant execute on function public.commit_strategy_execution(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.correct_strategy_state(uuid,bigint,date,jsonb,text) to service_role;
grant execute on function public.cancel_latest_execution(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
