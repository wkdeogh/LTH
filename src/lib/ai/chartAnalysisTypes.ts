export type ForecastConfidence = '낮음' | '보통' | '높음';

export type ChartForecast = {
  date: string;
  close: number;
  low: number;
  high: number;
  confidence: ForecastConfidence;
  rationale: string;
};

export type ChartAnalysisResult = {
  headline: string;
  summary: string;
  marketRegime: string;
  technicalEvidence: string[];
  keyLevels: Array<{
    label: string;
    price: number;
    meaning: string;
  }>;
  forecast: ChartForecast[];
  risks: string[];
  limitations: string;
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
