begin;

alter table public.strategies add column if not exists is_main boolean not null default false;

create unique index if not exists strategies_one_main on public.strategies (is_main) where is_main;
alter table public.strategies drop constraint if exists strategies_main_active;
alter table public.strategies add constraint strategies_main_active check (not is_main or not is_archived);

update public.strategies set is_main = true
where id = (
  select id from public.strategies where not is_archived
  order by sort_order, created_at, id limit 1
) and not exists (select 1 from public.strategies where is_main);

create or replace function public.assign_first_main_strategy()
returns trigger language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(731204901);
  if not new.is_archived and not exists (select 1 from public.strategies where is_main) then
    new.is_main := true;
  end if;
  return new;
end;
$$;

drop trigger if exists strategies_assign_first_main on public.strategies;
create trigger strategies_assign_first_main before insert on public.strategies
for each row execute function public.assign_first_main_strategy();

create or replace function public.protect_main_strategy()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.is_main then
    if tg_op = 'DELETE' then
      raise exception 'MAIN_STRATEGY_PROTECTED';
    elsif new.is_archived then
      raise exception 'MAIN_STRATEGY_PROTECTED';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists strategies_protect_main on public.strategies;
create trigger strategies_protect_main before update or delete on public.strategies
for each row execute function public.protect_main_strategy();

create or replace function public.set_main_strategy(target_id uuid)
returns void language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(731204901);
  perform 1 from public.strategies where id = target_id and not is_archived for update;
  if not found then raise exception 'STRATEGY_NOT_ACTIVE'; end if;

  update public.strategies set is_main = false, updated_at = now() where is_main and id <> target_id;
  update public.strategies set is_main = true, updated_at = now() where id = target_id;
end;
$$;

revoke all on function public.assign_first_main_strategy() from public;
revoke all on function public.protect_main_strategy() from public;
revoke all on function public.set_main_strategy(uuid) from public;
grant execute on function public.set_main_strategy(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
