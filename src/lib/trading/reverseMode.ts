import type { StrategyState } from '@/lib/types';
import { floorShares, roundMoney, roundPrice } from '@/lib/trading/rounding';
import type { OrderGuide } from '@/lib/trading/normalMode';

export type ReversePlan = {
  kind: 'reverse';
  isFirstDay: boolean;
  referencePrice: number | null;
  buyBudget: number;
  buyOrders: OrderGuide[];
  sellOrders: OrderGuide[];
  returnToNormal: boolean;
  warnings: string[];
  formulas: string[];
};

export function calculateFiveDayAverage(closes: number[]) {
  if (closes.length < 5) return null;
  const latestFive = closes.slice(0, 5);
  if (latestFive.some((close) => !Number.isFinite(close) || close <= 0)) return null;
  return roundPrice(latestFive.reduce((sum, close) => sum + close, 0) / 5);
}

export function reverseSellQuantity(state: StrategyState) {
  return floorShares(state.positionQty / 10);
}

export function shouldReturnToNormalMode(
  state: Pick<StrategyState, 'symbol' | 'avgPrice'>,
  closePrice?: number,
) {
  if (!closePrice || state.avgPrice <= 0) return false;
  return closePrice > state.avgPrice * 0.8;
}

export function shouldAutoReturnToNormalMode(
  state: Pick<StrategyState, 'mode' | 'symbol' | 'avgPrice' | 'reverseFirstSellDone'>,
  closePrice?: number,
) {
  return state.mode === 'reverse'
    && state.reverseFirstSellDone
    && shouldReturnToNormalMode(state, closePrice);
}

export function calculateReversePlan(state: StrategyState, recentCloses: number[], closePrice?: number): ReversePlan {
  const referencePrice = calculateFiveDayAverage(recentCloses);
  const buyReference = referencePrice === null ? null : Math.min(recentCloses[0], referencePrice);
  // LOC can fill at the limit. Keep the buy limit strictly below both references.
  const buyPrice = buyReference && buyReference > 0.01
    ? (Math.ceil(buyReference * 100 - 1e-9) - 1) / 100
    : null;
  const isFirstDay = !state.reverseFirstSellDone;
  const warnings: string[] = [];
  const formulas: string[] = [];
  const sellQty = reverseSellQuantity(state);
  const buyBudget = roundMoney(state.cashBalance * 0.25);
  const buyQuantity = buyPrice ? floorShares(buyBudget / buyPrice) : 0;
  const isExhausted = buyPrice !== null && buyQuantity === 0;
  const returnToNormal = shouldAutoReturnToNormalMode(state, closePrice);

  if (!referencePrice && !isFirstDay) {
    warnings.push('직전 5거래일 종가가 모두 있어야 리버스 LOC 주문을 계산할 수 있습니다.');
  }

  formulas.push('리버스 별지점 = 직전 5거래일 종가의 평균');
  formulas.push('리버스 매도수량 = floor(보유수량 / 10)');
  formulas.push('리버스 매수금 = 현재 현금 × 0.25');
  formulas.push('리버스 매수 수량 = floor(매수금 / 매수 한도가)');

  if (isFirstDay || isExhausted) {
    return {
      kind: 'reverse',
      isFirstDay,
      referencePrice,
      buyBudget,
      buyOrders: [],
      sellOrders: [
        {
          label: isFirstDay ? '리버스모드 첫날 매도' : '리버스모드 매도',
          side: 'sell',
          orderType: 'MOC',
          price: null,
          quantity: sellQty,
          note: '보유수량의 1/10을 MOC 매도합니다.',
        },
      ],
      returnToNormal,
      warnings,
      formulas,
    };
  }

  return {
    kind: 'reverse',
    isFirstDay,
    referencePrice,
    buyBudget,
    buyOrders: buyPrice ? [
      {
        label: '리버스모드 매수',
        side: 'buy',
        orderType: 'LOC',
        price: buyPrice,
        quantity: buyQuantity,
        amount: buyBudget,
        note: '전 거래일 종가와 별지점 중 낮은 가격 바로 아래에 현금의 1/4로 LOC 매수합니다.',
      },
    ] : [],
    sellOrders: referencePrice ? [
      {
        label: '리버스모드 매도',
        side: 'sell',
        orderType: 'LOC',
        price: referencePrice,
        quantity: sellQty,
        note: '종가가 별지점보다 높을 때 일부 수량을 LOC 매도합니다.',
      },
    ] : [],
    returnToNormal,
    warnings,
    formulas,
  };
}
