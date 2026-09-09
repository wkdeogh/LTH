import assert from 'node:assert/strict';
import test from 'node:test';
import { executionDateError, latestClosedMarketDate } from '@/lib/date';
import { buildAssetValueHistory, type StrategyAdjustment } from './assetHistory';
import type { Execution, DailyPrice } from '@/lib/types';

test('마감 기준일은 뉴욕 시간과 서머타임을 적용한다', () => {
  assert.equal(latestClosedMarketDate(new Date('2026-09-08T19:59:00Z')), '2026-09-07');
  assert.equal(latestClosedMarketDate(new Date('2026-09-08T20:01:00Z')), '2026-09-08');
  assert.equal(latestClosedMarketDate(new Date('2026-01-08T20:59:00Z')), '2026-01-07');
  assert.equal(latestClosedMarketDate(new Date('2026-01-08T21:01:00Z')), '2026-01-08');
  assert.equal(executionDateError('2026-09-08','2026-09-08','2026-09-08'), null);
  assert.match(executionDateError('2026-09-07','2026-09-08','2026-09-08')!, /이전 체결/);
  assert.match(executionDateError('2026-09-06',null,'2026-09-08')!, /주말/);
  assert.match(executionDateError('2026-09-09',null,'2026-09-08')!, /마감/);
  assert.match(executionDateError('2026-02-30',null,'2026-09-08')!, /확인/);
});
const execution: Execution = { id:'e',strategy_id:'s',trade_plan_id:null,round_id:null,executed_at:'2026-09-01',created_at:'2026-09-02T01:00:00Z',side:'buy',order_type:'LOC',quantity:2,avg_execution_price:100,total_amount:200,t_effect:'buy_full',memo:null };
const prices: DailyPrice[] = ['2026-09-01','2026-09-02','2026-09-03'].map(trade_date => ({id:trade_date,strategy_id:'s',trade_date,close_price:100,created_at:''}));
const correction: StrategyAdjustment = {id:'a',kind:'correction',effective_date:'2026-09-03',created_at:'2026-09-04T00:00:00Z',reason:'입금',before_state:{cash_balance:800,position_qty:2},after_state:{cash_balance:900,position_qty:2}};
test('보정일 이전 평가액은 보정 이후에도 변하지 않는다', () => {
  for (const snapshots of [[],[{execution_id:'e',cash_balance:1000,position_qty:0,after_cash_balance:800,after_position_qty:2}]]) {
    const points=buildAssetValueHistory({currentCashBalance:900,currentPositionQty:2,executions:[execution],snapshots,candles:[],dailyPrices:prices,adjustments:[correction]});
    assert.deepEqual(points.map(p=>p.accountValue),[1000,1000,1100]);
  }
});
test('기존 보정 기준점과 새 보정은 각각 적용일에만 반영된다', () => {
  const baseline: StrategyAdjustment={...correction,id:'b',kind:'baseline',effective_date:'2026-09-01',created_at:'2026-09-02T02:00:00Z',before_state:{cash_balance:850,position_qty:2},after_state:{cash_balance:850,position_qty:2}};
  const points=buildAssetValueHistory({currentCashBalance:900,currentPositionQty:2,executions:[execution],snapshots:[{execution_id:'e',cash_balance:1000,position_qty:0}],candles:[],dailyPrices:prices,adjustments:[baseline,correction]});
  assert.deepEqual(points.map(p=>p.accountValue),[1050,1050,1100]);
});
test('체결 후 수량 보정과 종가 없는 보정일을 유지한다', () => {
 const points=buildAssetValueHistory({currentCashBalance:900,currentPositionQty:3,executions:[execution],snapshots:[{execution_id:'e',cash_balance:1000,position_qty:0,after_cash_balance:800,after_position_qty:3}],candles:[],dailyPrices:prices,adjustments:[{...correction,effective_date:'2026-09-05',after_state:{cash_balance:900,position_qty:3}}]});
 assert.deepEqual(points.map(p=>p.accountValue),[1100,1100,1100,1200]);
 assert.equal(points.at(-1)?.marketClosePrice,null);
});
