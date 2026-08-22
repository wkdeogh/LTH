import { NextResponse } from 'next/server';
import {
  CHART_ANALYSIS_MODEL,
  CHART_ANALYSIS_REASONING_EFFORT,
  requestChartAnalysis,
  toStoredChartAnalysis,
} from '@/lib/ai/chartAnalysis';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { MarketCandle, Strategy, SymbolCode } from '@/lib/types';

export const maxDuration = 300;

type AnalysisRow = {
  id: string;
  strategy_id: string;
  symbol: SymbolCode;
  model: string;
  reasoning_effort: string;
  candle_start: string;
  candle_end: string;
  candle_count: number;
  analysis: unknown;
  created_at: string;
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin');
  const requestHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  let originHost: string | null = null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    originHost = null;
  }
  if (!originHost || !requestHost || originHost !== requestHost) {
    return NextResponse.json({ error: '허용되지 않은 요청 출처입니다.' }, { status: 403 });
  }

  const { id } = await context.params;
  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase 환경변수가 설정되지 않았습니다.' }, { status: 503 });
  }

  try {
    const { data: strategy, error: strategyError } = await supabase
      .from('strategies')
      .select('*')
      .eq('id', id)
      .eq('is_archived', false)
      .single<Strategy>();
    if (strategyError || !strategy) {
      return NextResponse.json({ error: '분석할 전략을 찾을 수 없습니다.' }, { status: 404 });
    }

    const { data: latestAnalysis, error: analysisTableError } = await supabase
      .from('ai_chart_analyses')
      .select('created_at')
      .eq('strategy_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ created_at: string }>();
    if (analysisTableError) {
      if (analysisTableError.message.includes('ai_chart_analyses')) {
        throw new Error('Supabase에 AI 분석 테이블이 없습니다. 최신 supabase/schema.sql을 먼저 실행해 주세요.');
      }
      throw analysisTableError;
    }
    if (latestAnalysis && Date.now() - new Date(latestAnalysis.created_at).getTime() < 60_000) {
      return NextResponse.json({ error: '방금 분석을 완료했습니다. 1분 뒤 다시 시도해 주세요.' }, { status: 429 });
    }

    const { data: candles, error: candleError } = await supabase
      .from('market_candles')
      .select('*')
      .eq('symbol', strategy.symbol)
      .order('trade_date', { ascending: false })
      .limit(756)
      .returns<MarketCandle[]>();
    if (candleError) throw candleError;

    const generated = await requestChartAnalysis(strategy.symbol, candles ?? []);
    const { data: saved, error: saveError } = await supabase
      .from('ai_chart_analyses')
      .insert({
        strategy_id: strategy.id,
        symbol: strategy.symbol,
        model: CHART_ANALYSIS_MODEL,
        reasoning_effort: CHART_ANALYSIS_REASONING_EFFORT,
        candle_start: generated.candleStart,
        candle_end: generated.candleEnd,
        candle_count: generated.candleCount,
        analysis: generated.result,
        openai_response_id: generated.responseId,
      })
      .select('id, strategy_id, symbol, model, reasoning_effort, candle_start, candle_end, candle_count, analysis, created_at')
      .single<AnalysisRow>();
    if (saveError) {
      if (saveError.message.includes('ai_chart_analyses')) {
        throw new Error('Supabase에 AI 분석 테이블이 없습니다. 최신 supabase/schema.sql을 먼저 실행해 주세요.');
      }
      throw saveError;
    }

    return NextResponse.json({ analysis: toStoredChartAnalysis(saved) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 차트 분석 중 알 수 없는 오류가 발생했습니다.';
    console.error('AI 차트 분석 실패:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
