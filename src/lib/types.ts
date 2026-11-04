export type SymbolCode = 'SOXL';
export type SplitCount = 20;
export type TradeMode = 'normal' | 'reverse';
export type CompoundingType = 'simple' | 'compound';
export type OrderType = 'LOC' | 'MOC' | 'LIMIT' | 'MANUAL';
export type TradeSide = 'buy' | 'sell';
export type TEffect =
  | 'buy_full'
  | 'buy_half'
  | 'quarter_sell'
  | 'full_sell'
  | 'limit_sell_then_full_buy'
  | 'limit_sell_then_half_buy'
  | 'reverse_buy'
  | 'reverse_sell'
  | 'none';

export type CashFlow = {
  id: string;
  strategy_id: string;
  requested_date: string;
  amount: number | string;
  timing: 'immediate' | 'next_round';
  status: 'pending' | 'applied' | 'cancelled';
  applied_date: string | null;
  applied_round_id: string | null;
  reference_price: number | string | null;
  memo: string;
  source?: 'manual' | 'meritz_round' | 'meritz_withdrawal';
  created_at: string;
};

export type Strategy = {
  id: string;
  name: string;
  symbol: SymbolCode;
  split_count: SplitCount;
  principal: number | string;
  cash_balance: number | string;
  exchange_rate?: number | string;
  position_qty: number;
  avg_price: number | string;
  t_value: number | string;
  mode: TradeMode;
  reverse_started_at: string | null;
  reverse_first_sell_done: boolean;
  compounding_type: CompoundingType;
  is_archived: boolean;
  version: number;
  started_at: string;
  created_at: string;
  updated_at: string;
};

export type DailyPrice = {
  id: string;
  strategy_id: string;
  trade_date: string;
  close_price: number | string;
  created_at: string;
};

export type MarketCandle = {
  id?: string;
  symbol: SymbolCode;
  trade_date: string;
  open_price: number | string;
  high_price: number | string;
  low_price: number | string;
  close_price: number | string;
  adjusted_close: number | string | null;
  volume: number | string;
  fetched_at?: string;
};

export type Execution = {
  id: string;
  strategy_id: string;
  trade_plan_id: string | null;
  round_id: string | null;
  executed_at: string;
  side: TradeSide;
  order_type: OrderType;
  quantity: number;
  avg_execution_price: number | string;
  total_amount: number | string;
  t_effect: TEffect | null;
  memo: string | null;
  created_at: string;
};

export type CompletedRound = {
  id: string;
  strategy_id: string;
  round_number: number;
  symbol: SymbolCode;
  split_count: SplitCount;
  started_at: string;
  ended_at: string;
  started_principal: number | string;
  ending_cash_balance: number | string;
  profit_amount: number | string;
  profit_rate: number | string;
  execution_count: number;
  buy_count: number;
  sell_count: number;
  total_buy_amount: number | string;
  total_sell_amount: number | string;
  ending_t_value: number | string;
  created_at: string;
};

export type StrategyState = {
  id: string;
  name: string;
  symbol: SymbolCode;
  splitCount: SplitCount;
  principal: number;
  cashBalance: number;
  positionQty: number;
  avgPrice: number;
  tValue: number;
  mode: TradeMode;
  reverseStartedAt: string | null;
  reverseFirstSellDone: boolean;
};

export function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}

export function toStrategyState(strategy: Strategy): StrategyState {
  if (strategy.symbol !== 'SOXL' || strategy.split_count !== 20) {
    throw new Error('SOXL 20분할 전략만 계산할 수 있습니다.');
  }
  return {
    id: strategy.id,
    name: strategy.name,
    symbol: strategy.symbol,
    splitCount: strategy.split_count,
    principal: toNumber(strategy.principal),
    cashBalance: toNumber(strategy.cash_balance),
    positionQty: strategy.position_qty,
    avgPrice: toNumber(strategy.avg_price),
    tValue: toNumber(strategy.t_value),
    mode: strategy.mode,
    reverseStartedAt: strategy.reverse_started_at,
    reverseFirstSellDone: strategy.reverse_first_sell_done,
  };
}
