import assert from 'node:assert/strict';
import test from 'node:test';
import type { StrategyState } from '@/lib/types';
import {
  applyTEffect,
  buildMarketReferenceHistory,
  buildDownsideBuyOrders,
  buildAssetValueHistory,
  calculateAccountPerformance,
  calculateFiveDayAverage,
  calculateNormalPlan,
  calculateOneUnitBudget,
  calculatePositionPerformance,
  calculateReferenceAverage,
  calculateReversePlan,
  calculateRoundPerformance,
  calculateStarPercent,
  detectNormalPhase,
  inferExecutionDefaultsFromClose,
  reverseSellQuantity,
  shouldAutoEnterReverseMode,
  shouldAutoReturnToNormalMode,
  shouldReturnToNormalMode,
} from '@/lib/trading';
import { floorPrice, roundMoney, roundPrice } from '@/lib/trading/rounding';
import { koreaDate } from '@/lib/date';

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
  assert.equal(floorPrice(44.9358), 44.93);
  assert.equal(roundPrice(1.005), 1.01);
  assert.equal(roundPrice(39.3724), 39.37);
  assert.equal(roundMoney(500.5641025641), 500.5641);
});

test('전반전 하락 보완 주문이 예시 표와 같은 가격과 수량으로 계산된다', () => {
  const plan = calculateNormalPlan(state({
    cashBalance: 19_412.28,
    positionQty: 100,
    avgPrice: 69.75,
    tValue: 4,
  }));

  assert.equal(plan.oneUnitBudget, 539.23);
  assert.deepEqual(plan.buyOrders.slice(0, 2).map(({ price, quantity }) => ({ price, quantity })), [
    { price: 78.11, quantity: 3 },
    { price: 69.75, quantity: 4 },
  ]);
  assert.deepEqual(
    plan.buyOrders.filter((order) => order.isSupplemental).map(({ price, quantity }) => ({ price, quantity })),
    [67.4, 59.91, 53.92, 49.02, 44.93, 41.47, 38.51].map((price) => ({ price, quantity: 1 })),
  );
  assert.deepEqual(inferExecutionDefaultsFromClose(plan, 70), {
    side: 'buy', orderType: 'LOC', quantity: 3, tEffect: 'buy_half',
  });
  assert.deepEqual(inferExecutionDefaultsFromClose(plan, 67.4), {
    side: 'buy', orderType: 'LOC', quantity: 8, tEffect: 'buy_full',
  });
  assert.equal(buildDownsideBuyOrders(539.23, 7).length, 7);
  assert.deepEqual(buildDownsideBuyOrders(617.89, 12).slice(0, 2).map((order) => order.price), [47.53, 44.13]);
});

test('체결 후 현금과 보유수량을 종가에 반영해 일별 계좌 평가액을 만든다', () => {
  const executions = [
    {
      id: 'buy-1', strategy_id: 'test', trade_plan_id: null, round_id: null,
      executed_at: '2026-07-01', side: 'buy' as const, order_type: 'LOC' as const,
      quantity: 2, avg_execution_price: 100, total_amount: 200,
      t_effect: 'buy_full' as const, memo: null, created_at: '2026-07-02T00:00:00Z',
    },
    {
      id: 'buy-2', strategy_id: 'test', trade_plan_id: null, round_id: null,
      executed_at: '2026-07-02', side: 'buy' as const, order_type: 'LOC' as const,
      quantity: 1, avg_execution_price: 90, total_amount: 90,
      t_effect: 'buy_full' as const, memo: null, created_at: '2026-07-03T00:00:00Z',
    },
  ];
  const points = buildAssetValueHistory({
    currentCashBalance: 710,
    currentPositionQty: 3,
    executions,
    snapshots: [
      { execution_id: 'buy-1', cash_balance: 1000, position_qty: 0 },
      { execution_id: 'buy-2', cash_balance: 800, position_qty: 2 },
    ],
    candles: [
      { symbol: 'TQQQ', trade_date: '2026-07-01', open_price: 100, high_price: 112, low_price: 99, close_price: 110, adjusted_close: 110, volume: 1000 },
      { symbol: 'TQQQ', trade_date: '2026-07-02', open_price: 95, high_price: 98, low_price: 90, close_price: 95, adjusted_close: 95, volume: 1000 },
      { symbol: 'TQQQ', trade_date: '2026-07-03', open_price: 98, high_price: 101, low_price: 97, close_price: 100, adjusted_close: 100, volume: 1000 },
    ],
    dailyPrices: [{ id: 'price-1', strategy_id: 'test', trade_date: '2026-07-02', close_price: 96, created_at: '2026-07-03T00:00:00Z' }],
  });

  assert.deepEqual(points, [
    { date: '2026-07-01', accountValue: 1020, cashBalance: 800, positionValue: 220, positionQty: 2, closePrice: 110 },
    { date: '2026-07-02', accountValue: 998, cashBalance: 710, positionValue: 288, positionQty: 3, closePrice: 96 },
    { date: '2026-07-03', accountValue: 1010, cashBalance: 710, positionValue: 300, positionQty: 3, closePrice: 100 },
  ]);
});

test('체결일 기본값은 한국시간 기준 어제 날짜다', () => {
  assert.equal(koreaDate(-1, new Date('2026-07-23T15:30:00.000Z')), '2026-07-23');
  assert.equal(koreaDate(-1, new Date('2026-07-23T14:30:00.000Z')), '2026-07-22');
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

test('일반모드 체결 후 T값이 기준을 넘으면 리버스모드로 자동 전환한다', () => {
  assert.equal(shouldAutoEnterReverseMode({
    currentMode: 'normal', requestedMode: 'normal', nextTValue: 19, splitCount: 20,
  }), false);
  assert.equal(shouldAutoEnterReverseMode({
    currentMode: 'normal', requestedMode: 'normal', nextTValue: 19.0000001, splitCount: 20,
  }), true);
  assert.equal(shouldAutoEnterReverseMode({
    currentMode: 'reverse', requestedMode: 'reverse', nextTValue: 39.5, splitCount: 40,
  }), false);
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

test('리버스모드에서는 첫날 매도 여부와 관계없이 일반모드 복귀를 판단한다', () => {
  assert.equal(shouldAutoReturnToNormalMode(state({
    mode: 'reverse', avgPrice: 40, reverseFirstSellDone: false,
  }), 34.01), true);
  assert.equal(shouldAutoReturnToNormalMode(state({
    mode: 'reverse', avgPrice: 40, reverseFirstSellDone: true,
  }), 34.01), true);
  assert.equal(shouldAutoReturnToNormalMode(state({
    mode: 'normal', avgPrice: 40, reverseFirstSellDone: true,
  }), 34.01), false);
  assert.equal(shouldAutoReturnToNormalMode(state({
    mode: 'reverse', symbol: 'SOXL', avgPrice: 40, reverseFirstSellDone: true,
  }), 32), false);
  assert.equal(shouldAutoReturnToNormalMode(state({
    mode: 'reverse', symbol: 'SOXL', avgPrice: 40, reverseFirstSellDone: true,
  }), 32.01), true);
});

test('리버스 주문은 첫날 매도만 MOC이고 둘째 날부터 매수·매도 모두 LOC다', () => {
  const firstDayPlan = calculateReversePlan(
    state({ mode: 'reverse', positionQty: 200, reverseFirstSellDone: false }),
    [40, 39, 38, 37, 36],
  );
  assert.equal(firstDayPlan.sellOrders[0]?.orderType, 'MOC');
  assert.equal(firstDayPlan.buyOrders.length, 0);

  const laterPlan = calculateReversePlan(
    state({ mode: 'reverse', positionQty: 200, reverseFirstSellDone: true }),
    [40, 39, 38, 37, 36],
  );
  assert.equal(laterPlan.buyOrders[0]?.orderType, 'LOC');
  assert.equal(laterPlan.sellOrders[0]?.orderType, 'LOC');
});

test('일반모드 체결 입력 기본값을 종가와 주문 가이드로 자동 결정한다', () => {
  const plan = calculateNormalPlan(state({
    symbol: 'SOXL',
    splitCount: 20,
    cashBalance: 5_700,
    positionQty: 100,
    avgPrice: 38.3,
    tValue: 8.6,
  }), 39);

  assert.deepEqual(inferExecutionDefaultsFromClose(plan, 39), {
    side: 'buy', orderType: 'LOC', quantity: 6, tEffect: 'buy_half',
  });
  assert.deepEqual(inferExecutionDefaultsFromClose(plan, 38), {
    side: 'buy', orderType: 'LOC', quantity: 13, tEffect: 'buy_full',
  });
  assert.deepEqual(inferExecutionDefaultsFromClose(plan, 35), {
    side: 'buy', orderType: 'LOC', quantity: 14, tEffect: 'buy_full',
  });
  assert.deepEqual(inferExecutionDefaultsFromClose(plan, 40), {
    side: 'sell', orderType: 'LOC', quantity: 25, tEffect: 'quarter_sell',
  });
  assert.deepEqual(inferExecutionDefaultsFromClose(plan, 46), {
    side: 'sell', orderType: 'LIMIT', quantity: 100, tEffect: 'full_sell',
  });
});

test('리버스모드 체결 입력 기본값을 첫날과 5일 평균 기준으로 자동 결정한다', () => {
  const reverseState = state({
    mode: 'reverse', splitCount: 20, cashBalance: 4_000, positionQty: 200, tValue: 19.5,
  });
  const firstDayPlan = calculateReversePlan(reverseState, [40, 39, 38, 37, 36], 37);
  assert.deepEqual(inferExecutionDefaultsFromClose(firstDayPlan, 37), {
    side: 'sell', orderType: 'MOC', quantity: 20, tEffect: 'reverse_sell',
  });

  const laterPlan = calculateReversePlan(
    { ...reverseState, reverseFirstSellDone: true },
    [40, 39, 38, 37, 36],
    37,
  );
  assert.deepEqual(inferExecutionDefaultsFromClose(laterPlan, 37), {
    side: 'buy', orderType: 'LOC', quantity: 26, tEffect: 'reverse_buy',
  });
  assert.deepEqual(inferExecutionDefaultsFromClose(laterPlan, 39), {
    side: 'sell', orderType: 'LOC', quantity: 20, tEffect: 'reverse_sell',
  });
  assert.equal(inferExecutionDefaultsFromClose(laterPlan, 38), null);
});

test('차트 종가를 사용하고 같은 날짜의 직접 입력 종가를 우선한다', () => {
  const history = buildMarketReferenceHistory(
    [
      { trade_date: '2026-07-17', close_price: 102 },
      { trade_date: '2026-07-15', close_price: 98 },
    ],
    [
      { trade_date: '2026-07-18', close_price: 105 },
      { trade_date: '2026-07-17', close_price: 101 },
    ],
  );

  assert.deepEqual(history, [
    { date: '2026-07-18', price: 105, source: 'market_close' },
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
