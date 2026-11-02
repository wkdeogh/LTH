-- Preserve the first submission's actual reference quote across replacements.
alter table public.meritz_runs add column submission_price numeric(18,4) check (submission_price > 0);
create table public.meritz_reprices (
  run_id uuid primary key references public.meritz_runs(id) on delete cascade,
  status text not null check(status in ('checking','unchanged','cancelling','cancelled','submitting','accepted','review')),
  initial_price numeric(18,4) check(initial_price > 0),
  current_price numeric(18,4) check(current_price > 0),
  replacement_snapshot jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create table public.meritz_cancellations (
  order_id uuid primary key references public.meritz_orders(id) on delete cascade,
  run_id uuid not null references public.meritz_reprices(run_id) on delete cascade,
  status text not null check(status in ('attempting','requested','confirmed','rejected','unknown')),
  body jsonb not null,
  response jsonb,
  broker_cancel_no text,
  attempted_at timestamptz not null default now(),
  confirmed_at timestamptz
);
alter table public.meritz_reprices enable row level security;
alter table public.meritz_cancellations enable row level security;
revoke all on public.meritz_reprices,public.meritz_cancellations from anon,authenticated;
grant all on public.meritz_reprices,public.meritz_cancellations to service_role;
