// Keep the existing strategy and its complete trading/round history.
export const STRATEGY_ID = '621f66d2-de56-4dba-a8ff-1583bf491141';
export const STRATEGY_SYMBOL = 'SOXL' as const;
export const STRATEGY_SPLIT_COUNT = 20 as const;

export function requireStrategyId(id: string) {
  if (id !== STRATEGY_ID) throw new Error('진행 중인 SOXL 20분할 전략만 사용할 수 있습니다.');
  return id;
}
