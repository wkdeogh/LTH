import type { DailyPrice, Execution, MarketCandle } from '@/lib/types';
import { toNumber } from '@/lib/types';
import { roundMoney } from '@/lib/trading/rounding';

export type ExecutionSnapshot = {
  execution_id: string | null;
  cash_balance: number | string;
  position_qty: number;
};

export type AssetValuePoint = {
  date: string;
  accountValue: number;
  cashBalance: number;
  positionValue: number;
  positionQty: number;
  closePrice: number;
};

type AssetHistoryInput = {
  currentCashBalance: number;
  currentPositionQty: number;
  executions: Execution[];
  snapshots: ExecutionSnapshot[];
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
  candles,
  dailyPrices,
}: AssetHistoryInput): AssetValuePoint[] {
  if (executions.length === 0) return [];

  const orderedExecutions = sortedExecutions(executions);
  const firstExecutionDate = orderedExecutions[0].executed_at;
  const snapshotsByExecution = new Map(
    snapshots
      .filter((snapshot) => snapshot.execution_id)
      .map((snapshot) => [snapshot.execution_id!, snapshot]),
  );
  const firstSnapshot = snapshotsByExecution.get(orderedExecutions[0].id);
  const inferredState = inferStateBeforeFirstExecution(
    currentCashBalance,
    currentPositionQty,
    orderedExecutions,
  );
  let cashBalance = firstSnapshot ? toNumber(firstSnapshot.cash_balance) : inferredState.cashBalance;
  let positionQty = firstSnapshot ? firstSnapshot.position_qty : inferredState.positionQty;

  const closeByDate = new Map<string, number>();
  for (const candle of candles) {
    const closePrice = toNumber(candle.close_price);
    if (candle.trade_date >= firstExecutionDate && closePrice > 0) {
      closeByDate.set(candle.trade_date, closePrice);
    }
  }
  for (const dailyPrice of dailyPrices) {
    const closePrice = toNumber(dailyPrice.close_price);
    if (dailyPrice.trade_date >= firstExecutionDate && closePrice > 0) {
      closeByDate.set(dailyPrice.trade_date, closePrice);
    }
  }
  for (const execution of orderedExecutions) {
    if (!closeByDate.has(execution.executed_at)) {
      const executionPrice = toNumber(execution.avg_execution_price);
      if (executionPrice > 0) closeByDate.set(execution.executed_at, executionPrice);
    }
  }

  const dates = [...closeByDate.keys()].sort((a, b) => a.localeCompare(b));
  const latestByDate = orderedExecutions.at(-1);
  const latestByCreatedAt = [...orderedExecutions].sort((a, b) => (
    b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
  ))[0];
  const useCurrentStateAfterLatest = latestByDate?.id === latestByCreatedAt?.id;
  const points: AssetValuePoint[] = [];
  let executionIndex = 0;

  for (const date of dates) {
    while (
      executionIndex < orderedExecutions.length
      && orderedExecutions[executionIndex].executed_at <= date
    ) {
      const execution = orderedExecutions[executionIndex];
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

      if (useCurrentStateAfterLatest && execution.id === latestByDate?.id) {
        cashBalance = currentCashBalance;
        positionQty = currentPositionQty;
      }
      executionIndex += 1;
    }

    const closePrice = closeByDate.get(date);
    if (!closePrice) continue;
    const positionValue = roundMoney(positionQty * closePrice);
    points.push({
      date,
      accountValue: roundMoney(cashBalance + positionValue),
      cashBalance: roundMoney(cashBalance),
      positionValue,
      positionQty,
      closePrice,
    });
  }

  return points;
}
