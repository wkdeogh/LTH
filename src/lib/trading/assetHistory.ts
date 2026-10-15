import type { CashFlow, DailyPrice, Execution, MarketCandle, Strategy } from '@/lib/types';
import { toNumber } from '@/lib/types';
import { roundMoney } from '@/lib/trading/rounding';

export type ExecutionSnapshot = {
  execution_id: string | null;
  after_cash_balance?: number | string | null;
  after_position_qty?: number | null;
  cash_balance: number | string;
  position_qty: number;
};

type AdjustmentState = Pick<Strategy, 'cash_balance' | 'position_qty'> & Partial<Strategy>;

export type StrategyAdjustment = {
  id: string; effective_date: string; created_at: string; kind: 'baseline' | 'correction' | 'cash_flow'; reason: string;
  before_state: AdjustmentState;
  after_state: AdjustmentState;
};

export type AssetValuePoint = {
  date: string;
  accountValue: number;
  cashBalance: number;
  positionValue: number;
  positionQty: number;
  closePrice: number;
  marketClosePrice: number | null;
  netCashFlow?: number;
  cashFlowAdjustmentFactor?: number;
  cashFlowEvents?: { amount: number; label: string }[];
};

type AssetHistoryInput = {
  currentCashBalance: number;
  currentPositionQty: number;
  executions: Execution[];
  snapshots: ExecutionSnapshot[];
  adjustments?: StrategyAdjustment[];
  cashFlows?: CashFlow[];
  candles: MarketCandle[];
  dailyPrices: DailyPrice[];
};

function sortedExecutions(executions: Execution[]) {
  return [...executions].sort((a, b) => (
    a.executed_at.localeCompare(b.executed_at)
    || a.created_at.localeCompare(b.created_at)
    || a.id.localeCompare(b.id)
  ));
}

function inferStateBeforeFirstExecution(
  currentCashBalance: number,
  currentPositionQty: number,
  executions: Execution[],
) {
  let cashBalance = currentCashBalance;
  let positionQty = currentPositionQty;

  for (const execution of [...executions].reverse()) {
    const amount = toNumber(execution.total_amount);
    if (execution.side === 'buy') {
      cashBalance += amount;
      positionQty -= execution.quantity;
    } else {
      cashBalance -= amount;
      positionQty += execution.quantity;
    }
  }

  return { cashBalance: roundMoney(cashBalance), positionQty: Math.max(positionQty, 0) };
}

export function buildAssetValueHistory({
  currentCashBalance,
  currentPositionQty,
  executions,
  snapshots,
  adjustments = [],
  cashFlows = [],
  candles,
  dailyPrices,
}: AssetHistoryInput): AssetValuePoint[] {
  cashFlows = cashFlows.filter(flow => flow.status !== 'cancelled');
  if (executions.length === 0 && cashFlows.length === 0) return [];

  const orderedExecutions = sortedExecutions(executions);
  const firstExecutionDate = [...orderedExecutions.map(e => e.executed_at), ...cashFlows.map(f => f.requested_date)].sort()[0];
  adjustments = adjustments.filter(adjustment => adjustment.kind !== 'baseline' || orderedExecutions.some(execution => execution.created_at < adjustment.created_at));
  const snapshotsByExecution = new Map(
    snapshots
      .filter((snapshot) => snapshot.execution_id)
      .map((snapshot) => [snapshot.execution_id!, snapshot]),
  );
  const firstSnapshot = orderedExecutions[0] && snapshotsByExecution.get(orderedExecutions[0].id);
  const firstAdjustment = [...adjustments].sort((a,b) => a.effective_date.localeCompare(b.effective_date) || a.created_at.localeCompare(b.created_at))[0];
  const inferredState = inferStateBeforeFirstExecution(
    firstAdjustment ? toNumber(firstAdjustment.before_state.cash_balance) : currentCashBalance,
    firstAdjustment ? firstAdjustment.before_state.position_qty : currentPositionQty,
    firstAdjustment ? orderedExecutions.filter(e => e.executed_at <= firstAdjustment.effective_date && e.created_at < firstAdjustment.created_at) : orderedExecutions,
  );
  const useFirstSnapshot = firstSnapshot && orderedExecutions[0].executed_at === firstExecutionDate && (!firstAdjustment || firstAdjustment.created_at > orderedExecutions[0].created_at);
  let cashBalance = useFirstSnapshot ? toNumber(firstSnapshot.cash_balance) : inferredState.cashBalance;
  let positionQty = useFirstSnapshot ? firstSnapshot.position_qty : inferredState.positionQty;

  const closeByDate = new Map<string, number>();
  const allCloses = new Map<string, number>();
  for (const candle of candles) {
    const closePrice = toNumber(candle.close_price);
    if (closePrice > 0) allCloses.set(candle.trade_date, closePrice);
    if (candle.trade_date >= firstExecutionDate && closePrice > 0) {
      closeByDate.set(candle.trade_date, closePrice);
    }
  }
  for (const dailyPrice of dailyPrices) {
    const closePrice = toNumber(dailyPrice.close_price);
    if (closePrice > 0) allCloses.set(dailyPrice.trade_date, closePrice);
    if (dailyPrice.trade_date >= firstExecutionDate && closePrice > 0) {
      closeByDate.set(dailyPrice.trade_date, closePrice);
    }
  }
  const marketCloseByDate = new Map(closeByDate);
  for (const execution of orderedExecutions) {
    if (!closeByDate.has(execution.executed_at)) {
      const executionPrice = toNumber(execution.avg_execution_price);
      if (executionPrice > 0) closeByDate.set(execution.executed_at, executionPrice);
    }
  }

  const eventDates = [...adjustments.map(a => a.effective_date), ...cashFlows.flatMap(f => [f.requested_date, ...(f.applied_date ? [f.applied_date] : [])])].sort();
  for (const date of eventDates) {
    if (date < firstExecutionDate || closeByDate.has(date)) continue;
    const previous = [...closeByDate.keys()].filter(day => day <= date).sort().at(-1);
    const priorClose = [...allCloses.keys()].filter(day => day <= date).sort().at(-1);
    const recordedPrice = cashFlows.find(flow => flow.requested_date === date && toNumber(flow.reference_price) > 0)?.reference_price;
    closeByDate.set(date, previous ? closeByDate.get(previous)! : priorClose ? allCloses.get(priorClose)! : toNumber(recordedPrice));
  }
  const dates = [...closeByDate.keys()].sort((a, b) => a.localeCompare(b));
  const latestByDate = orderedExecutions.at(-1);
  const latestByCreatedAt = [...orderedExecutions].sort((a, b) => (
    b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
  ))[0];
  const useCurrentStateAfterLatest = adjustments.length === 0 && latestByDate?.id === latestByCreatedAt?.id;
  const points: AssetValuePoint[] = [];
  const events = [
    ...orderedExecutions.map(execution => ({ date: execution.executed_at, created: execution.created_at, id: execution.id, execution, adjustment: null as StrategyAdjustment | null })),
    ...adjustments.map(adjustment => ({ date: adjustment.effective_date, created: adjustment.created_at, id: adjustment.id, execution: null as Execution | null, adjustment })),
  ].sort((a,b) => a.date.localeCompare(b.date) || a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
  let executionIndex = 0;

  for (const date of dates) {
    let netCashFlow = 0;
    let cashFlowAdjustmentFactor = 1;
    while (
      executionIndex < events.length
      && events[executionIndex].date <= date
    ) {
      const event = events[executionIndex];
      if (event.adjustment) {
        if (event.adjustment.kind === 'cash_flow') {
          netCashFlow += toNumber(event.adjustment.after_state.cash_balance) - toNumber(event.adjustment.before_state.cash_balance);
          const flowPrice = toNumber(cashFlows.find(flow => flow.id === event.adjustment!.id)?.reference_price);
          const before = toNumber(event.adjustment.before_state.cash_balance) + event.adjustment.before_state.position_qty * flowPrice;
          const after = toNumber(event.adjustment.after_state.cash_balance) + event.adjustment.after_state.position_qty * flowPrice;
          if (before > 0 && after > 0) cashFlowAdjustmentFactor *= before / after;
        }
        cashBalance = toNumber(event.adjustment.after_state.cash_balance);
        positionQty = event.adjustment.after_state.position_qty;
        executionIndex += 1;
        continue;
      }
      const execution = event.execution!;
      const snapshot = snapshotsByExecution.get(execution.id);
      if (snapshot) {
        cashBalance = toNumber(snapshot.cash_balance);
        positionQty = snapshot.position_qty;
      }

      const amount = toNumber(execution.total_amount);
      if (execution.side === 'buy') {
        cashBalance = roundMoney(cashBalance - amount);
        positionQty += execution.quantity;
      } else {
        cashBalance = roundMoney(cashBalance + amount);
        positionQty = Math.max(positionQty - execution.quantity, 0);
      }

      if (snapshot?.after_cash_balance != null && snapshot.after_position_qty != null) {
        cashBalance = toNumber(snapshot.after_cash_balance);
        positionQty = snapshot.after_position_qty;
      } else if (useCurrentStateAfterLatest && execution.id === latestByDate?.id) {
        cashBalance = currentCashBalance;
        positionQty = currentPositionQty;
      }
      executionIndex += 1;
    }

    const closePrice = closeByDate.get(date);
    if (closePrice === undefined) continue;
    const positionValue = roundMoney(positionQty * closePrice);
    points.push({
      date,
      accountValue: roundMoney(cashBalance + positionValue),
      cashBalance: roundMoney(cashBalance),
      positionValue,
      positionQty,
      closePrice,
      marketClosePrice: marketCloseByDate.get(date) ?? null,
      ...(cashFlows.length > 0 ? { netCashFlow: roundMoney(netCashFlow), cashFlowAdjustmentFactor, cashFlowEvents: cashFlows.flatMap(flow => {
        const events: { amount: number; label: string }[] = [];
        const direction = toNumber(flow.amount) > 0 ? '입금' : '인출';
        if (flow.requested_date === date) events.push({ amount: toNumber(flow.amount), label: `${direction}${flow.timing === 'next_round' ? ' 예약' : ''}` });
        if (flow.timing === 'next_round' && flow.applied_date === date) events.push({ amount: toNumber(flow.amount), label: `${direction} 반영` });
        return events;
      }) } : {}),
    });
  }

  return points;
}

export function buildAssetComparison(points: AssetValuePoint[]) {
  const first = points[0];
  const changePercent = (value: number | null, baseline: number | null | undefined) => {
    if (value === null || !Number.isFinite(value) || baseline == null || !Number.isFinite(baseline) || baseline <= 0) return null;
    return ((value - baseline) / baseline) * 100;
  };

  let growth = 1;
  const hasFlows = points.some(point => !!point.netCashFlow);
  return points.map((point, index) => {
    const previous = points[index - 1];
    if (previous && previous.accountValue > 0) {
      growth *= point.cashFlowAdjustmentFactor !== undefined
        ? point.accountValue / previous.accountValue * point.cashFlowAdjustmentFactor
        : (point.accountValue - (point.netCashFlow ?? 0)) / previous.accountValue;
    }
    return {
      ...point,
      accountChangePercent: !hasFlows ? changePercent(point.accountValue, first?.accountValue) : first?.accountValue > 0 ? Math.round((growth - 1) * 1e10) / 1e8 : null,
      marketChangePercent: changePercent(point.marketClosePrice, first?.marketClosePrice),
    };
  });
}
