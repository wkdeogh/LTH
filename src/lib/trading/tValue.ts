import type { SplitCount, TEffect } from '@/lib/types';
import { roundT } from '@/lib/trading/rounding';

export function applyTEffect(tValue: number, effect: TEffect, splitCount: SplitCount) {
  switch (effect) {
    case 'buy_full':
      return roundT(tValue + 1);
    case 'buy_half':
      return roundT(tValue + 0.5);
    case 'quarter_sell':
      return roundT(tValue * 0.75);
    case 'limit_sell_then_full_buy':
      return roundT(tValue * 0.25 + 1);
    case 'limit_sell_then_half_buy':
      return roundT(tValue * 0.25 + 0.5);
    case 'reverse_sell':
      return roundT(splitCount === 20 ? tValue * 0.9 : tValue * 0.95);
    case 'reverse_buy':
      return roundT(tValue + (splitCount - tValue) * 0.25);
    case 'none':
    default:
      return roundT(tValue);
  }
}
