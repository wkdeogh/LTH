import assert from 'node:assert/strict';
import test from 'node:test';
import type { StrategyState } from '@/lib/types';
import {
  applyTEffect,
  buildMarketReferenceHistory,
  calculateAccountPerformance,
  calculateFiveDayAverage,
  calculateNormalPlan,
  calculateOneUnitBudget,
  calculatePositionPerformance,
  calculateReferenceAverage,
  calculateRoundPerformance,
  calculateStarPercent,
  detectNormalPhase,
  reverseSellQuantity,
  shouldReturnToNormalMode,
} from '@/lib/trading';
import { roundMoney, roundPrice } from '@/lib/trading/rounding';

function state(overrides: Partial<StrategyState> = {}): StrategyState {
  return {
    id: 'test',
    name: '테스트',
    symbol: 'TQQQ',
    splitCount: 40,
    principal: 20_000,
    cashBalance: 20_000,
    positionQty: 0,
    avgPrice: 0,
    tValue: 0,
    mode: 'normal',
    reverseStartedAt: null,
    reverseFirstSellDone: false,
    ...overrides,
  };
}

test('금액과 주문가격을 경계값에서도 올바르게 반올림한다', () => {
  assert.equal(roundPrice(1.005), 1.01);
  assert.equal(roundPrice(39.3724), 39.37);
  assert.equal(roundMoney(500.5641025641), 500.5641);
});

test('문서의 SOXL 20분할 별지점 예시가 일치한다', () => {
  const starPercent = calculateStarPercent('SOXL', 20, 8.6);
  assert.ok(Math.abs(starPercent - 0.028) < 1e-12);

  const plan = calculateNormalPlan(state({
    symbol: 'SOXL',
    splitCount: 20,
    cashBalance: 5_700,
    positionQty: 100,
    avgPrice: 38.3,
    tValue: 8.6,
  }));

  assert.equal(plan.starPrice, 39.37);
  assert.equal(plan.buyPrice, 39.36);
  assert.equal(plan.sellOrders[0].quantity, 25);
  assert.equal(plan.sellOrders[1].quantity, 75);
  assert.equal(plan.targetSellPrice, 45.96);
});

test('남은 현금과 T값으로 다음 1회 매수금을 계산한다', () => {
  assert.equal(calculateOneUnitBudget(state({ cashBalance: 19_522, tValue: 1 })), 500.5641);
});

test('일반모드 구간 경계와 리버스 전환 기준이 정확하다', () => {
  assert.equal(detectNormalPhase(state({ splitCount: 20, positionQty: 10, tValue: 9.999999 })), 'first_half');
  assert.equal(detectNormalPhase(state({ splitCount: 20, positionQty: 10, tValue: 10 })), 'second_half');
  assert.equal(detectNormalPhase(state({ splitCount: 20, positionQty: 10, tValue: 19 })), 'second_half');
  assert.equal(detectNormalPhase(state({ splitCount: 20, positionQty: 10, tValue: 19.0000001 })), 'reverse_required');
});

test('일반·리버스 체결별 T값 공식이 일치한다', () => {
  assert.equal(applyTEffect(7, 'buy_full', 20), 8);
  assert.equal(applyTEffect(7, 'buy_half', 20), 7.5);
  assert.equal(applyTEffect(7, 'quarter_sell', 20), 5.25);
  assert.equal(applyTEffect(7, 'limit_sell_then_full_buy', 20), 2.75);
  assert.equal(applyTEffect(7, 'limit_sell_then_half_buy', 20), 2.25);
  assert.equal(applyTEffect(39.5, 'reverse_sell', 40), 37.525);
  assert.equal(applyTEffect(37.525, 'reverse_buy', 40), 38.14375);
});

test('리버스 5일 평균, 매도수량, 복귀 경계를 정확히 계산한다', () => {
  assert.equal(calculateFiveDayAverage([40, 39, 38, 37, 36]), 38);
  assert.equal(reverseSellQuantity(state({ splitCount: 40, positionQty: 198 })), 9);
  assert.equal(reverseSellQuantity(state({ splitCount: 20, positionQty: 198 })), 19);
  assert.equal(shouldReturnToNormalMode(state({ avgPrice: 40 }), 34), false);
  assert.equal(shouldReturnToNormalMode(state({ avgPrice: 40 }), 34.01), true);
  assert.equal(shouldReturnToNormalMode(state({ symbol: 'SOXL', avgPrice: 40 }), 32), false);
  assert.equal(shouldReturnToNormalMode(state({ symbol: 'SOXL', avgPrice: 40 }), 32.01), true);
});

test('직접 종가를 우선하고 없는 날짜는 최신 체결가를 사용한다', () => {
  const history = buildMarketReferenceHistory(
    [
      { trade_date: '2026-07-17', close_price: 102 },
      { trade_date: '2026-07-15', close_price: 98 },
    ],
    [
      { executed_at: '2026-07-18', avg_execution_price: 105, created_at: '2026-07-18T02:00:00Z' },
      { executed_at: '2026-07-17', avg_execution_price: 101, created_at: '2026-07-17T02:00:00Z' },
      { executed_at: '2026-07-18', avg_execution_price: 104, created_at: '2026-07-18T01:00:00Z' },
    ],
  );

  assert.deepEqual(history, [
    { date: '2026-07-18', price: 105, source: 'execution' },
    { date: '2026-07-17', price: 102, source: 'saved_close' },
    { date: '2026-07-15', price: 98, source: 'saved_close' },
  ]);
});

test('현재 수익률과 평가손익은 평단 기준으로 계산한다', () => {
  assert.deepEqual(calculatePositionPerformance(10, 100, 110), {
    marketValue: 1100,
    profitAmount: 100,
    profitRate: 10,
  });
  assert.deepEqual(calculatePositionPerformance(10, 100, 90), {
    marketValue: 900,
    profitAmount: -100,
    profitRate: -10,
  });
  assert.equal(calculatePositionPerformance(0, 100, 110).profitRate, null);
});

test('현금과 보유분 평가액을 합쳐 현재 라운드 계좌 전체 수익률을 계산한다', () => {
  assert.deepEqual(calculateAccountPerformance(20_000, 9_000, 100, 120), {
    accountValue: 21_000,
    profitAmount: 1_000,
    profitRate: 5,
  });
  assert.deepEqual(calculateAccountPerformance(20_000, 19_000, 0), {
    accountValue: 19_000,
    profitAmount: -1_000,
    profitRate: -5,
  });
  assert.equal(calculateAccountPerformance(20_000, 9_000, 100).profitRate, null);
});

test('최근 계산 기준가 5개만 평균에 사용한다', () => {
  const references = [110, 105, 100, 95, 90, 10].map((price, index) => ({
    date: `2026-07-${20 - index}`,
    price,
    source: 'saved_close' as const,
  }));
  assert.equal(calculateReferenceAverage(references), 100);
  assert.equal(calculateReferenceAverage([]), null);
});

test('완료 기록 수정 시 수익금과 수익률을 시작 원금 기준으로 다시 계산한다', () => {
  assert.deepEqual(calculateRoundPerformance(20_000, 21_234.5678), {
    profitAmount: 1234.5678,
    profitRate: 6.172839,
  });
  assert.deepEqual(calculateRoundPerformance(20_000, 19_000), {
    profitAmount: -1000,
    profitRate: -5,
  });
  assert.throws(() => calculateRoundPerformance(0, 10_000));
});
