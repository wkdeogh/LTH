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
  return roundPrice(latestFive.reduce((sum, close) => sum + close, 0) / 5);
}

export function reverseSellQuantity(state: StrategyState) {
  return floorShares(state.positionQty / (state.splitCount === 20 ? 10 : 20));
}

export function shouldReturnToNormalMode(state: StrategyState, closePrice?: number) {
  if (!closePrice || state.avgPrice <= 0) return false;
  return state.symbol === 'TQQQ' ? closePrice > state.avgPrice * 0.85 : closePrice > state.avgPrice * 0.8;
}

export function calculateReversePlan(state: StrategyState, recentCloses: number[], closePrice?: number): ReversePlan {
  const referencePrice = calculateFiveDayAverage(recentCloses);
  const isFirstDay = !state.reverseFirstSellDone;
  const warnings: string[] = [];
  const formulas: string[] = [];
  const sellQty = reverseSellQuantity(state);
  const buyBudget = roundMoney(state.cashBalance * 0.25);
  const returnToNormal = shouldReturnToNormalMode(state, closePrice);

  if (!referencePrice && !isFirstDay) {
    warnings.push('리버스모드 둘째 날 이후 계산에는 최근 5거래일 종가가 필요합니다.');
  }

  formulas.push(`리버스 매도수량 = floor(보유수량 / ${state.splitCount === 20 ? 10 : 20})`);
  formulas.push('리버스 매수금 = 현재 현금 × 0.25');
  formulas.push('매수 수량 = 매수금 / 리버스 기준가');

  if (isFirstDay) {
    return {
      kind: 'reverse',
      isFirstDay,
      referencePrice,
      buyBudget,
      buyOrders: [],
      sellOrders: [
        {
          label: '리버스모드 첫날 매도',
          side: 'sell',
          orderType: 'MOC',
          price: null,
          quantity: sellQty,
          note: `${state.splitCount}분할 기준 보유수량의 ${state.splitCount === 20 ? '1/10' : '1/20'}을 MOC 매도합니다.`,
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
    buyOrders: [
      {
        label: '리버스모드 매수',
        side: 'buy',
        orderType: 'MANUAL',
        price: referencePrice,
        quantity: referencePrice ? floorShares(buyBudget / referencePrice) : 0,
        amount: buyBudget,
        note: '종가 또는 현재가가 리버스 기준가보다 낮을 때 현금의 1/4로 매수합니다.',
      },
    ],
    sellOrders: [
      {
        label: '리버스모드 매도',
        side: 'sell',
        orderType: 'MANUAL',
        price: referencePrice,
        quantity: sellQty,
        note: '종가 또는 현재가가 리버스 기준가보다 높을 때 일부 매도합니다.',
      },
    ],
    returnToNormal,
    warnings,
    formulas,
  };
}
