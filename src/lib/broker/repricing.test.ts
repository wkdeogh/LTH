import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { activationDate, initialOrderSession, manualOrderSession, openingWindow, repriceWindow } from './calendar';
import { cancelThenReplace as cancelWithPolling, cancellableRow, exceedsFivePercent, isCancellationConfirmed, matchesTrackedOrder, planReplacement, type CancellationTarget, type TrackedOrder } from './repricing-policy';
import { MeritzClient, type BrokerRow } from './meritz';
import { type ApiOrder, type GuidePlan, judgeOrder } from './policy';

const cancelThenReplace: typeof cancelWithPolling = (targets, deps) => cancelWithPolling(targets, { ...deps, polling: { maxAttempts: 3, wait: async () => {} } });

const guideOrder = {label:'별지점',side:'buy' as const,orderType:'LOC' as const,price:105,quantity:60,note:'',completesBuyUnit:true};
const apiOrder: ApiOrder = {...guideOrder,key:'buy:LOC:9600',price:96,sources:[guideOrder]};
const order: TrackedOrder = {id:'order-1',order_key:apiOrder.key,body:{ovrs_stck_symb_iscd:'SOXL',ovrs_stck_oder_prc:'96.0000',oder_cls_code:'32'},guide_order:apiOrder,status:'accepted',broker_order_no:'101',broker_order_date:'20261103',attempted_at:'2026-11-03T13:00:00Z'};
const history: BrokerRow = {oder_date:'20261103',oder_no:101,orgl_oder_no:0,iscd:'SOXL.AX',oder_rctf_cncl_cls_code:'0',seln_byov_clcd:'2',aspr_type_code:'5',oder_dqty:'60',cntg_dqty:'0',cntg_camt:'0',ovrs_stck_oder_prc:'96.0000',ovrs_stck_oder_stat_cls_code:'0',oder_exec_ymdh:'2026-11-03 22:00:01'};
const target: CancellationTarget = {order,history,quantity:60};
const live: BrokerRow = {...history,odqt:60,cntg_qty:0,cncl_cnfr_qty:0,rctf_cnfr_qty:0,oder_able_qty:60,ncnt_qty:60};
const cancelled: BrokerRow = {...live,oder_able_qty:0,ncnt_qty:0};
const cancellation: BrokerRow = {...cancelled,oder_no:201,orgl_oder_no:101,oder_rctf_cncl_cls_code:'2',cncl_cnfr_qty:60,rctf_cncl_cls_code:'3'};
const plan: GuidePlan = {kind:'normal',phase:'second_half',oneUnitBudget:6300,starPercent:0,starPrice:105.01,buyPrice:105,targetSellPrice:144,buyOrders:[guideOrder],sellOrders:[],warnings:[],formulas:[]};

test('5%는 유지, 상승·하락 모두 5% 초과부터 교체한다',()=>{
  for(const p of [80,84,76]) assert.equal(exceedsFivePercent(80,p),false);
  for(const p of [84.0001,75.9999,90,60]) assert.equal(exceedsFivePercent(80,p),true);
  assert.throws(()=>exceedsFivePercent(0,80)); assert.throws(()=>exceedsFivePercent(80,NaN));
});
test('한국 22시와 03시: 서머타임·표준시·휴일·조기폐장·늦은 ON',()=>{
  for(const date of ['2026-07-06','2026-11-03']) {
    assert.equal(openingWindow(new Date(date+'T13:00:00Z')),true);
    assert.equal(openingWindow(new Date(date+'T13:30:00Z')),false);
    assert.equal(initialOrderSession(new Date(date+'T13:04:59Z')),true);
    assert.equal(initialOrderSession(new Date(date+'T13:05:00Z')),false);
    assert.equal(repriceWindow(new Date(date+'T18:00:00Z')),true);
    assert.equal(repriceWindow(new Date(date+'T18:05:00Z'),true),true);
    assert.equal(activationDate(new Date(date+'T12:59:59Z')),date);
    assert.notEqual(activationDate(new Date(date+'T13:00:00Z')),date);
  }
  assert.equal(openingWindow(new Date('2026-11-26T13:00:00Z')),false);
  assert.equal(repriceWindow(new Date('2026-11-27T18:00:00Z')),false);
  assert.equal(activationDate(new Date('2026-11-06T13:00:00Z')),'2026-11-09');
});
test('3시 가격으로 가이드를 재산출하고 +20%·-10% 필터를 다시 적용한다',()=>{
  const p={...plan,buyOrders:[guideOrder,{...guideOrder,label:'보완',isSupplemental:true,price:72,quantity:1}]};
  const result=planReplacement(p,[order],[history],90);
  assert.equal(result.processed.orders[0].price,105); assert.equal(result.processed.orders.length,1);
  assert.equal(result.targets.length,1);
  const beforeCancel=planReplacement(plan,[order],[history],80).processed;
  const justBeforeSubmit=planReplacement(plan,[order],[history],79.99).processed;
  assert.equal(beforeCancel.orders[0].price,96);
  assert.equal(justBeforeSubmit.orders[0].price,95.98);
  assert.equal(justBeforeSubmit.orders[0].quantity,60);
});
test('전량 기체결 매도는 취소·재주문에서 빼고 예수금·보유량 대조에 반영한다',()=>{
  const sellSource={...guideOrder,side:'sell' as const,orderType:'LIMIT' as const,label:'쿼터매도',price:110,quantity:10};
  const sellOrder:TrackedOrder={...order,id:'sell',broker_order_no:'102',guide_order:{...sellSource,key:'sell',sources:[sellSource]},body:{ovrs_stck_symb_iscd:'SOXL',ovrs_stck_oder_prc:'110.0000',oder_cls_code:'01'}};
  const sold={...history,oder_no:102,seln_byov_clcd:'1',aspr_type_code:'2',oder_dqty:'10',cntg_dqty:'10',cntg_camt:'1100',ovrs_stck_oder_prc:'110.0000'};
  const result=planReplacement({...plan,sellOrders:[sellSource]},[order,sellOrder],[history,sold],90);
  assert.equal(result.targets.length,1);assert.equal(result.sellQuantity,10);assert.equal(result.cashChange,1100);assert.equal(result.processed.orders.some(o=>o.side==='sell'),false);
});
test('부분체결·다른 수동 주문·정정 이력이 있으면 취소 전에 보류한다',()=>{
  assert.throws(()=>planReplacement(plan,[order],[{...history,cntg_dqty:'1'}],90),/부분체결/);
  assert.throws(()=>planReplacement(plan,[order],[history,{...history,oder_no:102}],90),/다른 SOXL/);
  assert.throws(()=>planReplacement(plan,[order],[history,{...history,oder_no:102,orgl_oder_no:101,oder_rctf_cncl_cls_code:'1'}],90),/정정/);
});
test('날짜가 바뀌어 번호가 반복돼도 공식 주문일자·시각으로 서로 다른 주문을 구분한다',()=>{
  const undated={...order,broker_order_date:null};
  assert.equal(matchesTrackedOrder(undated,history),true);
  assert.equal(matchesTrackedOrder(undated,{...history,oder_date:'20261104',oder_exec_ymdh:'2026-11-04 03:00:00'}),false);
  assert.equal(matchesTrackedOrder(order,{...history,oder_date:'20261104'}),false);
});
test('취소 접수만으로는 새 주문을 보내지 않고 확정 수량을 기다린다',async()=>{
  let sent=0,polls=0;const sequence:string[]=[];
  await cancelThenReplace([target],{guard:async()=>{},live:async()=>{polls++;return polls<3?[live]:[cancelled,cancellation]},cancel:async()=>{sequence.push('cancel');return '201'},confirmed:async()=>{sequence.push('confirmed')},replace:async()=>{sent++;sequence.push('replace')}});
  assert.deepEqual(sequence,['cancel','confirmed','replace']);assert.equal(sent,1);assert.equal(polls,3);
  assert.equal(isCancellationConfirmed(target,[cancelled,{...cancellation,cncl_cnfr_qty:59}],'201'),false);
  assert.throws(()=>cancellableRow(target,[{...live,cntg_qty:1}]),/수량/);
});
test('취소 거절·응답 유실·부분 취소·토글 OFF·취소 중 체결은 재주문으로 이어지지 않는다',async()=>{
  for(const fail of ['reject','timeout','unconfirmed','off','fill']) {
    let sent=0,calls=0;
    await assert.rejects(cancelThenReplace([target],{guard:async()=>{if(fail==='off')throw Error('OFF')},live:async()=>{calls++;return[fail==='fill'?{...live,cntg_qty:1}:live]},cancel:async()=>{if(fail==='reject'||fail==='timeout')throw Error(fail);return '201'},confirmed:async()=>{},replace:async()=>{sent++}}));
    assert.equal(sent,0,fail);
  }
});
test('여러 원주문 중 하나라도 취소가 확정되지 않으면 전체 교체를 막는다',async()=>{
  const other:CancellationTarget={...target,order:{...order,id:'order-2',broker_order_no:'102'},history:{...history,oder_no:102}};
  const requested=new Set<string>(), sequence:string[]=[];let replaced=0;
  await assert.rejects(cancelThenReplace([target,other],{
    guard:async()=>{},
    live:async()=>[requested.has('101')?cancelled:live,...(requested.has('101')?[cancellation]:[]),{...live,oder_no:102}],
    cancel:async t=>{requested.add(t.order.broker_order_no!);sequence.push(t.order.broker_order_no!);return t.order.broker_order_no==='101'?'201':'202'},
    confirmed:async()=>{sequence.push('confirmed')},replace:async()=>{replaced++},
  }),/취소 확정/);
  assert.deepEqual(sequence,['101','102']);assert.equal(replaced,0);
});
test('원주문 취소확정 0이어도 응답 번호로 연결된 취소 행의 전량 확정이면 통과한다',()=>{
  assert.equal(cancelled.cncl_cnfr_qty,0);
  assert.equal(isCancellationConfirmed(target,[cancelled,cancellation],'201'),true);
  assert.equal(isCancellationConfirmed(target,[{...cancelled,cncl_cnfr_qty:60}],'201'),false);
  const patches:BrokerRow[]=[
    {oder_no:202},{orgl_oder_no:102},{oder_date:'20261104'},
    {oder_rctf_cncl_cls_code:'1'},{rctf_cncl_cls_code:'1'},
    {iscd:'TQQQ.OQ'},{seln_byov_clcd:'1'},{ovrs_stck_oder_stat_cls_code:'1'},
    {odqt:59},{cncl_cnfr_qty:59},{cntg_qty:1},{rctf_cnfr_qty:1},{ncnt_qty:1},{oder_able_qty:1},
  ];
  for(const patch of patches) assert.equal(isCancellationConfirmed(target,[cancelled,{...cancellation,...patch}],'201'),false,JSON.stringify(patch));
  assert.equal(isCancellationConfirmed(target,[cancelled,cancellation,cancellation],'201'),false);
  assert.equal(isCancellationConfirmed(target,[cancelled,cancellation],''),false);
});
test('취소 중 체결·잔량·정정 또는 빠진 수량 필드는 전량 취소 행이 있어도 차단한다',()=>{
  for(const key of ['cntg_qty','rctf_cnfr_qty','ncnt_qty','oder_able_qty']) {
    for(const value of [1,null,'']) assert.equal(isCancellationConfirmed(target,[{...cancelled,[key]:value},cancellation],'201'),false,`${key}=${value}`);
    const missing={...cancelled};delete missing[key];
    assert.equal(isCancellationConfirmed(target,[missing,cancellation],'201'),false,key);
  }
  for(const value of [null,'',NaN]) assert.equal(isCancellationConfirmed(target,[cancelled,{...cancellation,cncl_cnfr_qty:value}],'201'),false);
});
test('실제 장애와 같은 32건·125주를 별도 취소 행으로 확인한 뒤 한 번만 재주문한다',async()=>{
  const targets:CancellationTarget[]=Array.from({length:32},(_,i)=>({...target,quantity:i===0?94:1,
    order:{...order,id:`order-${i}`,broker_order_no:String(101+i),guide_order:{...apiOrder,quantity:i===0?94:1}},
    history:{...history,oder_no:101+i,oder_dqty:String(i===0?94:1)}}));
  const requested=new Set<number>();let replacements=0,confirmed=0;
  const rows=()=>targets.flatMap((t,i)=>{
    const original={...live,oder_no:101+i,odqt:t.quantity,oder_dqty:String(t.quantity),...(requested.has(i)?{oder_able_qty:0,ncnt_qty:0}:{oder_able_qty:t.quantity,ncnt_qty:t.quantity})};
    return requested.has(i)?[original,{...cancellation,oder_no:201+i,orgl_oder_no:101+i,odqt:t.quantity,cncl_cnfr_qty:t.quantity}]:[original];
  });
  await cancelThenReplace(targets,{guard:async()=>{},live:async()=>rows(),
    cancel:async t=>{const i=targets.indexOf(t);requested.add(i);return String(201+i)},
    confirmed:async ts=>{confirmed=ts.length;assert.equal(requested.size,32)},replace:async()=>{replacements++}});
  assert.equal(targets.reduce((n,t)=>n+t.quantity,0),125);assert.equal(confirmed,32);assert.equal(replacements,1);
});
test('취소 응답 번호 유실·중복은 재주문으로 이어지지 않는다',async()=>{
  const other:CancellationTarget={...target,order:{...order,id:'order-2',broker_order_no:'102'},history:{...history,oder_no:102}};
  for(const cancelNo of ['','0','101','201']) {
    let sent=0;
    await assert.rejects(cancelThenReplace([target,other],{guard:async()=>{},live:async()=>[live,{...live,oder_no:102}],
      cancel:async()=>cancelNo,confirmed:async()=>{},replace:async()=>{sent++}}),/취소 주문번호/);
    assert.equal(sent,0);
  }
});
test('22시 장전 주문은 정규장 상태 API를 조회하지 않고 실제 주문 응답을 확인한다',async()=>{
  let queries=0;
  const unavailable=new MeritzClient({key:'k',secret:'s',wait:async()=>{},fetcher:(async()=>{queries++;throw new Error('장운영 조회 불가')}) as typeof fetch});
  await unavailable.assertMarketOpen(true);assert.equal(queries,0);
  const fetcher=(async(input:string|URL|Request)=>String(input).includes('oauth2')?new Response(JSON.stringify({access_token:'test'})):new Response(JSON.stringify({rsp_cd:'5766',data:{ovrs_mkop_cls_code:'012'}}))) as typeof fetch;
  const client=new MeritzClient({key:'k',secret:'s',fetcher,wait:async()=>{}});
  await client.assertMarketOpen(true);await assert.rejects(client.assertMarketOpen());
  const bad=new MeritzClient({key:'k',secret:'s',wait:async()=>{},fetcher:(async(input:string|URL|Request)=>String(input).includes('oauth2')?new Response(JSON.stringify({access_token:'test'})):new Response(JSON.stringify({rsp_cd:'0001',data:{warn_cls_code:'0',oder_no:99}}),{status:500})) as typeof fetch});
  await assert.rejects(bad.call('/trading/v1/overseas/orders/cancel',{}, {},true),/HTTP 500/);
  assert.equal(judgeOrder({rsp_cd:'0001',data:{warn_cls_code:'1',oder_no:99}}),'rejected');
});
test('수동 API 주문은 22시부터 가능하며 장전 허용을 이유로 시간·휴장 제한을 풀지 않는다',()=>{
  for(const day of ['2026-07-06','2026-11-03']){
    assert.equal(manualOrderSession(new Date(day+'T12:59:59Z')),false);
    assert.equal(manualOrderSession(new Date(day+'T13:00:00Z')),true);
    assert.equal(manualOrderSession(new Date(day+'T13:10:00Z')),true);
    assert.equal(initialOrderSession(new Date(day+'T13:10:00Z')),false);
    assert.equal(manualOrderSession(new Date(day+'T22:00:00Z')),false);
  }
  assert.equal(manualOrderSession(new Date('2026-11-26T13:10:00Z')),false);
  assert.equal(manualOrderSession(new Date('2026-11-27T17:50:00Z')),false);
});
test('DB 재점검·취소는 한 번만 기록되고 공개 역할은 접근할 수 없다',async()=>{
  const db=new PGlite();try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(readFileSync('supabase/schema.sql','utf8'));await db.exec(readFileSync('supabase/migrations/20261102135702_meritz_trading.sql','utf8'));await db.exec(readFileSync('supabase/migrations/20261102225704_meritz_three_am_reprice.sql','utf8'));
    const id=crypto.randomUUID(),run=crypto.randomUUID(),ord=crypto.randomUUID();
    await db.query(`insert into strategies(id,name,symbol,split_count,principal,cash_balance) values($1,'테스트','SOXL',20,1000,1000)`,[id]);
    await db.query(`insert into meritz_runs(id,strategy_id,account_key,session_date,source,snapshot,expires_at,submission_price) values($1,$2,'account','2026-11-03','auto','{}',now(),80)`,[run,id]);
    await db.query(`insert into meritz_reprices(run_id,status) values($1,'checking')`,[run]);
    await assert.rejects(db.query(`insert into meritz_reprices(run_id,status) values($1,'checking')`,[run]),/duplicate/);
    await db.query(`insert into meritz_orders(id,run_id,account_key,order_key,body,guide_order) values($1,$2,'account','first','{}','{}')`,[ord,run]);
    await db.query(`insert into meritz_cancellations(order_id,run_id,status,body) values($1,$2,'attempting','{}')`,[ord,run]);
    await assert.rejects(db.query(`insert into meritz_cancellations(order_id,run_id,status,body) values($1,$2,'attempting','{}')`,[ord,run]),/duplicate/);
    await db.exec('set role anon');await assert.rejects(db.query('select * from meritz_reprices'),/permission/);await assert.rejects(db.query('select * from meritz_cancellations'),/permission/);
  }finally{await db.close()}
});
