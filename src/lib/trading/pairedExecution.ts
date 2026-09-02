import type { StrategyState, TEffect } from '@/lib/types';
import { roundMoney } from '@/lib/trading/rounding';
import { applyTEffect } from '@/lib/trading/tValue';

export type PairedExecutionEffect = Extract<
  TEffect,
  'limit_sell_then_full_buy' | 'limit_sell_then_half_buy'
>;

export function calculatePairedExecutionState({
  state,
  sellQuantity,
  sellPrice,
  buyQuantity,
  buyPrice,
  effect,
}: {
  state: StrategyState;
  sellQuantity: number;
  sellPrice: number;
  buyQuantity: number;
  buyPrice: number;
  effect: PairedExecutionEffect;
}) {
  const sellAmount = roundMoney(sellQuantity * sellPrice);
  const buyAmount = roundMoney(buyQuantity * buyPrice);
  const positionAfterSell = state.positionQty - sellQuantity;
  const cashAfterSell = roundMoney(state.cashBalance + sellAmount);
  const finalPositionQty = positionAfterSell + buyQuantity;
  const finalCashBalance = roundMoney(cashAfterSell - buyAmount);
  const finalAvgPrice = finalPositionQty > 0
    ? roundMoney((state.avgPrice * positionAfterSell + buyAmount) / finalPositionQty)
    : 0;

  return {
    sellAmount,
    buyAmount,
    positionAfterSell,
    cashAfterSell,
    finalPositionQty,
    finalCashBalance,
    finalAvgPrice,
    finalT: applyTEffect(state.tValue, effect, state.splitCount),
  };
}
