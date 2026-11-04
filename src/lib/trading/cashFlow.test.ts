import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCashFlow } from './cashFlow';
import { buildAssetValueHistory, buildAssetComparison, type StrategyAdjustment } from './assetHistory';
import type { StrategyState, CashFlow, Execution } from '@/lib/types';
const state: StrategyState = {id:'s',name:'test',symbol:'SOXL',splitCount:20,principal:1000,cashBalance:500,positionQty:5,avgPrice:80,tValue:10,mode:'normal',reverseStartedAt:null,reverseFirstSellDone:false};
const flow: CashFlow = {id:'f',strategy_id:'s',requested_date:'2026-09-03',amount:1000,timing:'immediate',status:'applied',applied_date:'2026-09-03',applied_round_id:null,reference_price:100,memo:'',created_at:'2026-09-03T01:00:00Z'};
const adjustment: StrategyAdjustment = {id:'f',effective_date:flow.requested_date,created_at:flow.created_at,kind:'cash_flow',reason:'',before_state:{principal:1000,cash_balance:500,position_qty:5,avg_price:80},after_state:{principal:2000,cash_balance:1500,position_qty:5,avg_price:80}};

test('즉시 입출금은 시장 평가 비중으로 T를 계산하고 보유수량·평단을 변경하지 않는다', () => {
  assert.deepEqual(calculateCashFlow(state,1000,100), {principal:2000,cashBalance:1500,tValue:5});
  assert.deepEqual(calculateCashFlow(state,-500,100), {principal:500,cashBalance:0,tValue:20});
  assert.equal(calculateCashFlow(state,500,200).tValue,10);
  assert.equal(state.avgPrice,80);
  assert.equal(calculateCashFlow({...state,positionQty:0},100).tValue,0);
  for (const amount of [0,NaN,Infinity,0.00001,-501,-1000]) assert.throws(()=>calculateCashFlow(state,amount,100));
  assert.throws(()=>calculateCashFlow(state,100),/종가/);
});

test('입금 이전 자산을 유지하고 실제 입금일에 반영하며 수익률에서 입금을 제외한다', () => {
  const execution: Execution={id:'e',strategy_id:'s',trade_plan_id:null,round_id:null,executed_at:'2026-09-01',created_at:'2026-09-01T01:00:00Z',side:'buy',order_type:'LOC',quantity:5,avg_execution_price:100,total_amount:500,t_effect:'buy_full',memo:null};
  const points=buildAssetValueHistory({currentCashBalance:1500,currentPositionQty:5,executions:[execution],snapshots:[],adjustments:[adjustment],cashFlows:[flow],candles:[],dailyPrices:['2026-09-01','2026-09-02','2026-09-03','2026-09-04'].map(trade_date=>({id:trade_date,strategy_id:'s',trade_date,close_price:100,created_at:''}))});
  assert.deepEqual(points.map(p=>p.accountValue),[1000,1000,2000,2000]);
  assert.deepEqual(buildAssetComparison(points).map(p=>p.accountChangePercent),[0,0,0,0]);
  assert.equal(points[2].cashFlowEvents?.[0].label,'입금');
});

test('미체결 전략의 입출금과 휴일 예약도 표시하고 예약은 자산을 바꾸지 않는다', () => {
  const points=buildAssetValueHistory({currentCashBalance:1500,currentPositionQty:0,executions:[],snapshots:[],adjustments:[{...adjustment,before_state:{cash_balance:500,position_qty:0},after_state:{cash_balance:1500,position_qty:0}}],cashFlows:[flow,{...flow,id:'p',requested_date:'2026-09-05',timing:'next_round',status:'pending',applied_date:null}],candles:[],dailyPrices:[]});
  assert.deepEqual(points.map(p=>[p.date,p.accountValue]),[['2026-09-03',1500],['2026-09-05',1500]]);
  assert.equal(points[1].cashFlowEvents?.[0].label,'입금 예약');
});

test('입출금 직후 수익과 손실은 달라진 자산을 기준으로 이어진다', () => {
  const template={date:'2026-09-01',accountValue:1000,cashBalance:500,positionValue:500,positionQty:5,closePrice:100,marketClosePrice:100};
  const points=[template,{...template,date:'2026-09-02',accountValue:2100,netCashFlow:1000},{...template,date:'2026-09-03',accountValue:2310},{...template,date:'2026-09-04',accountValue:1810,netCashFlow:-500}];
  assert.deepEqual(buildAssetComparison(points).map(p=>p.accountChangePercent),[0,10,21,21]);
});

test('같은 날 입금 뒤 수익과 라운드 종료 예약 반영을 각각의 평가액으로 연결한다', () => {
  const buy: Execution={id:'e',strategy_id:'s',trade_plan_id:null,round_id:null,executed_at:'2026-09-01',created_at:'2026-09-01T01:00:00Z',side:'buy',order_type:'LOC',quantity:5,avg_execution_price:100,total_amount:500,t_effect:'buy_full',memo:null};
  const sell: Execution={...buy,id:'sell',executed_at:'2026-09-03',created_at:'2026-09-03T02:00:00Z',side:'sell',avg_execution_price:120,total_amount:600};
  const application: StrategyAdjustment={...adjustment,id:'a2',created_at:'2026-09-03T02:00:01Z',before_state:{cash_balance:2100,position_qty:0},after_state:{cash_balance:2600,position_qty:0}};
  const points=buildAssetValueHistory({currentCashBalance:2600,currentPositionQty:0,executions:[buy,sell],snapshots:[],adjustments:[adjustment,application],cashFlows:[flow,{...flow,id:'pending',amount:500,timing:'next_round'}],candles:[],dailyPrices:['2026-09-01','2026-09-03'].map(trade_date=>({id:trade_date,strategy_id:'s',trade_date,close_price:100,created_at:''}))});
  assert.equal(points.at(-1)?.accountValue,2600);
  assert.equal(buildAssetComparison(points).at(-1)?.accountChangePercent,5);
});
