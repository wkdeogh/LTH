import test from 'node:test';
import assert from 'node:assert/strict';
import type { StrategyState } from '@/lib/types';
import { calculateNormalPlan, type OrderGuide } from '@/lib/trading/normalMode';
import { processGuide, type ApiOrder, type ProcessedGuide } from './policy';
import { buyReservation, fitOrderFunding, fundingSummary, orderCash, waitForOrderFunding } from './funding';
import { cancelThenReplace, type CancellationTarget } from './repricing-policy';
import type { BrokerRow } from './meritz';

const state:StrategyState={id:'test',name:'test',symbol:'SOXL',splitCount:20,principal:20000,cashBalance:1000,positionQty:200,avgPrice:100,tValue:19,mode:'normal',reverseStartedAt:null,reverseFirstSellDone:false};
const source:OrderGuide={side:'buy',label:'기본매수',orderType:'LOC',price:81.99,quantity:12,note:'',completesBuyUnit:true};
function api(s:OrderGuide):ApiOrder { return {...s,key:`${s.side}:${s.label}`,sources:[s]}; }
function processed(orders:ApiOrder[]):ProcessedGuide { return {orders,skipped:[],currentPrice:82}; }

test('T19·현금1000: 기본983.88은 유지하고 보완76.92만 제외해 매도도 전송 대상으로 남긴다',()=>{
  const input=processGuide(calculateNormalPlan(state),82),before=JSON.stringify(input);
  assert.equal(Math.round(buyReservation(input.orders)*100),106080);
  const result=fitOrderFunding(input,state,1000,200);
  assert.deepEqual(result.orders.filter(o=>o.side==='buy').map(o=>[o.price,o.quantity]),[[81.99,12]]);
  assert.equal(result.orders.filter(o=>o.side==='sell').length,1);
  assert.equal(result.skipped.filter(s=>s.reason.startsWith('주문가능 현금')).length,1);
  assert.equal(JSON.stringify(input),before);
});
test('상한 가격에 합쳐진 기본·보완매수를 분리해 기본 수량을 우선 확보한다',()=>{
  const base={...source,price:105,quantity:60};
  const guide={...calculateNormalPlan(state),buyOrders:[base,{...base,label:'보완1',quantity:1,isSupplemental:true},{...base,label:'보완2',quantity:1,isSupplemental:true}],sellOrders:[]};
  const input=processGuide(guide,80);
  assert.equal(input.orders.length,1);assert.equal(input.orders[0].quantity,62);
  const result=fitOrderFunding(input,{...state,cashBalance:5856},5856,200);
  assert.equal(result.orders[0].price,96);assert.equal(result.orders[0].quantity,61);
  assert.deepEqual(result.orders[0].sources.map(s=>s.label),['기본매수','보완1']);
  assert.equal(result.skipped.at(-1)!.label,'보완2');
});
test('보완은 높은 가격부터 현금 안에서 남기고 정확히 충분한 현금은 허용한다',()=>{
  const input=processed([api({...source,price:10,quantity:1}),api({...source,label:'낮은 보완',price:8,quantity:1,isSupplemental:true}),api({...source,label:'높은 보완',price:9,quantity:1,isSupplemental:true})]);
  const result=fitOrderFunding(input,{...state,cashBalance:19},19,200);
  assert.equal(result.orders.reduce((n,o)=>n+o.quantity,0),2);
  assert.ok(result.orders.some(o=>o.sources[0].label==='높은 보완'));
  assert.ok(!result.orders.some(o=>o.sources[0].label==='낮은 보완'));
  const exact=fitOrderFunding(processed([api({...source,price:0.1,quantity:3})]),{...state,cashBalance:0.3},0.3,200);
  assert.equal(exact.orders[0].quantity,3);
  assert.equal(fitOrderFunding(processed([api({...source,price:0.1,quantity:3})]),state,0.2999,200).orders.length,0);
});
test('기본매수도 감당 못하면 수량·T 의미를 임의 변경하지 않고 매수만 제외한다',()=>{
  const sell=api({...source,side:'sell',label:'쿼터매도',price:82,quantity:50});
  const input=processed([sell,api(source),api({...source,label:'보완',quantity:1,price:76.92,isSupplemental:true})]);
  const result=fitOrderFunding(input,state,100,200);
  assert.deepEqual(result.orders,[sell]);assert.equal(result.skipped.length,2);
  assert.match(fundingSummary(result),/매수 2건/);
  const empty=fitOrderFunding(processed([api(source)]),state,0,200);
  assert.equal(empty.orders.length,0);assert.match(fundingSummary(empty),/매수 1건/);
  const halves=processed([api({...source,quantity:6,completesBuyUnit:false}),api({...source,label:'평단매수',price:100,quantity:5})]);
  assert.equal(fitOrderFunding(halves,state,600,200).orders.length,0,'일부 기본 가이드만 사서 T를 잘못 완성하지 않는다');
});
test('수동 확인은 승인한 주문의 부분집합만 남기며 현금이 회복돼도 제외한 매수를 복원하지 않는다',()=>{
  const preview=fitOrderFunding(processGuide(calculateNormalPlan(state),82),state,1000,200);
  const confirmed=fitOrderFunding(preview,state,990,200);
  assert.equal(confirmed.orders.find(o=>o.side==='buy')!.quantity,12);
  const recovered=fitOrderFunding(confirmed,{...state,cashBalance:2000},2000,200);
  assert.deepEqual(recovered.orders,confirmed.orders);
  const lower=fitOrderFunding(preview,state,900,200);
  assert.equal(lower.orders.some(o=>o.side==='buy'),false);assert.equal(lower.orders.some(o=>o.side==='sell'),true);
});
test('매수 가이드·예수금·매도가능수량의 실제 오류는 여전히 차단한다',()=>{
  assert.throws(()=>fitOrderFunding(processed([{...api(source),quantity:13}]),state,1000,200),/연결/);
  assert.throws(()=>fitOrderFunding(processed([api({...source,side:'sell',quantity:201})]),state,1000,200),/매도/);
  for(const cash of [NaN,-1,Infinity])assert.throws(()=>fitOrderFunding(processed([api(source)]),state,cash,200),/현금/);
  assert.equal(orderCash([{crcd:'USD',oder_crnc_oder_able_camt:'0'}]),0);
  assert.equal(orderCash([{crcd:'KRW',oder_crnc_oder_able_camt:100},{crcd:'USD',oder_crnc_oder_able_camt:'1000.1234'}]),1000.1234);
  for(const rows of [[],[{crcd:'USD'}],[{crcd:'USD',oder_crnc_oder_able_camt:null}],[{crcd:'USD',oder_crnc_oder_able_camt:''}],[{crcd:'USD',oder_crnc_oder_able_camt:NaN}],Array(2).fill({crcd:'USD',oder_crnc_oder_able_camt:0})])assert.throws(()=>orderCash(rows),/현금/);
});
test('취소 후 현금·매도가능 반환은 조회만 최대3회 기다리고 남은 현금으로 주문을 맞춘다',async()=>{
  let reads=0;const result=await waitForOrderFunding(1000,200,async()=>({cash:[0,500,1000][reads++],sellable:200}));
  assert.equal(result.cash,1000);assert.equal(reads,3);
  reads=0;assert.equal((await waitForOrderFunding(1000,200,async()=>{reads++;return {cash:900,sellable:200}})).cash,900);assert.equal(reads,3);
  reads=0;await waitForOrderFunding(1000,200,async()=>({cash:1000,sellable:[0,100,200][reads++]}));assert.equal(reads,3);
  reads=0;await assert.rejects(waitForOrderFunding(1000,200,async()=>{reads++;throw Error('조회 실패')}),/조회 실패/);assert.equal(reads,1);
});
test('3시 취소 확정 뒤 현금이 줄어도 가능한 매도는 교체하고, 체결이 끼면 교체하지 않는다',async()=>{
  const original:BrokerRow={oder_date:'20261103',oder_no:101,oder_rctf_cncl_cls_code:'0',odqt:12,cntg_qty:0,rctf_cnfr_qty:0,cncl_cnfr_qty:0,ncnt_qty:12,oder_able_qty:12,iscd:'SOXL.AX',seln_byov_clcd:'2',aspr_type_code:'5',ovrs_stck_oder_prc:'81.99'};
  const target:CancellationTarget={quantity:12,history:original,order:{id:'test',order_key:'buy',body:{ovrs_stck_symb_iscd:'SOXL',ovrs_stck_oder_prc:'81.99'},guide_order:api(source),status:'accepted',broker_order_no:'101',broker_order_date:'20261103',attempted_at:'2026-11-03T13:00:00Z'}};
  for(const filled of [0,1]) {
    let cancelled=false,replaced=0;
    const run=cancelThenReplace([target],{guard:async()=>{},
      live:async()=>cancelled?[{...original,ncnt_qty:0,oder_able_qty:0,cntg_qty:filled},{...original,oder_no:201,orgl_oder_no:101,oder_rctf_cncl_cls_code:'2',rctf_cncl_cls_code:'3',ovrs_stck_oder_stat_cls_code:'0',cncl_cnfr_qty:12,ncnt_qty:0,oder_able_qty:0}]:[original],
      cancel:async()=>{cancelled=true;return '201'},confirmed:async()=>{},replace:async()=>{
        const funding=await waitForOrderFunding(1000,200,async()=>({cash:0,sellable:200}));
        const batch=fitOrderFunding(processGuide(calculateNormalPlan(state),82),state,funding.cash,funding.sellable);
        assert.equal(batch.orders.filter(o=>o.side==='buy').length,0);assert.equal(batch.orders.filter(o=>o.side==='sell').length,1);replaced++;
      }});
    if(filled)await assert.rejects(run,/취소 확정/);else await run;
    assert.equal(replaced,filled?0:1);
  }
});
