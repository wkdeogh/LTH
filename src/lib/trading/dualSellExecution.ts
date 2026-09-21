import type { StrategyState, TEffect } from '@/lib/types';
import { roundMoney } from './rounding';
import { applyTEffect } from './tValue';

export function calculateDualSellExecution(state: StrategyState, limitQuantity: number, limitPrice: number, locQuantity: number, locPrice: number) {
  if (state.mode !== 'normal') throw new Error('쿼터·지정가 매도는 일반모드에서만 입력할 수 있습니다.');
  if (![limitQuantity, locQuantity].every(value => Number.isInteger(value) && value > 0)) {
    throw new Error('두 매도 수량을 각각 1주 이상의 정수로 입력해 주세요.');
  }
  if (![limitPrice, locPrice].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('두 매도 체결가를 각각 0보다 크게 입력해 주세요.');
  }
  const quantity = limitQuantity + locQuantity;
  if (quantity > state.positionQty) throw new Error(`매도 합계(${quantity}주)가 현재 보유수량(${state.positionQty}주)을 초과합니다.`);
  const limitAmount = roundMoney(limitQuantity * limitPrice);
  const locAmount = roundMoney(locQuantity * locPrice);
  const totalAmount = roundMoney(limitAmount + locAmount);
  const effect: TEffect = quantity === state.positionQty ? 'full_sell' : 'quarter_sell';
  return {
    quantity, totalAmount, effect,
    finalT: applyTEffect(state.tValue, effect, state.splitCount),
    legs: [
      { side: 'sell', order_type: 'LIMIT', quantity: limitQuantity, avg_execution_price: limitPrice, total_amount: limitAmount, t_effect: 'none' },
      { side: 'sell', order_type: 'LOC', quantity: locQuantity, avg_execution_price: locPrice, total_amount: locAmount, t_effect: effect },
    ],
    snapshots: [
      { cash_balance: state.cashBalance, position_qty: state.positionQty, avg_price: state.avgPrice, t_value: state.tValue, after_cash_balance: roundMoney(state.cashBalance + limitAmount), after_position_qty: state.positionQty - limitQuantity },
      { cash_balance: roundMoney(state.cashBalance + limitAmount), position_qty: state.positionQty - limitQuantity, avg_price: state.avgPrice, t_value: state.tValue, after_cash_balance: roundMoney(state.cashBalance + totalAmount), after_position_qty: state.positionQty - quantity },
    ],
  };
}
