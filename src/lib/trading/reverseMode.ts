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

export function calculateReverseReturnPrice(avgPrice: number) {
  return Number.isFinite(avgPrice) && avgPrice > 0 ? avgPrice * 0.8 : null;
}

export function shouldReturnToNormalMode(
  state: Pick<StrategyState, 'symbol' | 'avgPrice'>,
  closePrice?: number,
) {
  const returnPrice = calculateReverseReturnPrice(state.avgPrice);
  return Boolean(closePrice && returnPrice !== null && closePrice > returnPrice);
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
  const buyPrice = referencePrice !== null && referencePrice > 0.01
    ? roundPrice(referencePrice - 0.01)
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
  formulas.push('리버스 매수 수량 = floor(매수금 / (별지점 − 0.01))');

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
        note: '별지점 − $0.01에 현금의 1/4로 LOC 매수합니다.',
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
