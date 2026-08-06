import { notFound } from 'next/navigation';
import { addDailyPrice, deleteStrategy, refreshMarketChart, switchToNormal, switchToReverse, updateStrategy } from '@/app/actions';
import { compact, usd } from '@/components/Format';
import { LazyMarketChart } from '@/components/LazyMarketChart';
import { SetupNotice } from '@/components/SetupNotice';
import { StrategyTabs } from '@/components/StrategyTabs';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { DailyPrice, Execution, MarketCandle, Strategy } from '@/lib/types';
import { toNumber } from '@/lib/types';
import {
  buildMarketReferenceHistory,
  calculateAccountPerformance,
  calculateNormalPlan,
  calculatePositionPerformance,
  calculateReferenceAverage,
  modeLabel,
  referenceSourceLabel,
} from '@/lib/trading';

function signedValue(value: number, suffix = '') {
  return `${value >= 0 ? '+' : ''}${compact(value, 2)}${suffix}`;
}

export default async function StrategyPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const { id } = await params;
  const supabase = createSupabaseServerClient();
  const { data: strategy } = await supabase!.from('strategies').select('*').eq('id', id).single<Strategy>();
  if (!strategy) notFound();

  const chartStart = new Date();
  chartStart.setUTCFullYear(chartStart.getUTCFullYear() - 3);
  chartStart.setUTCDate(chartStart.getUTCDate() - 14);

  const [priceResult, candleResult, chartExecutionResult] = await Promise.all([
    supabase!
      .from('daily_prices')
      .select('*')
      .eq('strategy_id', id)
      .order('trade_date', { ascending: false })
      .limit(7)
      .returns<DailyPrice[]>(),
    supabase!
      .from('market_candles')
      .select('*')
      .eq('symbol', strategy.symbol)
      .gte('trade_date', chartStart.toISOString().slice(0, 10))
      .order('trade_date', { ascending: true })
      .limit(900)
      .returns<MarketCandle[]>(),
    supabase!
      .from('executions')
      .select('*')
      .eq('strategy_id', id)
      .gte('executed_at', chartStart.toISOString().slice(0, 10))
      .order('executed_at', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1000)
      .returns<Execution[]>(),
  ]);

  const prices = priceResult.data ?? [];
  const references = buildMarketReferenceHistory(prices, candleResult.data ?? []);
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
    }, reference?.price)
    : null;

  return (
    <div className="stack page-stack">
      <section className="hero compact-hero">
        <span className="eyebrow">{strategy.symbol} · {strategy.split_count}분할</span>
        <div className="title-row">
          <div>
            <h1>{strategy.name}</h1>
            <p>{modeLabel(strategy.mode)}로 진행 중입니다.</p>
          </div>
          <span className={`status-badge ${strategy.mode === 'reverse' ? 'reverse' : ''}`}>{modeLabel(strategy.mode)}</span>
        </div>
      </section>

      <StrategyTabs strategyId={id} active="detail" />

      <section className={`performance-panel ${isNegative ? 'negative' : ''}`}>
        <div className="performance-main">
          <span>현재 라운드 원금 대비 계좌 전체 수익률</span>
          <strong>{accountPerformance.profitRate === null ? '-' : signedValue(accountPerformance.profitRate, '%')}</strong>
          <p>
            {reference
              ? `${referenceSourceLabel(reference.source)} ${usd(reference.price)} · ${reference.date}`
              : strategy.position_qty > 0
                ? '종가나 체결가가 기록되면 자동으로 계산됩니다.'
                : '보유 중인 수량이 없습니다.'}
          </p>
        </div>
        <div className="performance-details three">
          <div><span>계좌 평가액</span><strong>{accountPerformance.accountValue === null ? '-' : usd(accountPerformance.accountValue)}</strong></div>
          <div><span>계좌 평가손익</span><strong className={accountPerformance.profitAmount !== null && accountPerformance.profitAmount < 0 ? 'profit-negative' : undefined}>{accountPerformance.profitAmount === null ? '-' : `${accountPerformance.profitAmount >= 0 ? '+' : '-'}${usd(Math.abs(accountPerformance.profitAmount))}`}</strong></div>
          <div><span>보유분 평단 대비</span><strong className={positionPerformance.profitRate !== null && positionPerformance.profitRate < 0 ? 'profit-negative' : undefined}>{positionPerformance.profitRate === null ? '-' : signedValue(positionPerformance.profitRate, '%')}</strong></div>
        </div>
      </section>

      <section className="panel chart-panel" id="market-chart">
        <div className="section-head chart-section-head">
          <div>
            <span className="eyebrow">{strategy.symbol} MARKET</span>
            <h2>{strategy.symbol} 차트와 체결 지점</h2>
          </div>
          <div className="section-head-actions">
            <span className="subtle-label">일봉 · 최근 3년</span>
            <form action={refreshMarketChart}>
              <input name="strategy_id" type="hidden" value={strategy.id} />
              <button className="button ghost chart-refresh-button" type="submit">캔들 즉시 갱신</button>
            </form>
          </div>
        </div>
        <p className="helper-copy">차트를 움직이거나 확대할 수 있습니다. 마우스를 올리거나 모바일에서 길게 터치하면 해당 일자의 OHLC와 체결 정보를 확인할 수 있습니다.</p>
        <LazyMarketChart
          symbol={strategy.symbol}
          candles={candleResult.data ?? []}
          executions={chartExecutionResult.data ?? []}
          averagePrice={toNumber(strategy.avg_price)}
          starPrice={chartPlan?.starPrice ?? null}
          fullSellPrice={chartPlan?.targetSellPrice ?? null}
        />
      </section>

      <section className="panel current-state-panel">
        <div className="section-head current-state-head">
          <div>
            <span className="eyebrow">CURRENT STATE</span>
            <h2>현재 전략 상태</h2>
          </div>
        </div>

        <div className="current-state-capital" aria-label="자금 현황">
          <div>
            <span>현재 라운드 원금</span>
            <strong>{usd(strategy.principal)}</strong>
          </div>
          <div>
            <span>현금</span>
            <strong>{usd(strategy.cash_balance)}</strong>
          </div>
        </div>

        <div className="current-position-overview">
          <div className="current-position-value">
            <span>보유주식 평가금액</span>
            <strong>{positionMarketValue === null ? '-' : usd(positionMarketValue)}</strong>
            <small>{strategy.position_qty === 0 ? '0주 보유' : reference ? `${strategy.position_qty}주 × 최근 종가 ${usd(reference.price)}` : '최신 종가가 필요합니다'}</small>
          </div>

          <dl className="current-position-facts">
            <div>
              <dt>보유수량</dt>
              <dd>{strategy.position_qty}주</dd>
            </div>
            <div>
              <dt>평균단가</dt>
              <dd>{usd(strategy.avg_price)}</dd>
            </div>
            <div>
              <dt>T값</dt>
              <dd>{compact(strategy.t_value)}</dd>
            </div>
          </dl>
        </div>
      </section>

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
        <form className="form disclosure-body" action={updateStrategy} data-inline-validation data-validation-kind="strategy" noValidate>
          <input type="hidden" name="id" value={strategy.id} />
          <div className="form-grid">
            <label>전략명<input name="name" defaultValue={strategy.name} required /></label>
            <label>종목<select name="symbol" defaultValue={strategy.symbol}><option>TQQQ</option><option>SOXL</option></select></label>
            <label>분할 수<select name="split_count" defaultValue={strategy.split_count}><option value="20">20</option><option value="40">40</option></select></label>
            <label>원금($)<input name="principal" type="number" min="0.0001" step="0.0001" inputMode="decimal" defaultValue={String(strategy.principal)} required /></label>
            <label>현금($)<input name="cash_balance" type="number" min="0" step="0.0001" inputMode="decimal" defaultValue={String(strategy.cash_balance)} required /></label>
            <label>보유수량<input name="position_qty" type="number" min="0" inputMode="numeric" defaultValue={strategy.position_qty} required /></label>
            <label>평단($)<input name="avg_price" type="number" min="0" step="0.0001" inputMode="decimal" defaultValue={String(strategy.avg_price)} required /></label>
            <label>T값<input name="t_value" type="number" min="0" step="0.0000000001" inputMode="decimal" defaultValue={String(strategy.t_value)} required /></label>
            <label>모드<select name="mode" defaultValue={strategy.mode}><option value="normal">일반모드</option><option value="reverse">리버스모드</option></select></label>
          </div>
          <div className="actions"><button type="submit">상태 저장</button></div>
        </form>
      </details>

      <details className="panel disclosure danger-zone">
        <summary>
          <span><strong>모드 전환 및 전략 삭제</strong><small>필요할 때만 열어 주세요</small></span>
          <span aria-hidden="true">＋</span>
        </summary>
        <div className="actions disclosure-body">
          <form action={switchToReverse}><input type="hidden" name="id" value={id} /><button type="submit" className="secondary">리버스모드로 전환</button></form>
          <form action={switchToNormal}><input type="hidden" name="id" value={id} /><button type="submit" className="secondary">일반모드로 복귀</button></form>
          <form action={deleteStrategy}><input type="hidden" name="id" value={id} /><button type="submit" className="danger">전략 삭제</button></form>
        </div>
      </details>
    </div>
  );
}
