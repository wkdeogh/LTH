import 'server-only';

import type {
  ChartAnalysisJob,
  ChartAnalysisJobStatus,
  ChartAnalysisResult,
  StoredChartAnalysis,
} from '@/lib/ai/chartAnalysisTypes';
import { buildTechnicalSnapshot, nextNyseTradingDays, normalizeMarketCandles } from '@/lib/marketData/technicalIndicators';
import type { MarketCandle, SymbolCode } from '@/lib/types';

const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
export const CHART_ANALYSIS_MODEL = 'gpt-5.6-luna';
export const CHART_ANALYSIS_REASONING_EFFORT = 'xhigh';

const chartAnalysisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string' },
    summary: { type: 'string' },
    marketRegime: { type: 'string' },
    technicalEvidence: {
      type: 'array',
      minItems: 4,
      maxItems: 10,
      items: { type: 'string' },
    },
    keyLevels: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string' },
          price: { type: 'number', exclusiveMinimum: 0 },
          meaning: { type: 'string' },
        },
        required: ['label', 'price', 'meaning'],
      },
    },
    forecast: {
      type: 'array',
      minItems: 5,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          date: { type: 'string' },
          close: { type: 'number', exclusiveMinimum: 0 },
          low: { type: 'number', exclusiveMinimum: 0 },
          high: { type: 'number', exclusiveMinimum: 0 },
          confidence: { type: 'string', enum: ['낮음', '보통', '높음'] },
          rationale: { type: 'string' },
        },
        required: ['date', 'close', 'low', 'high', 'confidence', 'rationale'],
      },
    },
    risks: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      items: { type: 'string' },
    },
    limitations: { type: 'string' },
  },
  required: [
    'headline',
    'summary',
    'marketRegime',
    'technicalEvidence',
    'keyLevels',
    'forecast',
    'risks',
    'limitations',
  ],
} as const;

export type OpenAIResponse = {
  id?: string;
  status?: string;
  error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

export type ChartAnalysisRow = {
  id: string;
  strategy_id: string;
  symbol: SymbolCode;
  model: string;
  reasoning_effort: string;
  candle_start: string;
  candle_end: string;
  candle_count: number;
  analysis: unknown | null;
  openai_response_id: string | null;
  status: ChartAnalysisJobStatus;
  error_message: string | null;
  completed_at: string | null;
  created_at: string;
};

function responseText(response: OpenAIResponse) {
  return (response.output ?? [])
    .flatMap((item) => item.type === 'message' ? item.content ?? [] : [])
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`AI 분석 응답의 ${field} 형식이 올바르지 않습니다.`);
  }
  return value.trim();
}

function positiveNumber(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`AI 분석 응답의 ${field} 가격이 올바르지 않습니다.`);
  }
  return Math.round(value * 10_000) / 10_000;
}

function stringArray(value: unknown, field: string, minimum: number) {
  if (!Array.isArray(value) || value.length < minimum) {
    throw new Error(`AI 분석 응답의 ${field} 항목이 부족합니다.`);
  }
  return value.map((item, index) => nonEmptyString(item, `${field}[${index}]`));
}

function validateAnalysis(value: unknown, forecastDates: string[]): ChartAnalysisResult {
  if (!isRecord(value)) throw new Error('AI 분석 응답이 객체 형식이 아닙니다.');

  if (!Array.isArray(value.keyLevels) || value.keyLevels.length < 2) {
    throw new Error('AI 분석 응답의 주요 가격대가 부족합니다.');
  }
  const keyLevels = value.keyLevels.map((item, index) => {
    if (!isRecord(item)) throw new Error(`AI 분석 응답의 keyLevels[${index}] 형식이 올바르지 않습니다.`);
    return {
      label: nonEmptyString(item.label, `keyLevels[${index}].label`),
      price: positiveNumber(item.price, `keyLevels[${index}].price`),
      meaning: nonEmptyString(item.meaning, `keyLevels[${index}].meaning`),
    };
  });

  if (!Array.isArray(value.forecast) || value.forecast.length !== forecastDates.length) {
    throw new Error('AI 분석 응답에 5개 거래일 예측이 모두 포함되지 않았습니다.');
  }
  const forecast: ChartAnalysisResult['forecast'] = value.forecast.map((item, index) => {
    if (!isRecord(item)) throw new Error(`AI 분석 응답의 forecast[${index}] 형식이 올바르지 않습니다.`);
    const date = nonEmptyString(item.date, `forecast[${index}].date`);
    if (date !== forecastDates[index]) {
      throw new Error('AI 분석 응답의 예측 거래일이 요청한 날짜와 일치하지 않습니다.');
    }
    const low = positiveNumber(item.low, `forecast[${index}].low`);
    const close = positiveNumber(item.close, `forecast[${index}].close`);
    const high = positiveNumber(item.high, `forecast[${index}].high`);
    if (low > close || close > high) {
      throw new Error(`AI 분석 응답의 ${date} 예상 범위가 종가를 포함하지 않습니다.`);
    }
    const confidence = item.confidence;
    if (confidence !== '낮음' && confidence !== '보통' && confidence !== '높음') {
      throw new Error(`AI 분석 응답의 ${date} 신뢰도 형식이 올바르지 않습니다.`);
    }
    return {
      date,
      low,
      close,
      high,
      confidence,
      rationale: nonEmptyString(item.rationale, `forecast[${index}].rationale`),
    };
  });

  return {
    headline: nonEmptyString(value.headline, 'headline'),
    summary: nonEmptyString(value.summary, 'summary'),
    marketRegime: nonEmptyString(value.marketRegime, 'marketRegime'),
    technicalEvidence: stringArray(value.technicalEvidence, 'technicalEvidence', 4),
    keyLevels,
    forecast,
    risks: stringArray(value.risks, 'risks', 2),
    limitations: nonEmptyString(value.limitations, 'limitations'),
  };
}

function modelInstructions(symbol: SymbolCode, forecastDates: string[]) {
  return `당신은 수십 년 경력의 정량 기술적 분석가다. ${symbol}의 일봉 OHLCV만 사용해 다음 5개 미국 시장 거래일의 종가 경로를 분석하라.

목표는 그럴듯한 이야기가 아니라 수치 근거가 연결된 조건부 예측이다. 다음 순서를 내부적으로 충분히 검토하라.
1) 데이터 품질과 최신성, 장기·중기·단기 추세 국면을 확인한다.
2) SMA/EMA/MACD와 회귀 기울기, RSI/Stochastic과 다중 기간 수익률, ATR/Bollinger/실현변동성, 거래량/OBV, 20·60일 가격 구조를 각각 독립 증거군으로 분석한다.
3) 추세와 모멘텀의 일치, 가격과 거래량의 확인 또는 다이버전스, 변동성 수축/확장을 교차검증한다.
4) 상승·기준·하락 시나리오와 무효화 가격을 비교한 뒤 가장 가능성 높은 연속 경로를 선택한다.
5) 첫 예측은 최신 실제 종가에서 출발하고, 이후 날짜는 전날 예측에서 연속되어야 한다. ATR에 비해 큰 움직임은 반드시 수치 근거가 있어야 한다.

${symbol}은 일일 레버리지 ETF이므로 여러 날 수익이 기초지수 수익의 단순 배수가 아니고 변동성 드래그와 일별 복리 경로에 민감하다. 5일이라는 짧은 기간에도 이를 위험요인으로 반영하라. 뉴스, 실적, 금리, 옵션, 장중 흐름은 입력에 없으므로 만들어내지 말고 한계에 명시하라. 과매수/과매도나 차트 패턴 하나만으로 반전을 단정하지 마라.

모든 설명은 전문적이되 이해 가능한 한국어로 작성한다. 가격은 달러이며 소수점 넷째 자리 이내로 쓴다. forecast의 날짜와 순서는 반드시 ${forecastDates.join(', ')} 그대로 사용한다. 예상 범위는 low <= close <= high여야 한다. 신뢰도는 낮음/보통/높음 중 하나지만 차트 데이터만으로 높은 신뢰도를 남발하지 마라. 투자 권유나 매수·매도 명령은 하지 않는다.`;
}

function apiKey() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY가 설정되지 않아 AI 분석을 실행할 수 없습니다.');
  return apiKey;
}

function responseErrorMessage(response: OpenAIResponse) {
  return response.error?.message
    ?? response.incomplete_details?.reason
    ?? `OpenAI 응답이 ${response.status ?? '알 수 없는'} 상태로 종료되었습니다.`;
}

export function toJobStatus(status: string | undefined): ChartAnalysisJobStatus {
  if (
    status === 'queued'
    || status === 'in_progress'
    || status === 'completed'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'incomplete'
  ) return status;
  throw new Error(`지원하지 않는 OpenAI 응답 상태입니다: ${status ?? '없음'}`);
}

export function terminalResponseError(response: OpenAIResponse) {
  const status = toJobStatus(response.status);
  return status === 'failed' || status === 'cancelled' || status === 'incomplete'
    ? responseErrorMessage(response)
    : null;
}

export async function startChartAnalysis(symbol: SymbolCode, candles: MarketCandle[]) {
  const normalized = normalizeMarketCandles(candles).slice(-756);
  const snapshot = buildTechnicalSnapshot(candles);
  const forecastDates = nextNyseTradingDays(normalized.at(-1)!.date, 5);
  const input = {
    symbol,
    dataSemantics: {
      interval: '1d',
      timezone: 'America/New_York',
      currency: 'USD',
      columns: ['date', 'open', 'high', 'low', 'close', 'volume'],
      note: 'Raw tradable OHLC prices shown in the app; oldest to newest.',
    },
    candleCount: normalized.length,
    candleRange: { start: normalized[0].date, end: normalized.at(-1)!.date },
    forecastDates,
    technicalSnapshot: snapshot,
    candles: normalized.map((candle) => [
      candle.date,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
    ]),
  };

  const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CHART_ANALYSIS_MODEL,
      reasoning: { effort: CHART_ANALYSIS_REASONING_EFFORT },
      instructions: modelInstructions(symbol, forecastDates),
      input: JSON.stringify(input),
      max_output_tokens: 30_000,
      background: true,
      store: true,
      text: {
        verbosity: 'high',
        format: {
          type: 'json_schema',
          name: 'chart_analysis',
          strict: true,
          schema: chartAnalysisSchema,
        },
      },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });

  const payload = await response.json().catch(() => null) as OpenAIResponse | null;
  if (!response.ok) {
    const reason = payload?.error?.message;
    throw new Error(reason ? `OpenAI API 오류: ${reason}` : `OpenAI API 오류 (${response.status})`);
  }
  if (!payload?.id) throw new Error('OpenAI API가 백그라운드 응답 ID를 반환하지 않았습니다.');

  return {
    response: payload,
    responseId: payload.id,
    status: toJobStatus(payload.status),
    candleStart: normalized[0].date,
    candleEnd: normalized.at(-1)!.date,
    candleCount: normalized.length,
  };
}

export async function retrieveChartAnalysis(responseId: string) {
  const response = await fetch(`${OPENAI_RESPONSES_ENDPOINT}/${encodeURIComponent(responseId)}`, {
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null) as OpenAIResponse | null;
  if (!response.ok || !payload) {
    const reason = payload?.error?.message;
    throw new Error(reason ? `OpenAI API 오류: ${reason}` : `OpenAI API 오류 (${response.status})`);
  }
  return payload;
}

export function completedChartAnalysis(response: OpenAIResponse, candleEnd: string) {
  if (response.status !== 'completed') {
    throw new Error(`완료되지 않은 OpenAI 응답입니다: ${response.status ?? '상태 없음'}`);
  }
  const text = responseText(response);
  if (!text) throw new Error('OpenAI API가 분석 본문을 반환하지 않았습니다.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('OpenAI API의 구조화 분석 응답을 해석하지 못했습니다.');
  }
  return validateAnalysis(parsed, nextNyseTradingDays(candleEnd, 5));
}

export function toStoredChartAnalysis(row: ChartAnalysisRow): StoredChartAnalysis {
  const forecastDates = isRecord(row.analysis) && Array.isArray(row.analysis.forecast)
    ? row.analysis.forecast.map((item) => isRecord(item) && typeof item.date === 'string' ? item.date : '')
    : [];
  return {
    id: row.id,
    strategyId: row.strategy_id,
    symbol: row.symbol,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    candleStart: row.candle_start,
    candleEnd: row.candle_end,
    candleCount: row.candle_count,
    createdAt: row.created_at,
    result: validateAnalysis(row.analysis, forecastDates),
  };
}

export function toChartAnalysisJob(row: ChartAnalysisRow): ChartAnalysisJob {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    errorMessage: row.error_message,
  };
}
