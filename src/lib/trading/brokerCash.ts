import type { StrategyState } from '@/lib/types';
import { roundMoney, roundT } from './rounding';

// T measures units of the round budget. Rescale those same invested units
// when capital leaves; neither the latest quote nor unrealized P/L is capital.
export function calculateBrokerWithdrawal(state: StrategyState, observedCash: number) {
  if (!Number.isFinite(observedCash) || observedCash < 0) throw new Error('USD 현금을 확인하지 못했습니다.');
  const cash = roundMoney(observedCash);
  if (state.cashBalance <= 0 || cash * 100 > state.cashBalance * 95) return null;
  const amount = roundMoney(cash - state.cashBalance);
  const principal = roundMoney(state.principal + amount);
  if (principal <= 0) throw new Error('현금 감소 반영 후 원금은 0보다 커야 합니다.');
  return { amount, principal, cashBalance: cash,
    tValue: state.positionQty ? roundT(state.tValue * state.principal / principal) : 0 };
}
