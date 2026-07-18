import { notFound } from 'next/navigation';
import { addDailyPrice, deleteStrategy, switchToNormal, switchToReverse, updateStrategy } from '@/app/actions';
import { compact, usd } from '@/components/Format';
import { SetupNotice } from '@/components/SetupNotice';
import { StrategyTabs } from '@/components/StrategyTabs';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { DailyPrice, Execution, Strategy } from '@/lib/types';
import { toNumber } from '@/lib/types';
import {
  buildMarketReferenceHistory,
  calculatePositionPerformance,
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

  const [priceResult, executionResult] = await Promise.all([
    supabase!
      .from('daily_prices')
      .select('*')
      .eq('strategy_id', id)
      .order('trade_date', { ascending: false })
      .limit(7)
      .returns<DailyPrice[]>(),
    supabase!
      .from('executions')
      .select('*')
      .eq('strategy_id', id)
      .order('executed_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10)
      .returns<Execution[]>(),
  ]);

  const prices = priceResult.data ?? [];
  const executions = executionResult.data ?? [];
  const references = buildMarketReferenceHistory(prices, executions);
  const reference = references[0];
  const performance = calculatePositionPerformance(
    strategy.position_qty,
    toNumber(strategy.avg_price),
    reference?.price,
  );
  const isNegative = performance.profitRate !== null && performance.profitRate < 0;

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
          <span>평단 대비 현재 수익률</span>
          <strong>{performance.profitRate === null ? '-' : signedValue(performance.profitRate, '%')}</strong>
          <p>
            {reference
              ? `${referenceSourceLabel(reference.source)} ${usd(reference.price)} · ${reference.date}`
              : strategy.position_qty > 0
                ? '종가나 체결가가 기록되면 자동으로 계산됩니다.'
                : '보유 중인 수량이 없습니다.'}
          </p>
        </div>
        <div className="performance-details">
          <div><span>평가금액</span><strong>{performance.marketValue === null ? '-' : usd(performance.marketValue)}</strong></div>
          <div><span>평가손익</span><strong>{performance.profitAmount === null ? '-' : `${performance.profitAmount >= 0 ? '+' : '-'}${usd(Math.abs(performance.profitAmount))}`}</strong></div>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">CURRENT STATE</span>
            <h2>현재 전략 상태</h2>
          </div>
          <span className="subtle-label">T {compact(strategy.t_value)}</span>
        </div>
        <div className="metric-grid">
          <div><span>원금</span><strong>{usd(strategy.principal)}</strong></div>
          <div><span>현금</span><strong>{usd(strategy.cash_balance)}</strong></div>
          <div><span>보유수량</span><strong>{strategy.position_qty}주</strong></div>
          <div><span>평단</span><strong>{usd(strategy.avg_price)}</strong></div>
          <div><span>T값</span><strong>{compact(strategy.t_value)}</strong></div>
          <div><span>리버스 첫 매도</span><strong>{strategy.reverse_first_sell_done ? '완료' : '미완료'}</strong></div>
        </div>
      </section>

      <section className="two-column-grid">
        <div className="panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">OPTIONAL</span>
              <h2>종가 직접 입력</h2>
            </div>
          </div>
          <p className="helper-copy">입력하지 않아도 괜찮습니다. 최근 체결가를 종가로 보고 수익률과 복귀 조건을 계산합니다.</p>
          <form className="form" action={addDailyPrice}>
            <input type="hidden" name="strategy_id" value={strategy.id} />
            <div className="inline-form-grid">
              <label>거래일<input name="trade_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
              <label>종가($)<input name="close_price" type="number" min="0.0001" step="0.0001" inputMode="decimal" placeholder="예: 72.35" required /></label>
            </div>
            <button type="submit" className="secondary">종가 저장</button>
          </form>
        </div>

        <div className="panel">
          <div className="section-head">
            <div>
              <span className="eyebrow">PRICE HISTORY</span>
              <h2>최근 계산 기준가</h2>
            </div>
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
        </div>
      </section>

      <details className="panel disclosure">
        <summary>
          <span><strong>현재 상태 직접 수정</strong><small>증권사 값과 다를 때만 사용하세요</small></span>
          <span aria-hidden="true">＋</span>
        </summary>
        <form className="form disclosure-body" action={updateStrategy}>
          <input type="hidden" name="id" value={strategy.id} />
          <div className="form-grid">
            <label>전략명<input name="name" defaultValue={strategy.name} required /></label>
            <label>종목<select name="symbol" defaultValue={strategy.symbol}><option>TQQQ</option><option>SOXL</option><option>RAM</option></select></label>
            <label>분할 수<select name="split_count" defaultValue={strategy.split_count}><option value="20">20</option><option value="40">40</option></select></label>
            <label>원금($)<input name="principal" type="number" min="0" step="0.0001" inputMode="decimal" defaultValue={String(strategy.principal)} required /></label>
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
