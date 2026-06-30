create table if not exists strategies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  symbol text not null check (symbol in ('TQQQ', 'SOXL', 'RAM')),
  split_count integer not null check (split_count in (20, 40)),
  principal numeric(18, 4) not null,
  cash_balance numeric(18, 4) not null,
  position_qty integer not null default 0,
  avg_price numeric(18, 4) not null default 0,
  t_value numeric(18, 10) not null default 0,
  mode text not null check (mode in ('normal', 'reverse')) default 'normal',
  reverse_started_at date,
  reverse_first_sell_done boolean not null default false,
  compounding_type text not null check (compounding_type in ('simple', 'compound')) default 'compound',
  is_archived boolean not null default false,
  sort_order integer not null default 0,
  started_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists daily_prices (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references strategies(id) on delete cascade,
  trade_date date not null,
  close_price numeric(18, 4) not null,
  created_at timestamptz not null default now(),
  unique(strategy_id, trade_date)
);

create table if not exists trade_plans (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references strategies(id) on delete cascade,
  plan_date date not null,
  mode text not null check (mode in ('normal', 'reverse')),
  phase text,
  t_value numeric(18, 10) not null,
  avg_price numeric(18, 4) not null,
  cash_balance numeric(18, 4) not null,
  position_qty integer not null,
  star_percent numeric(18, 8),
  star_price numeric(18, 4),
  one_unit_budget numeric(18, 4),
  reverse_reference_price numeric(18, 4),
  guidance jsonb not null,
  created_at timestamptz not null default now(),
  unique(strategy_id, plan_date)
);

create table if not exists executions (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references strategies(id) on delete cascade,
  trade_plan_id uuid references trade_plans(id) on delete set null,
  round_id uuid,
  executed_at date not null,
  side text not null check (side in ('buy', 'sell')),
  order_type text not null check (order_type in ('LOC', 'MOC', 'LIMIT', 'MANUAL')),
  quantity integer not null check (quantity > 0),
  avg_execution_price numeric(18, 4) not null,
  total_amount numeric(18, 4) not null,
  t_effect text check (t_effect in ('buy_full', 'buy_half', 'quarter_sell', 'full_sell', 'limit_sell_then_full_buy', 'limit_sell_then_half_buy', 'reverse_buy', 'reverse_sell', 'none')),
  memo text,
  created_at timestamptz not null default now()
);

create table if not exists completed_rounds (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references strategies(id) on delete cascade,
  round_number integer not null,
  symbol text not null check (symbol in ('TQQQ', 'SOXL', 'RAM')),
  split_count integer not null check (split_count in (20, 40)),
  started_at date not null,
  ended_at date not null,
  started_principal numeric(18, 4) not null,
  ending_cash_balance numeric(18, 4) not null,
  profit_amount numeric(18, 4) not null,
  profit_rate numeric(18, 8) not null,
  execution_count integer not null,
  buy_count integer not null,
  sell_count integer not null,
  total_buy_amount numeric(18, 4) not null,
  total_sell_amount numeric(18, 4) not null,
  ending_t_value numeric(18, 10) not null,
  created_at timestamptz not null default now(),
  unique(strategy_id, round_number)
);

alter table strategies drop constraint if exists strategies_symbol_check;
alter table strategies add constraint strategies_symbol_check check (symbol in ('TQQQ', 'SOXL', 'RAM'));

alter table executions drop constraint if exists executions_t_effect_check;
alter table executions add constraint executions_t_effect_check check (t_effect in ('buy_full', 'buy_half', 'quarter_sell', 'full_sell', 'limit_sell_then_full_buy', 'limit_sell_then_half_buy', 'reverse_buy', 'reverse_sell', 'none'));

alter table executions add column if not exists round_id uuid;
do $$
begin
  alter table executions
    add constraint executions_round_id_fkey
    foreign key (round_id) references completed_rounds(id) on delete set null;
exception
  when duplicate_object then null;
end $$;

create table if not exists strategy_snapshots (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references strategies(id) on delete cascade,
  snapshot_date date not null,
  mode text not null,
  cash_balance numeric(18, 4) not null,
  position_qty integer not null,
  avg_price numeric(18, 4) not null,
  t_value numeric(18, 10) not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_strategies_active on strategies (is_archived, sort_order, created_at);
create index if not exists idx_daily_prices_strategy_date on daily_prices (strategy_id, trade_date desc);
create index if not exists idx_trade_plans_strategy_date on trade_plans (strategy_id, plan_date desc);
create index if not exists idx_executions_strategy_date on executions (strategy_id, executed_at desc);
create index if not exists idx_executions_round on executions (round_id, executed_at desc);
create index if not exists idx_snapshots_strategy_date on strategy_snapshots (strategy_id, snapshot_date desc);
create index if not exists idx_completed_rounds_strategy on completed_rounds (strategy_id, round_number desc);

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;

notify pgrst, 'reload schema';
