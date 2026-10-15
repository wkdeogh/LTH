-- Disposable database only; all fixtures roll back.
begin;
do $$
declare
  sid uuid:=gen_random_uuid(); fid uuid:=gen_random_uuid(); scheduled uuid:=gen_random_uuid();
  req uuid; eid uuid; s strategies%rowtype; v bigint; before_count bigint;
  payload jsonb; snaps jsonb; final_state jsonb; result jsonb:='{"path":"/","notice":"round-completed"}';
begin
  insert into strategies(id,name,symbol,split_count,principal,cash_balance,position_qty,avg_price,t_value,started_at)
    values(sid,'cash flow regression','SOXL',20,1000,500,5,100,10,'2026-09-01') returning * into s;
  perform record_strategy_cash_flow(sid,fid,s.version,'2026-09-01',1000,'immediate',100,'deposit');
  perform record_strategy_cash_flow(sid,fid,s.version,'2026-09-01',1000,'immediate',120,'deposit');
  assert (select principal=2000 and cash_balance=1500 and t_value=5 and position_qty=5 and avg_price=100 from strategies where id=sid), 'deposit or retry incorrect';
  assert (select count(*)=1 from strategy_cash_flows where strategy_id=sid), 'retry duplicated';
  begin
    perform record_strategy_cash_flow(sid,gen_random_uuid(),s.version,'2026-09-01',10,'immediate',100,'');
    raise exception 'stale accepted';
  exception when others then if sqlerrm<>'STALE_STRATEGY' then raise; end if; end;
  select * into s from strategies where id=sid;
  begin
    perform record_strategy_cash_flow(sid,gen_random_uuid(),s.version,'2026-09-01',-1501,'immediate',100,'');
    raise exception 'overdraft accepted';
  exception when others then if sqlerrm<>'INSUFFICIENT_CASH' then raise; end if; end;
  begin
    perform record_strategy_cash_flow(sid,gen_random_uuid(),s.version,'2026-09-01',1,'immediate',null,'');
    raise exception 'missing price accepted';
  exception when others then if sqlerrm<>'MISSING_REFERENCE_PRICE' then raise; end if; end;
  perform record_strategy_cash_flow(sid,gen_random_uuid(),s.version,'2026-09-01',-500,'immediate',100,'withdraw');
  assert (select principal=1500 and cash_balance=1000 and t_value=6.6666666667 from strategies where id=sid), 'withdrawal ratio incorrect';
  select * into s from strategies where id=sid;
  perform record_strategy_cash_flow(sid,scheduled,s.version,'2026-09-02',500,'next_round',null,'reserve');
  assert (select principal=1500 and cash_balance=1000 and t_value=s.t_value from strategies where id=sid), 'reservation changed round';
  select * into s from strategies where id=sid;
  begin
    perform record_strategy_cash_flow(sid,gen_random_uuid(),s.version,'2026-09-01',10,'next_round',null,'');
    raise exception 'backdate accepted';
  exception when others then if sqlerrm<>'CASH_FLOW_DATE_ORDER' then raise; end if; end;
  for pass in 1..2 loop
    select * into s from strategies where id=sid;
    eid:=gen_random_uuid(); req:=gen_random_uuid();
    payload:=jsonb_build_array(jsonb_build_object('id',eid,'executed_at','2026-09-03','side','sell','order_type','LIMIT','quantity',5,'avg_execution_price',120,'total_amount',600,'t_effect','full_sell'));
    snaps:=jsonb_build_array(to_jsonb(s)||'{"after_cash_balance":1600,"after_position_qty":0}');
    final_state:=to_jsonb(s)||jsonb_build_object('principal',case when pass=1 then 1600 else 1500 end,'cash_balance',1600,'position_qty',0,'avg_price',0,'t_value',0,'mode','normal','started_at','2026-09-03');
    perform commit_strategy_execution(sid,req,s.version,'{}',payload,snaps,final_state,'{"profit_amount":100,"profit_rate":6.66666667,"ending_t_value":0}',result);
    perform commit_strategy_execution(sid,req,s.version,'{}',payload,snaps,final_state,'{"profit_amount":100,"profit_rate":6.66666667,"ending_t_value":0}',result);
    assert (select cash_balance=2100 and principal=case when pass=1 then 2100 else 2000 end and t_value=0 from strategies where id=sid), 'pending not applied once';
    assert (select profit_amount=100 and ending_cash_balance=1600 from completed_rounds where strategy_id=sid), 'pending counted as round profit';
    assert (select status='applied' and applied_date='2026-09-03' from strategy_cash_flows where id=scheduled), 'missing application';
    perform cancel_latest_execution(sid,eid);
    assert (select cash_balance=1000 and position_qty=5 and principal=1500 from strategies where id=sid), 'close cancellation not restored';
    assert (select status='pending' and applied_date is null from strategy_cash_flows where id=scheduled), 'reservation not restored';
    assert (select count(*)=2 from strategy_adjustments where strategy_id=sid), 'cancel left application adjustment';
    update strategies set compounding_type='simple' where id=sid;
  end loop;
  select * into s from strategies where id=sid;
  perform cancel_strategy_cash_flow(sid,scheduled,s.version);
  perform cancel_strategy_cash_flow(sid,scheduled,s.version);
  assert (select status='cancelled' from strategy_cash_flows where id=scheduled), 'cancel not idempotent';
  select * into s from strategies where id=sid;
  perform record_strategy_cash_flow(sid,gen_random_uuid(),s.version,'2026-09-03',-1400,'next_round',null,'withdraw later');
  select * into s from strategies where id=sid;
  eid:=gen_random_uuid(); req:=gen_random_uuid();
  payload:=jsonb_build_array(jsonb_build_object('id',eid,'executed_at','2026-09-03','side','sell','order_type','LIMIT','quantity',5,'avg_execution_price',10,'total_amount',50,'t_effect','full_sell'));
  snaps:=jsonb_build_array(to_jsonb(s)||'{"after_cash_balance":1050,"after_position_qty":0}');
  final_state:=to_jsonb(s)||'{"principal":1500,"cash_balance":1050,"position_qty":0,"avg_price":0,"t_value":0,"mode":"normal","started_at":"2026-09-03"}';
  begin
    perform commit_strategy_execution(sid,req,s.version,'{}',payload,snaps,final_state,'{"profit_amount":-450,"profit_rate":-30,"ending_t_value":0}',result);
    raise exception 'pending overdraft accepted';
  exception when others then if sqlerrm<>'INSUFFICIENT_CASH' then raise; end if; end;
  assert (select version=s.version and cash_balance=1000 and position_qty=5 from strategies where id=sid), 'failed close changed state';
  assert not exists(select 1 from executions where strategy_id=sid), 'failed close left execution';
  assert not exists(select 1 from completed_rounds where strategy_id=sid), 'failed close left round';
  assert not has_function_privilege('anon','public.record_strategy_cash_flow(uuid,uuid,bigint,date,numeric,text,numeric,text)','EXECUTE'), 'anonymous access';
end;
$$;
rollback;
