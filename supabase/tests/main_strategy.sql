begin;

do $$
begin
  if exists (select 1 from public.strategies) then
    raise exception 'EMPTY_TEST_DATABASE_REQUIRED';
  end if;
end;
$$;

set local role service_role;

insert into public.strategies (id, name, symbol, split_count, principal, cash_balance)
values ('00000000-0000-0000-0000-000000000001', 'First', 'SOXL', 20, 1000, 1000),
       ('00000000-0000-0000-0000-000000000002', 'Second', 'TQQQ', 40, 1000, 1000);

do $$
declare
  first_id uuid := '00000000-0000-0000-0000-000000000001';
  second_id uuid := '00000000-0000-0000-0000-000000000002';
begin
  assert (select is_main from public.strategies where id = first_id), 'First strategy must be main';
  assert (select count(*) = 1 from public.strategies where is_main), 'Only one main is allowed';

  begin
    update public.strategies set is_main = true where id = second_id;
    raise exception 'Duplicate main must fail';
  exception when unique_violation then null;
  end;

  begin
    update public.strategies set is_archived = true where id = first_id;
    raise exception 'Archive must fail';
  exception when raise_exception then
    if sqlerrm <> 'MAIN_STRATEGY_PROTECTED' then raise; end if;
  end;

  begin
    delete from public.strategies where id = first_id;
    raise exception 'Delete must fail';
  exception when raise_exception then
    if sqlerrm <> 'MAIN_STRATEGY_PROTECTED' then raise; end if;
  end;

  begin
    update public.strategies set is_main = false, is_archived = true where id = first_id;
    raise exception 'Combined demotion and archive must fail';
  exception when raise_exception then
    if sqlerrm <> 'MAIN_STRATEGY_PROTECTED' then raise; end if;
  end;

  begin
    perform public.set_main_strategy('00000000-0000-0000-0000-000000000099');
    raise exception 'Missing target must fail';
  exception when raise_exception then
    if sqlerrm <> 'STRATEGY_NOT_ACTIVE' then raise; end if;
  end;
  assert (select is_main from public.strategies where id = first_id), 'Invalid switch must preserve main';

  perform public.set_main_strategy(second_id);
  perform public.set_main_strategy(second_id);
  assert (select is_main from public.strategies where id = second_id), 'Main must switch';
  assert (select count(*) = 1 from public.strategies where is_main), 'Switch must keep exactly one main';

  update public.strategies set is_archived = true where id = first_id;
  assert (select is_archived from public.strategies where id = first_id), 'Former main can be archived';
  begin
    perform public.set_main_strategy(first_id);
    raise exception 'Archived target must fail';
  exception when raise_exception then
    if sqlerrm <> 'STRATEGY_NOT_ACTIVE' then raise; end if;
  end;
  begin
    delete from public.strategies where id = second_id;
    raise exception 'Last active strategy must stay protected';
  exception when raise_exception then
    if sqlerrm <> 'MAIN_STRATEGY_PROTECTED' then raise; end if;
  end;
end;
$$;

rollback;
