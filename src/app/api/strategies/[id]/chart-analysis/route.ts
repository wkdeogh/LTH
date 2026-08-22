import { NextResponse } from 'next/server';
import {
  CHART_ANALYSIS_MODEL,
  CHART_ANALYSIS_REASONING_EFFORT,
  completedChartAnalysis,
  retrieveChartAnalysis,
  startChartAnalysis,
  terminalResponseError,
  toChartAnalysisJob,
  toJobStatus,
  toStoredChartAnalysis,
} from '@/lib/ai/chartAnalysis';
import type { ChartAnalysisRow } from '@/lib/ai/chartAnalysis';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { MarketCandle, Strategy } from '@/lib/types';

export const maxDuration = 60;

const ANALYSIS_COLUMNS = 'id, strategy_id, symbol, model, reasoning_effort, candle_start, candle_end, candle_count, analysis, openai_response_id, status, error_message, completed_at, created_at';

function isActive(status: ChartAnalysisRow['status']) {
  return status === 'queued' || status === 'in_progress';
}

function tableError(error: { message: string }) {
  if (error.message.includes('ai_chart_analyses')) {
    return new Error('Supabase에 AI 분석 테이블이 없습니다. 최신 supabase/schema.sql을 먼저 실행해 주세요.');
  }
  return error;
}

function latestCompleted(rows: ChartAnalysisRow[]) {
  for (const row of rows) {
    if (row.status !== 'completed' || !row.analysis) continue;
    try {
      return toStoredChartAnalysis(row);
    } catch (error) {
      console.error('저장된 AI 차트 분석을 해석하지 못했습니다:', error);
    }
  }
  return undefined;
}

async function analysisRows(supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>, strategyId: string) {
  const { data, error } = await supabase
    .from('ai_chart_analyses')
    .select(ANALYSIS_COLUMNS)
    .eq('strategy_id', strategyId)
    .order('created_at', { ascending: false })
    .limit(10)
    .returns<ChartAnalysisRow[]>();
  if (error) throw tableError(error);
  return data ?? [];
}

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

    const rows = await analysisRows(supabase, id);
    const latest = rows[0];
    if (latest && isActive(latest.status)) {
      return NextResponse.json({ job: toChartAnalysisJob(latest), analysis: latestCompleted(rows) }, { status: 202 });
    }
    if (latest && Date.now() - new Date(latest.created_at).getTime() < 60_000) {
      return NextResponse.json({ error: '방금 분석을 요청했습니다. 1분 뒤 다시 시도해 주세요.' }, { status: 429 });
    }

    const { data: candles, error: candleError } = await supabase
      .from('market_candles')
      .select('*')
      .eq('symbol', strategy.symbol)
      .order('trade_date', { ascending: false })
      .limit(756)
      .returns<MarketCandle[]>();
    if (candleError) throw candleError;

    const generated = await startChartAnalysis(strategy.symbol, candles ?? []);
    const completed = generated.status === 'completed'
      ? completedChartAnalysis(generated.response, generated.candleEnd)
      : null;
    const errorMessage = terminalResponseError(generated.response);
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
        analysis: completed,
        openai_response_id: generated.responseId,
        status: generated.status,
        error_message: errorMessage,
        completed_at: completed || errorMessage ? new Date().toISOString() : null,
      })
      .select(ANALYSIS_COLUMNS)
      .single<ChartAnalysisRow>();
    if (saveError) throw tableError(saveError);

    return NextResponse.json({
      job: toChartAnalysisJob(saved),
      analysis: completed ? toStoredChartAnalysis(saved) : latestCompleted(rows),
    }, { status: isActive(saved.status) ? 202 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 차트 분석 중 알 수 없는 오류가 발생했습니다.';
    console.error('AI 차트 분석 시작 실패:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase 환경변수가 설정되지 않았습니다.' }, { status: 503 });
  }

  try {
    const rows = await analysisRows(supabase, id);
    let latest = rows[0];
    if (!latest) return NextResponse.json({});

    if (isActive(latest.status) && latest.openai_response_id) {
      const response = await retrieveChartAnalysis(latest.openai_response_id);
      const status = toJobStatus(response.status);
      const errorMessage = terminalResponseError(response);
      const completed = status === 'completed'
        ? completedChartAnalysis(response, latest.candle_end)
        : null;
      const { data: saved, error: saveError } = await supabase
        .from('ai_chart_analyses')
        .update({
          status,
          analysis: completed ?? latest.analysis,
          error_message: errorMessage,
          completed_at: completed || errorMessage ? new Date().toISOString() : latest.completed_at,
        })
        .eq('id', latest.id)
        .select(ANALYSIS_COLUMNS)
        .single<ChartAnalysisRow>();
      if (saveError) throw tableError(saveError);
      latest = saved;
      rows[0] = saved;
    }

    return NextResponse.json({
      job: toChartAnalysisJob(latest),
      analysis: latestCompleted(rows),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 차트 분석 상태 확인 중 알 수 없는 오류가 발생했습니다.';
    console.error('AI 차트 분석 상태 확인 실패:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
