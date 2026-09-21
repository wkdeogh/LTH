import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDualSellExecution } from './dualSellExecution';
import type { StrategyState } from '@/lib/types';

const state: StrategyState = {
  id: 'test', name: 'test', symbol: 'SOXL', splitCount: 20, principal: 10000,
  cashBalance: 2000, positionQty: 100, avgPrice: 80, tValue: 12, mode: 'normal',
  reverseStartedAt: null, reverseFirstSellDone: false,
};

test('지정가 75주와 LOC 25주의 서로 다른 체결가를 보존하고 전량매도한다', () => {
  const result = calculateDualSellExecution(state, 75, 96, 25, 98);
  assert.equal(result.totalAmount, 9650);
  assert.equal(result.finalT, 0);
  assert.equal(result.effect, 'full_sell');
  assert.deepEqual(result.legs.map(leg => [leg.order_type, leg.avg_execution_price, leg.quantity]), [['LIMIT', 96, 75], ['LOC', 98, 25]]);
  assert.equal(result.snapshots[0].position_qty, 100);
  assert.equal(result.snapshots[1].position_qty, 25);
  assert.equal(result.snapshots[1].after_position_qty, 0);
  assert.equal(result.snapshots[1].after_cash_balance, 11650);
});

test('일부만 체결되면 잔여 수량을 유지하고 쿼터 T 효과는 한 번 반영한다', () => {
  const result = calculateDualSellExecution(state, 30, 96, 25, 98);
  assert.equal(result.snapshots[1].after_position_qty, 45);
  assert.equal(result.finalT, 9);
  assert.deepEqual(result.legs.map(leg => leg.t_effect), ['none', 'quarter_sell']);
});

test('매도 금액은 각 체결별로 반올림한 뒤 합산한다', () => {
  const result = calculateDualSellExecution(state, 1, 10.00004, 1, 10.00004);
  assert.equal(result.totalAmount, 20);
});

test('보유수량 초과, 소수 수량, 비정상 가격, 리버스모드는 거부한다', () => {
  for (const args of [[76,96,25,98],[1.5,96,25,98],[0,96,25,98],[75,NaN,25,98],[75,96,25,Infinity],[75,96,25,0]]) {
    assert.throws(() => calculateDualSellExecution(state, ...args as [number,number,number,number]));
  }
  assert.throws(() => calculateDualSellExecution({...state,mode:'reverse'},75,96,25,98));
});
