import { Suspense } from 'react';
import { refreshMarketChart } from '@/app/actions';
import { AiChartAnalysis } from '@/components/AiChartAnalysis';
import { LazyMarketChart } from '@/components/LazyMarketChart';
import { toChartAnalysisJob, toStoredChartAnalysis, type ChartAnalysisRow } from '@/lib/ai/chartAnalysis';
import { latestClosedMarketDate } from '@/lib/date';
import { hasOpenAIEnv } from '@/lib/env';
import { createSupabaseReadClient } from '@/lib/supabase/read';
import { calculateNormalPlan } from '@/lib/trading';
import { toNumber, type Execution, type MarketCandle, type Strategy } from '@/lib/types';

export function loadStrategyChart(strategy: Strategy) {
  const supabase = createSupabaseReadClient()!;
  const start = new Date();
  start.setUTCFullYear(start.getUTCFullYear() - 3);
  start.setUTCDate(start.getUTCDate() - 14);
  const date = start.toISOString().slice(0, 10);
  return { chart: Promise.all([
    supabase.from('market_candles').select('*').eq('symbol', strategy.symbol).gte('trade_date', date).lte('trade_date', latestClosedMarketDate()).order('trade_date', { ascending: true }).limit(900).returns<MarketCandle[]>(),
    supabase.from('executions').select('*').eq('strategy_id', strategy.id).gte('executed_at', date).order('executed_at', { ascending: true }).order('created_at', { ascending: true }).limit(1000).returns<Execution[]>(),
  ]), analysis: Promise.resolve(supabase.from('ai_chart_analyses').select('id, strategy_id, symbol, model, reasoning_effort, candle_start, candle_end, candle_count, analysis, openai_response_id, status, error_message, completed_at, created_at').eq('strategy_id', strategy.id).order('created_at', { ascending: false }).limit(10).returns<ChartAnalysisRow[]>()),
  };
}

export function MarketSectionSkeleton({ symbol }: { symbol: string }) {
  return <section className="panel chart-panel market-section" aria-label="차트 불러오는 중" aria-busy="true">
    <div className="section-head"><div><span className="eyebrow">{symbol} MARKET</span><h2>{symbol} 차트와 체결 지점</h2></div></div>
    <div className="skeleton-block market-chart-placeholder" aria-hidden="true" />
  </section>;
}

export async function StrategyMarketSection({ strategy, data, referencePrice }: {
  strategy: Strategy; data: ReturnType<typeof loadStrategyChart>; referencePrice?: number;
}) {
  const [candleResult, chartExecutionResult] = await data.chart;
  if (candleResult.error || chartExecutionResult.error) {
    return <section className="panel"><h2>{strategy.symbol} 차트</h2><p className="danger-text">차트를 불러오지 못했습니다. 새로고침해 주세요.</p></section>;
  }
  const chartPlan = strategy.mode === 'normal'
    ? calculateNormalPlan({
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
    }, referencePrice)
    : null;

  return (
      <section className="panel chart-panel market-section" id="market-chart">
        <div className="section-head chart-section-head">
          <div>
            <span className="eyebrow">{strategy.symbol} MARKET</span>
            <h2>{strategy.symbol} 차트와 체결 지점</h2>
          </div>
          <div className="section-head-actions">
            <form action={refreshMarketChart}>
              <input name="strategy_id" type="hidden" value={strategy.id} />
              <button className="button ghost chart-refresh-button" type="submit">캔들 즉시 갱신</button>
            </form>
          </div>
        </div>
        <LazyMarketChart
          symbol={strategy.symbol}
          candles={candleResult.data ?? []}
          executions={chartExecutionResult.data ?? []}
          averagePrice={toNumber(strategy.avg_price)}
          starPrice={chartPlan?.starPrice ?? null}
          fullSellPrice={chartPlan?.targetSellPrice ?? null}
        />
        <Suspense fallback={null}>
          <StrategyChartAnalysis strategyId={strategy.id} data={data.analysis} />
        </Suspense>
      </section>
  );
}

async function StrategyChartAnalysis({ strategyId, data }: {
  strategyId: string; data: ReturnType<typeof loadStrategyChart>['analysis'];
}) {
  const aiAnalysisResult = await data;
  const aiAnalysisRows = aiAnalysisResult.data ?? [];
  let initialAiAnalysis = null;
  for (const row of aiAnalysisRows) {
    if (row.status !== 'completed' || !row.analysis) continue;
    try { initialAiAnalysis = toStoredChartAnalysis(row); break; }
    catch (error) { console.error('저장된 AI 차트 분석을 불러오지 못했습니다:', error); }
  }
  const initialAiJob = aiAnalysisRows[0] ? toChartAnalysisJob(aiAnalysisRows[0]) : null;
  return <AiChartAnalysis strategyId={strategyId} initialAnalysis={initialAiAnalysis} initialJob={initialAiJob} enabled={hasOpenAIEnv()} />;
}
