begin;
do $$
declare
  sid uuid := gen_random_uuid(); rid uuid := gen_random_uuid(); eid uuid := gen_random_uuid();
  s strategies%rowtype; payload jsonb; snaps jsonb; final_state jsonb; result jsonb := '{"path":"/","notice":"execution-saved"}';
  version_before bigint;
begin
  insert into strategies(id,name,symbol,split_count,principal,cash_balance,started_at)
    values(sid,'workflow test','SOXL',20,1000,1000,'2026-09-01') returning * into s;
  payload := jsonb_build_array(jsonb_build_object('id',eid,'executed_at','2026-09-01','side','buy','order_type','LOC','quantity',10,'avg_execution_price',10,'total_amount',100,'t_effect','buy_full'));
  snaps := '[{"cash_balance":1000,"position_qty":0,"avg_price":0,"t_value":0,"after_cash_balance":900,"after_position_qty":10}]';
  final_state := to_jsonb(s) || '{"cash_balance":900,"position_qty":10,"avg_price":10,"t_value":1}';
  perform commit_strategy_execution(sid,rid,s.version,'{}',payload,snaps,final_state,null,result);
  perform commit_strategy_execution(sid,rid,s.version,'{}',payload,snaps,final_state,null,result);
  assert (select count(*)=1 from executions where strategy_id=sid), 'retry duplicated execution';
  assert (select cash_balance=900 from strategies where id=sid), 'incorrect balance';
  begin
    perform commit_strategy_execution(sid,rid,s.version,'{"changed":true}',payload,snaps,final_state,null,result);
    raise exception 'conflicting request accepted';
  exception when others then if sqlerrm <> 'REQUEST_CONFLICT' then raise; end if; end;
  begin
    perform commit_strategy_execution(sid,gen_random_uuid(),s.version,'{}',payload,snaps,final_state,null,result);
    raise exception 'stale request accepted';
  exception when others then if sqlerrm <> 'STALE_STRATEGY' then raise; end if; end;
  select version into version_before from strategies where id=sid;
  begin
    perform commit_strategy_execution(sid,gen_random_uuid(),version_before,'{}',jsonb_set(payload,'{0,id}',to_jsonb(gen_random_uuid())),snaps,final_state || '{"cash_balance":-1}',null,result);
    raise exception 'invalid state accepted';
  exception when others then if sqlerrm <> 'INVALID_FINAL_STATE' then raise; end if; end;
  assert (select count(*)=1 from executions where strategy_id=sid), 'failed write left execution';
  assert (select count(*)=1 from strategy_snapshots where strategy_id=sid), 'failed write left snapshot';
  assert (select version=version_before from strategies where id=sid), 'failed write changed version';
  perform cancel_latest_execution(sid,eid);
  assert (select count(*)=0 from executions where strategy_id=sid), 'cancel left execution';
  assert (select cash_balance=1000 and position_qty=0 from strategies where id=sid), 'cancel did not restore balance';
  begin
    perform commit_strategy_execution(sid,rid,s.version,'{}',payload,snaps,final_state,null,result);
    raise exception 'cancelled request accepted';
  exception when others then if sqlerrm <> 'REQUEST_CANCELLED' then raise; end if; end;
  select * into s from strategies where id=sid;
  perform correct_strategy_state(sid,s.version,'2026-09-02',to_jsonb(s) || '{"cash_balance":1100}','deposit');
  assert (select count(*)=1 from strategy_adjustments where strategy_id=sid and kind='correction'), 'missing correction';
  assert (select (before_state->>'cash_balance')::numeric=1000 and (after_state->>'cash_balance')::numeric=1100 from strategy_adjustments where strategy_id=sid), 'incorrect correction states';
  begin
    perform correct_strategy_state(sid,s.version,'2026-09-02',to_jsonb(s),'retry');
    raise exception 'stale correction accepted';
  exception when others then if sqlerrm <> 'STALE_STRATEGY' then raise; end if; end;
end;
$$;
rollback;
