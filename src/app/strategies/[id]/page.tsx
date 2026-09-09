import { Suspense } from 'react';
import { loadStrategyReferences } from '@/lib/marketData/references';
import { loadStrategyChart, MarketSectionSkeleton, StrategyMarketSection } from '@/components/StrategyMarketSection';
import { StrategyCorrectionForm } from '@/components/StrategyCorrectionForm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { addDailyPrice, deleteStrategy, switchToNormal, switchToReverse } from '@/app/actions';
import { compact, usd } from '@/components/Format';
import { SetupNotice } from '@/components/SetupNotice';
import { StrategyTabs } from '@/components/StrategyTabs';
import { inclusiveDateCount, koreaDate } from '@/lib/date';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseReadClient } from '@/lib/supabase/read';
import type { Strategy } from '@/lib/types';
import { toNumber } from '@/lib/types';
import {
  calculateAccountPerformance,
  calculatePositionPerformance,
  calculateReferenceAverage,
  calculateStarPercent,
  modeLabel,
  referenceSourceLabel,
} from '@/lib/trading';

function signedValue(value: number, suffix = '') {
  return `${value >= 0 ? '+' : ''}${compact(value, 2)}${suffix}`;
}

export default async function StrategyPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const { id } = await params;
  const supabase = createSupabaseReadClient();
  const { data: strategy } = await supabase!.from('strategies').select('*').eq('id', id).single<Strategy>();
  if (!strategy) notFound();

  const currentDate = koreaDate();
  const chartData = loadStrategyChart(strategy);
  const [references, roundTradingDayResult] = await Promise.all([
    loadStrategyReferences(supabase!, id, strategy.symbol),
    supabase!.from('market_candles').select('trade_date', { count: 'exact', head: true })
      .eq('symbol', strategy.symbol).gte('trade_date', strategy.started_at).lte('trade_date', currentDate),
  ]);
  if (roundTradingDayResult.error) throw roundTradingDayResult.error;
  const roundCalendarDays = inclusiveDateCount(strategy.started_at, currentDate);
  const roundTradingDays = roundTradingDayResult.count ?? 0;
  const reference = references[0];
  const positionPerformance = calculatePositionPerformance(
    strategy.position_qty,
    toNumber(strategy.avg_price),
    reference?.price,
  );
  const accountPerformance = calculateAccountPerformance(
    toNumber(strategy.principal),
    toNumber(strategy.cash_balance),
    strategy.position_qty,
    reference?.price,
  );
  const referenceAverage = calculateReferenceAverage(references);
  const positionMarketValue = strategy.position_qty === 0
    ? 0
    : reference
      ? strategy.position_qty * reference.price
      : null;
  const isNegative = accountPerformance.profitRate !== null && accountPerformance.profitRate < 0;
  const progress = Math.min(Math.max((toNumber(strategy.t_value) / strategy.split_count) * 100, 0), 100);
  const principal = toNumber(strategy.principal);
  const cashBalance = toNumber(strategy.cash_balance);
  const accountValue = accountPerformance.accountValue;
  const capitalScale = Math.max(principal, accountValue ?? 0, 1);
  const accountValuePercent = accountValue === null
    ? 0
    : Math.min(Math.max((accountValue / capitalScale) * 100, 0), 100);
  const principalMarkerPercent = Math.min(Math.max((principal / capitalScale) * 100, 0), 100);
  const hasAssetComposition = accountValue !== null && accountValue > 0 && positionMarketValue !== null;
  const cashSharePercent = hasAssetComposition
    ? Math.min(Math.max((cashBalance / accountValue) * 100, 0), 100)
    : 0;
  const positionSharePercent = hasAssetComposition ? 100 - cashSharePercent : 0;
  const currentStarPercent = strategy.mode === 'normal'
    ? calculateStarPercent(strategy.symbol, strategy.split_count, toNumber(strategy.t_value)) * 100
    : null;
  return (
    <div className="stack page-stack">
      <section className="hero compact-hero">
        <span className="eyebrow">{strategy.symbol} · {strategy.split_count}분할</span>
        <div className="title-row">
          <div>
            <h1>{strategy.name}</h1>
          </div>
          <span className={`status-badge ${strategy.mode === 'reverse' ? 'reverse' : ''}`}>{modeLabel(strategy.mode)}</span>
        </div>
      </section>

      <StrategyTabs strategyId={id} active="detail" />

      <section className="strategy-card strategy-detail-summary" aria-label="현재 전략 요약">
        <div className="strategy-card-head">
          <div className="strategy-status-heading">
            <h2>현재 상태</h2>
            <div className="round-progress-meta">
              <span>라운드 시작 {strategy.started_at}</span>
              <span>{roundCalendarDays}일 ({roundTradingDays}거래일) 진행중</span>
            </div>
          </div>
        </div>

        <div className="price-line strategy-detail-price-line">
          <div><span>평균단가</span><strong>{usd(strategy.avg_price)}</strong></div>
          <span className="price-arrow" aria-hidden="true">→</span>
          <div>
            <span>{referenceSourceLabel(reference?.source)}</span>
            <strong>{reference ? usd(reference.price) : '-'}</strong>
            {reference && <small>{reference.date}</small>}
          </div>
        </div>

        <div className="turn-progress">
          <div className="turn-progress-label">
            <div className="turn-progress-title">
              <span>T 진행도</span>
              {currentStarPercent === null ? (
                <small className="reverse">리버스 · 5일 평균 기준</small>
              ) : (
                <small>별% {signedValue(currentStarPercent, '%')}</small>
              )}
            </div>
            <strong>{compact(strategy.t_value)} / {strategy.split_count}</strong>
          </div>
          <div className="progress-track" role="progressbar" aria-label={`${strategy.name} T 진행도`} aria-valuemin={0} aria-valuemax={strategy.split_count} aria-valuenow={toNumber(strategy.t_value)}>
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="capital-visuals" aria-label="현재 계좌 금액 구성">
          <div className="capital-visual">
            <div className="capital-visual-head">
              <span>원금 대비 계좌 평가</span>
              <strong className={isNegative ? 'profit-negative' : 'profit-positive'}>
                {accountPerformance.profitRate === null ? '-' : signedValue(accountPerformance.profitRate, '%')}
              </strong>
            </div>
            <div className={`capital-comparison-track ${isNegative ? 'negative' : ''} ${accountValue === null ? 'unavailable' : ''}`} aria-hidden="true">
              <span className="capital-comparison-fill" style={{ width: `${accountValuePercent}%` }} />
              <i className="capital-principal-marker" style={{ left: `${principalMarkerPercent}%` }} />
            </div>
            <div className="capital-visual-values">
              <span>원금 <strong>{usd(principal)}</strong></span>
              <span>평가액 <strong>{accountValue === null ? '-' : usd(accountValue)}</strong></span>
            </div>
          </div>

          <div className="capital-visual">
            <div className="capital-visual-head">
              <span>현재 자산 구성</span>
              <strong>{hasAssetComposition ? `주식 ${compact(positionSharePercent, 0)}%` : accountValue === null ? '종가 필요' : '자산 없음'}</strong>
            </div>
            <div className={`asset-composition-track ${hasAssetComposition ? '' : 'unavailable'}`} aria-hidden="true">
              {hasAssetComposition && (
                <>
                  <span className="asset-cash-fill" style={{ width: `${cashSharePercent}%` }} />
                  <span className="asset-position-fill" style={{ width: `${positionSharePercent}%` }} />
                </>
              )}
            </div>
            <div className="asset-legend">
              <span><i className="cash" />현금 <strong>{usd(cashBalance)}</strong></span>
              <span><i className="position" />보유주식 <strong>{positionMarketValue === null ? '-' : usd(positionMarketValue)}</strong></span>
            </div>
          </div>
        </div>

        <div className="strategy-mini-stats strategy-detail-quick-stats">
          <div><span>보유</span><strong>{strategy.position_qty}주</strong></div>
          <div><span>계좌손익</span><strong className={accountPerformance.profitAmount !== null && accountPerformance.profitAmount < 0 ? 'profit-negative' : 'profit-positive'}>{accountPerformance.profitAmount === null ? '-' : `${accountPerformance.profitAmount >= 0 ? '+' : '-'}${usd(Math.abs(accountPerformance.profitAmount))}`}</strong></div>
          <div><span>보유분 평단 대비</span><strong className={positionPerformance.profitRate !== null && positionPerformance.profitRate < 0 ? 'profit-negative' : 'profit-positive'}>{positionPerformance.profitRate === null ? '-' : signedValue(positionPerformance.profitRate, '%')}</strong></div>
        </div>
      </section>

      <Suspense fallback={<MarketSectionSkeleton symbol={strategy.symbol} />}>
        <StrategyMarketSection strategy={strategy} data={chartData} referencePrice={reference?.price} />
      </Suspense>

      <section className="panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">PRICE HISTORY</span>
            <h2>최근 계산 기준가</h2>
          </div>
          <span className="subtle-label">5일 평균 ({Math.min(references.length, 5)}/5) {referenceAverage === null ? '-' : usd(referenceAverage)}</span>
        </div>
        {references.length > 0 ? (
          <div className="reference-list">
            {references.slice(0, 5).map((item, index) => (
              <div className="reference-row" key={`${item.date}-${item.source}`}>
                <div><strong>{item.date}</strong><span>{referenceSourceLabel(item.source)}{index === 0 ? ' · 현재 기준' : ''}</span></div>
                <strong>{usd(item.price)}</strong>
              </div>
            ))}
          </div>
        ) : <p className="muted empty-copy">아직 종가나 체결 기록이 없습니다.</p>}
      </section>

      <details className="panel disclosure">
        <summary>
          <span><strong>종가 직접 입력</strong><small>API 데이터가 없거나 직접 보정할 때만 사용하세요</small></span>
          <span aria-hidden="true">＋</span>
        </summary>
        <form className="form disclosure-body" action={addDailyPrice} data-inline-validation noValidate>
          <p className="helper-copy">직접 입력한 종가는 같은 날짜의 차트 종가보다 우선합니다.</p>
          <input type="hidden" name="strategy_id" value={strategy.id} />
          <div className="inline-form-grid">
            <label>거래일<input name="trade_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
            <label>종가($)<input name="close_price" type="number" min="0.0001" step="0.0001" inputMode="decimal" placeholder="예: 72.35" required /></label>
          </div>
          <button type="submit" className="secondary">종가 저장</button>
        </form>
      </details>

      <details className="panel disclosure">
        <summary>
          <span><strong>현재 상태 직접 수정</strong><small>증권사 값과 다를 때만 사용하세요</small></span>
          <span aria-hidden="true">＋</span>
        </summary>
        <StrategyCorrectionForm strategy={strategy} />
      </details>

      <details className="panel disclosure danger-zone">
        <summary>
          <span><strong>모드 전환 및 전략 삭제</strong><small>필요할 때만 열어 주세요</small></span>
          <span aria-hidden="true">＋</span>
        </summary>
        <div className="actions disclosure-body">
          <form action={switchToReverse}><input type="hidden" name="id" value={id} /><button type="submit" className="secondary">리버스모드로 전환</button></form>
          <form action={switchToNormal}><input type="hidden" name="id" value={id} /><button type="submit" className="secondary">일반모드로 복귀</button></form>
          {strategy.is_main ? (
            <div className="main-strategy-protection">
              <button type="button" className="secondary" disabled aria-describedby="main-strategy-delete-hint">메인 전략 · 삭제 불가</button>
              <p id="main-strategy-delete-hint"><Link href="/">전략 목록</Link>에서 다른 전략을 메인으로 설정한 후 삭제할 수 있습니다.</p>
            </div>
          ) : (
            <form action={deleteStrategy}><input type="hidden" name="id" value={id} /><button type="submit" className="danger">전략 삭제</button></form>
          )}
        </div>
      </details>
    </div>
  );
}
