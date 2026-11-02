-- Additive only: existing strategies, cash and executions are not changed.
create table public.meritz_links (
  strategy_id uuid primary key references public.strategies(id) on delete cascade,
  account_key text not null,
  symbol text not null check(symbol in ('SOXL','TQQQ')),
  auto_enabled boolean not null default false,
  active_from date,
  sync_from date not null,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique(account_key,symbol)
);
create table public.meritz_days (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategies(id) on delete cascade,
  session_date date not null,
  baseline jsonb not null,
  guide jsonb not null,
  quote_price numeric(18,4),
  quote_received_at timestamptz,
  status text not null default 'pending' check(status in ('pending','applied','matched','empty','review')),
  broker_fills jsonb,
  error text,
  created_at timestamptz not null default now(),
  unique(strategy_id,session_date)
);
create table public.meritz_runs (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategies(id) on delete cascade,
  account_key text not null,
  session_date date not null,
  source text not null check(source in ('manual','auto')),
  status text not null default 'prepared' check(status in ('prepared','submitting','accepted','partial','rejected','unknown','expired')),
  snapshot jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(strategy_id,session_date)
);
create table public.meritz_orders (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.meritz_runs(id) on delete cascade,
  account_key text not null,
  order_key text not null,
  body jsonb not null,
  guide_order jsonb not null,
  status text not null default 'planned' check(status in ('planned','submitting','accepted','rejected','unknown','cancelled')),
  broker_order_no text,
  broker_order_date text,
  attempted_at timestamptz,
  response jsonb,
  unique(run_id,order_key)
);
create unique index meritz_order_identity on public.meritz_orders(account_key,broker_order_date,broker_order_no)
  where broker_order_date is not null and broker_order_no is not null;
create table public.meritz_fill_claims (
  account_key text not null,
  order_date text not null,
  order_no text not null,
  fill_no text not null,
  day_id uuid not null references public.meritz_days(id) on delete cascade,
  primary key(account_key,order_date,order_no,fill_no)
);
create table public.meritz_locks (
  account_key text primary key,
  owner uuid not null,
  expires_at timestamptz not null,
  next_call_at timestamptz not null default now()
);
create table public.broker_notifications (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  strategy_id uuid references public.strategies(id) on delete cascade,
  title text not null,
  body text not null,
  tone text not null check(tone in ('success','warning','info')),
  read_at timestamptz,
  push_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.broker_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.meritz_links enable row level security;
alter table public.meritz_days enable row level security;
alter table public.meritz_runs enable row level security;
alter table public.meritz_orders enable row level security;
alter table public.meritz_fill_claims enable row level security;
alter table public.meritz_locks enable row level security;
alter table public.broker_notifications enable row level security;
alter table public.broker_push_subscriptions enable row level security;
revoke all on public.meritz_links,public.meritz_days,public.meritz_runs,public.meritz_orders,
  public.meritz_fill_claims,public.meritz_locks,public.broker_notifications,public.broker_push_subscriptions from anon,authenticated;
grant all on public.meritz_links,public.meritz_days,public.meritz_runs,public.meritz_orders,
  public.meritz_fill_claims,public.meritz_locks,public.broker_notifications,public.broker_push_subscriptions to service_role;
create index meritz_days_pending on public.meritz_days(strategy_id,session_date) where status in ('pending','review');
create index broker_notifications_created on public.broker_notifications(created_at desc);
create index meritz_orders_run on public.meritz_orders(run_id);

create function public.acquire_meritz_lock(p_account text,p_owner uuid) returns boolean
language sql set search_path=public as $$
  with held as (
    insert into public.meritz_locks(account_key,owner,expires_at) values(p_account,p_owner,now()+interval '5 minutes')
    on conflict(account_key) do update set owner=excluded.owner,expires_at=excluded.expires_at
    where meritz_locks.expires_at<=clock_timestamp() returning 1
  ) select exists(select 1 from held);
$$;
create function public.release_meritz_lock(p_account text,p_owner uuid) returns void
language sql set search_path=public as $$
  update public.meritz_locks set expires_at=now() where account_key=p_account and owner=p_owner;
$$;
create function public.reserve_meritz_call(p_account text,p_owner uuid) returns timestamptz
language plpgsql set search_path=public as $$
declare slot timestamptz;
begin
  update public.meritz_locks set next_call_at=greatest(clock_timestamp(),next_call_at)+interval '1 second'
    where account_key=p_account and owner=p_owner and expires_at>clock_timestamp()
    returning next_call_at-interval '1 second' into slot;
  if slot is null then raise exception 'BROKER_LOCK_EXPIRED'; end if;
  return slot;
end;
$$;

-- Atomic wrapper: fill identities, existing strategy commit, and import marker
-- succeed together or all roll back. A retry never adds the same fills twice.
create function public.commit_meritz_day(p_day uuid,p_account text,p_version bigint,p_fills jsonb,
  p_executions jsonb,p_snapshots jsonb,p_final jsonb,p_round jsonb) returns jsonb
language plpgsql set search_path=public as $$
declare d public.meritz_days%rowtype; f jsonb; result jsonb;
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
  update public.meritz_days set status='applied',broker_fills=p_fills,error=null where id=p_day;
  return result;
end;
$$;
revoke all on function public.acquire_meritz_lock(text,uuid),public.release_meritz_lock(text,uuid),
  public.reserve_meritz_call(text,uuid),
  public.commit_meritz_day(uuid,text,bigint,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.acquire_meritz_lock(text,uuid),public.release_meritz_lock(text,uuid),
  public.reserve_meritz_call(text,uuid),
  public.commit_meritz_day(uuid,text,bigint,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
