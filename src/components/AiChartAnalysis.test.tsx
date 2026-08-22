import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiChartAnalysis } from '@/components/AiChartAnalysis';
import type { StoredChartAnalysis } from '@/lib/ai/chartAnalysisTypes';

const analysis: StoredChartAnalysis = {
  id: 'analysis-1',
  strategyId: 'strategy-1',
  symbol: 'SOXL',
  model: 'gpt-5.6-luna',
  reasoningEffort: 'xhigh',
  candleStart: '2025-01-02',
  candleEnd: '2026-08-21',
  candleCount: 400,
  createdAt: '2026-08-22T01:30:00.000Z',
  result: {
    headline: '단기 변동성 속 기준 시나리오',
    summary: '추세와 모멘텀을 교차 확인한 요약입니다.',
    marketRegime: '높은 변동성의 중기 조정 국면',
    technicalEvidence: ['근거 1', '근거 2', '근거 3', '근거 4'],
    keyLevels: [
      { label: '지지', price: 118, meaning: '단기 저점' },
      { label: '저항', price: 126, meaning: '단기 고점' },
    ],
    forecast: Array.from({ length: 5 }, (_, index) => ({
      date: `2026-08-${24 + index}`,
      close: 121 + index,
      low: 119 + index,
      high: 123 + index,
      confidence: '보통' as const,
      rationale: `${index + 1}일차 근거`,
    })),
    risks: ['위험 1', '위험 2'],
    limitations: '일봉 데이터만 사용했습니다.',
  },
};

test('저장된 AI 분석은 기본 접힘 상태로 시각 요소를 모두 렌더링한다', () => {
  const html = renderToStaticMarkup(createElement(AiChartAnalysis, {
    strategyId: 'strategy-1',
    initialAnalysis: analysis,
    initialJob: null,
    enabled: true,
  }));

  assert.match(html, /AI 차트 다시 분석/);
  assert.match(html, /최근 AI 분석 결과/);
  assert.match(html, /앞으로 5거래일 종가 예측/);
  assert.match(html, /gpt-5\.6-luna/);
  assert.match(html, /\$121\.00/);
  assert.doesNotMatch(html, /기본적으로 접혀 있어요/);
  assert.doesNotMatch(html, /<details[^>]+open/);
});

test('진행 중인 분석은 페이지를 닫아도 계속된다는 상태를 표시한다', () => {
  const html = renderToStaticMarkup(createElement(AiChartAnalysis, {
    strategyId: 'strategy-1',
    initialAnalysis: null,
    initialJob: {
      id: 'job-1',
      status: 'in_progress',
      createdAt: '2026-08-22T01:30:00.000Z',
      errorMessage: null,
    },
    enabled: true,
  }));

  assert.match(html, /백그라운드 분석 중/);
  assert.match(html, /페이지를 닫아도 분석은 계속됩니다/);
  assert.match(html, /브라우저를 닫아도 중단되지 않습니다/);
  assert.match(html, /<button[^>]+disabled/);
});
