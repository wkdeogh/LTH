import type { StrategyState, SymbolCode } from '@/lib/types';
import { floorShares, roundMoney, roundPrice } from '@/lib/trading/rounding';

export type NormalPhase = 'initial' | 'first_half' | 'second_half' | 'reverse_required';

export type OrderGuide = {
  label: string;
  side: 'buy' | 'sell';
  orderType: 'LOC' | 'MOC' | 'LIMIT' | 'MANUAL';
  price: number | null;
  quantity: number;
  amount?: number;
  note: string;
};

export type NormalPlan = {
  kind: 'normal';
  phase: NormalPhase;
  oneUnitBudget: number;
  starPercent: number | null;
  starPrice: number | null;
  buyPrice: number | null;
  targetSellPrice: number | null;
  buyOrders: OrderGuide[];
  sellOrders: OrderGuide[];
  warnings: string[];
  formulas: string[];
};

export function calculateStarPercent(symbol: SymbolCode, splitCount: 20 | 40, tValue: number) {
  if (symbol === 'TQQQ' && splitCount === 20) return (15 - 1.5 * tValue) / 100;
  if (symbol === 'TQQQ' && splitCount === 40) return (15 - 0.75 * tValue) / 100;
  if (splitCount === 20) return (20 - 2 * tValue) / 100;
  return (20 - tValue) / 100;
}

export function calculateOneUnitBudget(state: StrategyState) {
  const remainingTurns = state.splitCount - state.tValue;
  if (remainingTurns <= 0) return 0;
  return roundMoney(state.cashBalance / remainingTurns);
}

export function detectNormalPhase(state: StrategyState): NormalPhase {
  if (state.positionQty === 0 && state.tValue === 0) return 'initial';
  if (state.tValue > state.splitCount - 1) return 'reverse_required';
  if (state.tValue < state.splitCount / 2) return 'first_half';
  return 'second_half';
}

export function calculateTargetSellPrice(symbol: SymbolCode, avgPrice: number) {
  return roundPrice(avgPrice * (symbol === 'TQQQ' ? 1.15 : 1.2));
}

export function calculateNormalPlan(state: StrategyState, referencePrice?: number): NormalPlan {
  const phase = detectNormalPhase(state);
  const warnings: string[] = [];
  const formulas: string[] = [];
  const oneUnitBudget = phase === 'initial' ? roundMoney(state.principal / state.splitCount) : calculateOneUnitBudget(state);

  if (state.splitCount - state.tValue <= 1 && phase !== 'initial') {
    warnings.push('잔여 회차가 1회 이하입니다. 리버스모드 전환 대상입니다.');
  }

  if (state.positionQty > 0 && state.avgPrice <= 0) {
    warnings.push('보유수량이 있는데 평단이 0입니다. 증권사 기준 평단을 입력해야 합니다.');
  }

  if (phase === 'reverse_required') {
    return {
      kind: 'normal',
      phase,
      oneUnitBudget,
      starPercent: null,
      starPrice: null,
      buyPrice: null,
      targetSellPrice: null,
      buyOrders: [],
      sellOrders: [],
      warnings: ['T값이 리버스모드 전환 기준을 초과했습니다. 리버스모드 전환을 확인하세요.'],
      formulas: [`${state.splitCount}분할 리버스 전환 기준: T > ${state.splitCount - 1}`],
    };
  }

  if (phase === 'initial') {
    const price = referencePrice && referencePrice > 0 ? roundPrice(referencePrice * 1.12) : null;
    const quantity = price ? floorShares(oneUnitBudget / price) : 0;

    formulas.push(`초기 1회 매수금 = 원금 / 분할 수 = ${state.principal} / ${state.splitCount}`);
    formulas.push('수량 = 매수금 / 주문가격');

    return {
      kind: 'normal',
      phase,
      oneUnitBudget,
      starPercent: null,
      starPrice: null,
      buyPrice: price,
      targetSellPrice: null,
      buyOrders: [
        {
          label: '첫 매수',
          side: 'buy',
          orderType: 'LOC',
          price,
          quantity,
          amount: oneUnitBudget,
          note: referencePrice ? '참고가보다 12% 높은 LOC 매수 가이드입니다.' : '참고가를 입력하면 예상 수량을 계산합니다.',
        },
      ],
      sellOrders: [],
      warnings,
      formulas,
    };
  }

  const starPercent = calculateStarPercent(state.symbol, state.splitCount, state.tValue);
  const starPrice = roundPrice(state.avgPrice * (1 + starPercent));
  const buyPrice = roundPrice(starPrice - 0.01);
  const targetSellPrice = calculateTargetSellPrice(state.symbol, state.avgPrice);
  const quarterSellQty = floorShares(state.positionQty / 4);
  const finalSellQty = Math.max(state.positionQty - quarterSellQty, 0);
  const buyOrders: OrderGuide[] = [];

  formulas.push(`별% = ${starPercent * 100}%`);
  formulas.push(`별지점 = 평단 × (1 + 별%) = ${state.avgPrice} × ${1 + starPercent}`);
  formulas.push(`1회 매수금 = 현금 / (${state.splitCount} - T) = ${state.cashBalance} / ${state.splitCount - state.tValue}`);
  formulas.push('매수 수량 = 배정금액 / 주문가격');

  if (phase === 'first_half') {
    const halfBudget = roundMoney(oneUnitBudget / 2);
    buyOrders.push({
      label: '전반전 별지점 매수',
      side: 'buy',
      orderType: 'LOC',
      price: buyPrice,
      quantity: floorShares(halfBudget / buyPrice),
      amount: halfBudget,
      note: '1회 매수금의 절반을 별지점 - 0.01에 배정합니다.',
    });
    buyOrders.push({
      label: '전반전 평단 매수',
      side: 'buy',
      orderType: 'LOC',
      price: roundPrice(state.avgPrice),
      quantity: floorShares(halfBudget / state.avgPrice),
      amount: halfBudget,
      note: '1회 매수금의 절반을 평단에 배정합니다.',
    });
  } else {
    buyOrders.push({
      label: '후반전 별지점 매수',
      side: 'buy',
      orderType: 'LOC',
      price: buyPrice,
      quantity: floorShares(oneUnitBudget / buyPrice),
      amount: oneUnitBudget,
      note: '후반전은 1회 매수금 전체를 별지점 - 0.01에 배정합니다.',
    });
  }

  return {
    kind: 'normal',
    phase,
    oneUnitBudget,
    starPercent,
    starPrice,
    buyPrice,
    targetSellPrice,
    buyOrders,
    sellOrders: [
      {
        label: '쿼터매도',
        side: 'sell',
        orderType: 'LOC',
        price: starPrice,
        quantity: quarterSellQty,
        note: '보유수량의 1/4을 별지점에 LOC 매도합니다.',
      },
      {
        label: '최종 지정가 매도',
        side: 'sell',
        orderType: 'LIMIT',
        price: targetSellPrice,
        quantity: finalSellQty,
        note: state.symbol === 'TQQQ' ? '평단 +15% 지정가 매도입니다.' : 'SOXL/RAM 기준 평단 +20% 지정가 매도입니다.',
      },
    ],
    warnings,
    formulas,
  };
}
