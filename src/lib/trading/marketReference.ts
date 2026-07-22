import type { DailyPrice, Execution } from '@/lib/types';
import { toNumber } from '@/lib/types';
import { roundMoney, roundRate } from '@/lib/trading/rounding';

export type ReferenceSource = 'saved_close' | 'execution';

export type MarketReference = {
  date: string;
  price: number;
  source: ReferenceSource;
};

type DailyPriceInput = Pick<DailyPrice, 'trade_date' | 'close_price'>;
type ExecutionInput = Pick<Execution, 'executed_at' | 'avg_execution_price' | 'created_at'>;

/**
 * 직접 입력한 종가가 있으면 같은 날의 체결가보다 우선한다.
 * 종가가 없는 날짜는 LOC 체결가를 그날의 종가로 간주한다.
 */
export function buildMarketReferenceHistory(
  dailyPrices: DailyPriceInput[],
  executions: ExecutionInput[],
): MarketReference[] {
  const references = new Map<string, MarketReference>();
  const sortedExecutions = [...executions].sort((a, b) => {
    const dateOrder = b.executed_at.localeCompare(a.executed_at);
    return dateOrder !== 0 ? dateOrder : b.created_at.localeCompare(a.created_at);
  });

  for (const execution of sortedExecutions) {
    const price = toNumber(execution.avg_execution_price);
    if (price > 0 && !references.has(execution.executed_at)) {
      references.set(execution.executed_at, {
        date: execution.executed_at,
        price,
        source: 'execution',
      });
    }
  }

  for (const dailyPrice of dailyPrices) {
    const price = toNumber(dailyPrice.close_price);
    if (price > 0) {
      references.set(dailyPrice.trade_date, {
        date: dailyPrice.trade_date,
        price,
        source: 'saved_close',
      });
    }
  }

  return [...references.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function calculatePositionPerformance(positionQty: number, avgPrice: number, currentPrice?: number | null) {
  if (positionQty <= 0 || avgPrice <= 0 || !currentPrice || currentPrice <= 0) {
    return { marketValue: null, profitAmount: null, profitRate: null };
  }

  const marketValue = currentPrice * positionQty;
  const profitAmount = (currentPrice - avgPrice) * positionQty;
  const profitRate = ((currentPrice - avgPrice) / avgPrice) * 100;

  return { marketValue, profitAmount, profitRate };
}

export function calculateAccountPerformance(
  principal: number,
  cashBalance: number,
  positionQty: number,
  currentPrice?: number | null,
) {
  if (principal <= 0 || cashBalance < 0 || positionQty < 0) {
    return { accountValue: null, profitAmount: null, profitRate: null };
  }
  if (positionQty > 0 && (!currentPrice || currentPrice <= 0)) {
    return { accountValue: null, profitAmount: null, profitRate: null };
  }

  const accountValue = cashBalance + positionQty * (currentPrice ?? 0);
  const profitAmount = accountValue - principal;
  const profitRate = (profitAmount / principal) * 100;

  return { accountValue, profitAmount, profitRate };
}

export function calculateReferenceAverage(references: MarketReference[], count = 5) {
  const prices = references.slice(0, count).map((reference) => reference.price).filter((price) => price > 0);
  if (prices.length === 0) return null;
  return prices.reduce((sum, price) => sum + price, 0) / prices.length;
}

export function calculateRoundPerformance(startedPrincipal: number, endingCashBalance: number) {
  if (startedPrincipal <= 0 || endingCashBalance < 0) {
    throw new Error('시작 원금은 0보다 커야 하고 종료 현금은 음수일 수 없습니다.');
  }

  const profitAmount = roundMoney(endingCashBalance - startedPrincipal);
  const profitRate = roundRate((profitAmount / startedPrincipal) * 100);
  return { profitAmount, profitRate };
}

export function referenceSourceLabel(source?: ReferenceSource) {
  return source === 'saved_close' ? '직접 입력 종가' : source === 'execution' ? '최근 체결가' : '기준가 없음';
}
