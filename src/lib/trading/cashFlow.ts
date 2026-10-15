import type { StrategyState } from '@/lib/types';
import { roundMoney, roundT } from './rounding';

export function calculateCashFlow(state: StrategyState, amount: number, referencePrice?: number) {
  if (!Number.isFinite(amount) || amount === 0 || roundMoney(amount) !== amount) {
    throw new Error('입출금 금액은 0보다 크게, 소수점 넷째 자리까지 입력해 주세요.');
  }
  const principal = roundMoney(state.principal + amount);
  const cashBalance = roundMoney(state.cashBalance + amount);
  if (principal <= 0) throw new Error('인출 후 원금은 0보다 커야 합니다.');
  if (cashBalance < 0) throw new Error('현재 현금보다 많이 인출할 수 없습니다.');
  if (state.positionQty > 0 && (!referencePrice || !Number.isFinite(referencePrice) || referencePrice <= 0)) {
    throw new Error('T값을 계산하려면 최근 종가를 먼저 입력해 주세요.');
  }
  const positionValue = state.positionQty * (referencePrice ?? 0);
  const accountValue = cashBalance + positionValue;
  return {
    principal, cashBalance,
    tValue: accountValue > 0 ? roundT(state.splitCount * positionValue / accountValue) : 0,
  };
}
