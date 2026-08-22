'use client';

import { useRef, useState } from 'react';
import type { ChartAnalysisApiResponse, StoredChartAnalysis } from '@/lib/ai/chartAnalysisTypes';

function usd(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

function koreaDateTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}

export function AiChartAnalysis({
  strategyId,
  initialAnalysis,
  enabled,
}: {
  strategyId: string;
  initialAnalysis: StoredChartAnalysis | null;
  enabled: boolean;
}) {
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  async function analyze() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/strategies/${strategyId}/chart-analysis`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json().catch(() => null) as ChartAnalysisApiResponse | null;
      if (!response.ok || !payload?.analysis) {
        throw new Error(payload?.error ?? 'AI 분석 결과를 받아오지 못했습니다.');
      }
      setAnalysis(payload.analysis);
      requestAnimationFrame(() => {
        if (detailsRef.current) detailsRef.current.open = true;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI 분석 중 알 수 없는 오류가 발생했습니다.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="ai-analysis-shell">
      <div className="ai-analysis-action">
        <button
          className="button primary ai-analysis-button"
          type="button"
          onClick={analyze}
          disabled={!enabled || pending}
          aria-busy={pending}
        >
          {pending ? '심층 분석 중…' : analysis ? 'AI 차트 다시 분석' : 'AI 차트 분석'}
        </button>
        <p>
          {enabled
            ? 'GPT-5.6 Luna가 최근 일봉을 매우 높은 추론 강도로 분석합니다. 완료까지 시간이 걸릴 수 있어요.'
            : 'OPENAI_API_KEY를 서버 환경변수에 설정하면 사용할 수 있어요.'}
        </p>
      </div>

      {error && <p className="ai-analysis-error" role="alert">{error}</p>}

      {analysis && (
        <details className="ai-analysis-result" ref={detailsRef}>
          <summary>
            <span>
              <strong>최근 AI 분석 결과</strong>
              <small>{koreaDateTime(analysis.createdAt)} · 기본적으로 접혀 있어요</small>
            </span>
            <span aria-hidden="true">＋</span>
          </summary>
          <div className="ai-analysis-body">
            <div className="ai-analysis-meta">
              <span>{analysis.model} · 추론 {analysis.reasoningEffort}</span>
              <span>{analysis.candleStart} ~ {analysis.candleEnd} · {analysis.candleCount}개 일봉</span>
            </div>

            <div className="ai-analysis-hero">
              <span className="eyebrow">AI TECHNICAL OUTLOOK</span>
              <h3>{analysis.result.headline}</h3>
              <p>{analysis.result.summary}</p>
              <div><strong>현재 시장 국면</strong><span>{analysis.result.marketRegime}</span></div>
            </div>

            <section className="ai-analysis-section">
              <h4>기술적 분석 근거</h4>
              <ul>
                {analysis.result.technicalEvidence.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
              </ul>
            </section>

            <section className="ai-analysis-section">
              <h4>주요 가격대</h4>
              <div className="ai-key-levels">
                {analysis.result.keyLevels.map((level, index) => (
                  <article key={`${level.label}-${index}`}>
                    <span>{level.label}</span>
                    <strong>{usd(level.price)}</strong>
                    <p>{level.meaning}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="ai-analysis-section">
              <div className="ai-analysis-section-head">
                <h4>앞으로 5거래일 종가 예측</h4>
                <span>USD · 예상 범위 포함</span>
              </div>
              <div className="ai-forecast-list">
                {analysis.result.forecast.map((forecast, index) => (
                  <article key={forecast.date}>
                    <div className="ai-forecast-day">
                      <span>{index + 1}일차</span>
                      <strong>{forecast.date}</strong>
                    </div>
                    <div className="ai-forecast-price">
                      <span>예상 종가</span>
                      <strong>{usd(forecast.close)}</strong>
                      <small>{usd(forecast.low)} ~ {usd(forecast.high)}</small>
                    </div>
                    <span className={`ai-confidence confidence-${forecast.confidence}`}>신뢰도 {forecast.confidence}</span>
                    <p>{forecast.rationale}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="ai-analysis-section ai-risk-section">
              <h4>위험요인과 무효화 가능성</h4>
              <ul>
                {analysis.result.risks.map((risk, index) => <li key={`${index}-${risk}`}>{risk}</li>)}
              </ul>
            </section>

            <p className="ai-analysis-disclaimer">
              <strong>분석 한계</strong>
              {analysis.result.limitations}
              <span>재미와 참고를 위한 AI 추정이며 투자 조언이나 수익 보장이 아닙니다.</span>
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
