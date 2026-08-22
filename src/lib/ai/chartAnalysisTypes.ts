export type ForecastConfidence = '낮음' | '보통' | '높음';
export type ForecastStrategyAction = '매수 예상' | '매도 예상' | '관망 예상' | '모드 전환 가능';

export type ChartForecast = {
  date: string;
  close: number;
  low: number;
  high: number;
  confidence: ForecastConfidence;
  rationale: string;
  strategyAction?: ForecastStrategyAction;
  tradeEstimate?: string;
};

export type ChartAnalysisResult = {
  headline: string;
  summary: string;
  marketRegime: string;
  technicalEvidence: string[];
  keyLevels?: Array<{
    label: string;
    price: number;
    meaning: string;
  }>;
  forecast: ChartForecast[];
  risks: string[];
  limitations?: string;
};

export type StoredChartAnalysis = {
  id: string;
  strategyId: string;
  symbol: 'TQQQ' | 'SOXL';
  model: string;
  reasoningEffort: string;
  candleStart: string;
  candleEnd: string;
  candleCount: number;
  createdAt: string;
  result: ChartAnalysisResult;
};

export type ChartAnalysisJobStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'incomplete';

export type ChartAnalysisJob = {
  id: string;
  status: ChartAnalysisJobStatus;
  createdAt: string;
  errorMessage: string | null;
};

export type ChartAnalysisApiResponse = {
  analysis?: StoredChartAnalysis;
  job?: ChartAnalysisJob;
  error?: string;
};
