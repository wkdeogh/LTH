import test from 'node:test';
import assert from 'node:assert/strict';
import { groupSupplementalOrders } from './orderGrouping';
import { processGuide, type ApiOrder, type GuidePlan } from './policy';
import { calculateNormalPlan } from '@/lib/trading/normalMode';
import { fitOrderFunding, buyReservation } from './funding';
import { planReplacement, replacementBudgetMs, type TrackedOrder } from './repricing-policy';
import { buildBrokerCommit, type BrokerFill } from './reconciliation';
import type { Strategy, StrategyState } from '@/lib/types';

function orders(prices:number[]):ApiOrder[] { return prices.map((price,i)=>({key:`s-${i}`,side:'buy',orderType:'LOC',price,quantity:1,
  sources:[{label:`보완 ${i}`,side:'buy',orderType:'LOC',price,quantity:1,isSupplemental:true,completesBuyUnit:true,note:''}]})); }
test('예시 5개 보완매수는 70.80달러 3주·68.30달러 2주로 합친다',()=>{
  const input=orders([72.5,71.9,70.8,69.6,68.3]),before=JSON.stringify(input);
  const grouped=groupSupplementalOrders(input);
  assert.deepEqual(grouped.map(o=>[o.price,o.quantity]),[[70.8,3],[68.3,2]]);
  assert.equal(grouped.flatMap(o=>o.sources).length,5);
  assert.equal(JSON.stringify(input),before);
});
test('최고가 기준 정확히3%는 묶고 초과는 분리하며 인접가격 연결로 폭을 늘리지 않는다',()=>{
  assert.deepEqual(groupSupplementalOrders(orders([100,97,96.99])).map(o=>[o.price,o.quantity]),[[97,2],[96.99,1]]);
  assert.deepEqual(groupSupplementalOrders(orders([100,98,96])).map(o=>[o.price,o.quantity]),[[98,2],[96,1]]);
  assert.deepEqual(groupSupplementalOrders(orders([96,100,98])).map(o=>[o.price,o.quantity]),[[98,2],[96,1]]);
});
test('기본매수·매도·주문유형은 변경하지 않고 각 보완가격을 올리지 않는다',()=>{
  const original=orders([72.5,71.9,70.8]);
  const basic={...original[0],key:'basic',quantity:60,sources:[{...original[0].sources[0],quantity:60,isSupplemental:false}]};
  const sell:ApiOrder={...original[0],key:'sell',side:'sell',sources:[{...original[0].sources[0],side:'sell'}]};
  const limit:ApiOrder={...original[0],key:'limit',orderType:'LIMIT',sources:[{...original[0].sources[0],orderType:'LIMIT'}]};
  const grouped=groupSupplementalOrders([...original,basic,sell,limit]);
  assert.ok(grouped.includes(basic));assert.ok(grouped.includes(sell));
  assert.equal(grouped.find(o=>o.orderType==='LIMIT')!.quantity,1);
  for(const order of grouped.filter(o=>o.sources.every(s=>s.isSupplemental))) {
    assert.ok(order.sources.every(s=>order.price!<=s.price!));
    assert.equal(order.quantity,order.sources.reduce((sum,s)=>sum+s.quantity,0));
  }
});
const state:StrategyState={id:'test',name:'test',symbol:'SOXL',splitCount:20,principal:20000,cashBalance:1000,positionQty:200,avgPrice:100,tValue:19,mode:'normal',reverseStartedAt:null,reverseFirstSellDone:false};
test('현재가 -10% 필터를 먼저 적용하고 현금 검사에도 묶음가격·원본 수량을 사용한다',()=>{
  const plan:GuidePlan={...calculateNormalPlan(state),buyOrders:orders([72.5,71.9,70.8,69.6,68.3]).flatMap(o=>o.sources),sellOrders:[]};
  const processed=processGuide(plan,80);
  assert.deepEqual(processed.orders.map(o=>[o.price,o.quantity]),[[72.5,1]]);
  const unfiltered={...processGuide(plan,70),currentPrice:70};
  const result=fitOrderFunding(unfiltered,{...state,cashBalance:300},300,200);
  assert.equal(buyReservation(result.orders),212.4+68.3);
  assert.equal(result.orders.reduce((n,o)=>n+o.quantity,0),4);
  assert.equal(result.skipped.length,1);
});
test('묶음주문 전량 체결은 모든 원본을 소진시키고 아침 T는 한 번만 증가한다',()=>{
  const sourceOrders=orders([72.5,71.9,70.8]);
  const plan:GuidePlan={...calculateNormalPlan(state),buyOrders:sourceOrders.flatMap(o=>o.sources),sellOrders:[]};
  const grouped=processGuide(plan,70).orders[0];
  const tracked:TrackedOrder={id:'t',order_key:grouped.key,body:{ovrs_stck_symb_iscd:'SOXL',ovrs_stck_oder_prc:grouped.price!},guide_order:grouped,status:'accepted',broker_order_no:'101',broker_order_date:'20261106',attempted_at:'2026-11-06T13:00:00Z'};
  const history={oder_date:'20261106',oder_no:101,oder_rctf_cncl_cls_code:'0',ovrs_stck_oder_stat_cls_code:'0',iscd:'SOXL.AX',seln_byov_clcd:'2',aspr_type_code:'5',ovrs_stck_oder_prc:70.8,oder_dqty:3,cntg_dqty:3,cntg_camt:210};
  assert.equal(planReplacement(plan,[tracked],[history],70).processed.orders.length,0);
  const strategy={id:'test',symbol:'SOXL',split_count:20,principal:20000,cash_balance:1000,position_qty:200,avg_price:100,t_value:18,mode:'normal',reverse_first_sell_done:false,reverse_started_at:null,compounding_type:'compound',started_at:'2026-11-01'} as Strategy;
  const fill:BrokerFill={orderDate:'20261106',orderNo:'101',fillNo:'1',symbol:'SOXL',side:'buy',orderType:'LOC',quantity:3,amount:210,price:70,limitPrice:70.8,time:'2026-11-07 06:00:00',orderQuantity:3};
  const commit=buildBrokerCommit(strategy,plan,[fill],'2026-11-06',70);
  assert.equal(commit.final.t_value,19);assert.equal(commit.final.cash_balance,790);assert.equal(commit.final.position_qty,203);
});
test('44건 보완주문을 묶으면 240초 예산에서 사전 처리45초를 포함해 교체할 수 있는 규모가 된다',()=>{
  const grouped=groupSupplementalOrders(orders(Array.from({length:44},(_,i)=>53.3-i*0.3)));
  assert.ok(grouped.length<=10);assert.equal(grouped.reduce((n,o)=>n+o.quantity,0),44);
  assert.ok(replacementBudgetMs(grouped.length,grouped.length,1,grouped.length,1100)<240000-45000);
  assert.ok(replacementBudgetMs(41,44,1,41,1100)>240000-45000);
});
