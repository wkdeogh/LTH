begin;

-- Preserve the existing live strategy and all archived financial history.
do $$
begin
  if not exists(select 1 from public.strategies where id='621f66d2-de56-4dba-a8ff-1583bf491141'
    and not is_archived and symbol='SOXL' and split_count=20)
    or exists(select 1 from public.strategies where not is_archived and id<>'621f66d2-de56-4dba-a8ff-1583bf491141') then
    raise exception 'CURRENT_SOXL_STRATEGY_REQUIRED';
  end if;
end;
$$;

drop trigger if exists strategies_assign_first_main on public.strategies;
drop trigger if exists strategies_protect_main on public.strategies;
drop function if exists public.set_main_strategy(uuid);
drop function if exists public.assign_first_main_strategy();
drop function if exists public.protect_main_strategy();
alter table public.strategies drop constraint if exists strategies_main_active;
drop index if exists public.strategies_one_main;
alter table public.strategies drop column if exists is_main;
alter table public.strategies drop column if exists sort_order;

alter table public.strategies add constraint strategies_current_soxl_only check (
  is_archived or (id='621f66d2-de56-4dba-a8ff-1583bf491141' and symbol='SOXL' and split_count=20)
);
create unique index strategies_single_active on public.strategies ((true)) where not is_archived;

create function public.protect_single_soxl_strategy() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  if tg_op='INSERT' then raise exception 'STRATEGY_CREATION_DISABLED'; end if;
  if tg_op='DELETE' then raise exception 'STRATEGY_DELETE_DISABLED'; end if;
  if old.id<>'621f66d2-de56-4dba-a8ff-1583bf491141' then raise exception 'ARCHIVED_STRATEGY_READ_ONLY'; end if;
  if new.id<>old.id or new.is_archived or new.symbol<>'SOXL' or new.split_count<>20 then
    raise exception 'SOXL_20_STRATEGY_FIXED';
  end if;
  return new;
end;
$$;
create trigger strategies_single_soxl before insert or update or delete on public.strategies
for each row execute function public.protect_single_soxl_strategy();
revoke all on function public.protect_single_soxl_strategy() from public,anon,authenticated;
grant execute on function public.protect_single_soxl_strategy() to service_role;

notify pgrst, 'reload schema';
commit;
