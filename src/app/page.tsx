import { InitialPrincipalReturn } from '@/components/InitialPrincipalReturn';
import { loadInitialPrincipal } from '@/lib/supabase/initialPrincipal';
import { loadStrategyReferences } from '@/lib/marketData/references';
import { toStrategyState } from '@/lib/types';
import type { Execution } from '@/lib/types';
import { calculateNormalPlan, calculateReversePlan } from '@/lib/trading';
import Link from 'next/link';
import { STRATEGY_ID } from '@/lib/strategyConfig';
import { SetupNotice } from '@/components/SetupNotice';
import { compact, usd } from '@/components/Format';
import { getAppDisplayName, hasSupabaseEnv } from '@/lib/env';
import { createSupabaseReadClient } from '@/lib/supabase/read';
import type { Strategy } from '@/lib/types';
import { toNumber } from '@/lib/types';
import {
  calculateAccountPerformance,
  modeLabel,
  referenceSourceLabel,
} from '@/lib/trading';

export const dynamic = 'force-dynamic';

function signedUsd(value: number | string) {
  const number = typeof value === 'string' ? Number(value) : value;
  return `${number >= 0 ? '+' : '-'}${usd(Math.abs(number))}`;
}

function signedPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${compact(value, 2)}%`;
}

export default async function HomePage() {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const supabase = await createSupabaseReadClient();
  const { data: current, error } = await supabase!.from('strategies').select('*')
    .eq('id', STRATEGY_ID).eq('is_archived', false).single<Strategy>();
  if (error) throw error;

  const [references, recentResult, initialPrincipal] = await Promise.all([
    loadStrategyReferences(supabase!, current.id, current.symbol),
    supabase!.from('executions').select('*').eq('strategy_id', current.id).order('executed_at', { ascending: false }).order('created_at', { ascending: false }).limit(3).returns<Execution[]>(),
    loadInitialPrincipal(supabase!, current.id, toNumber(current.principal)),
  ]);
  if (recentResult.error) throw recentResult.error;
  const recentExecutions = recentResult.data ?? [];

  const history = references;
  const reference = history[0];
  const performance = calculateAccountPerformance(
    toNumber(current.principal),
    toNumber(current.cash_balance),
    current.position_qty,
    reference?.price,
  );
  const progress = Math.min(Math.max((toNumber(current.t_value) / current.split_count) * 100, 0), 100);

  const strategyCard = (
    <article className="strategy-card clickable-strategy-card current-strategy-card">
      <Link className="strategy-card-main-link" href={`/strategies/${current.id}`} aria-label={`${current.name} 상세 보기`}>
        <div className="strategy-card-head">
          <div>
            <div className="badge-row">
              <span className={`symbol-badge symbol-${current.symbol.toLowerCase()}`}>{current.symbol}</span>
              <span className="mode-label">{modeLabel(current.mode)} · {current.split_count}분할</span>
            </div>
            <h2>{current.name}</h2>
          </div>
          <div className={`return-block ${performance.profitRate !== null && performance.profitRate < 0 ? 'negative' : ''}`}>
            <span>원금 대비 수익률</span>
            <strong>{performance.profitRate === null ? '-' : signedPercent(performance.profitRate)}</strong>
          </div>
        </div>

        <div className="price-line">
          <div><span>평단</span><strong>{usd(current.avg_price)}</strong></div>
          <span className="price-arrow" aria-hidden="true">→</span>
          <div><span>{referenceSourceLabel(reference?.source)}</span><strong>{reference ? usd(reference.price) : '-'}</strong></div>
        </div>

        <div className="turn-progress">
          <div className="turn-progress-label">
            <span>T 진행도</span>
            <strong>{compact(current.t_value)} / {current.split_count}</strong>
          </div>
          <div className="progress-track" role="progressbar" aria-label={`${current.name} T 진행도`} aria-valuemin={0} aria-valuemax={current.split_count} aria-valuenow={toNumber(current.t_value)}>
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="strategy-mini-stats">
          <div><span>보유</span><strong>{current.position_qty}주</strong></div>
          <div><span>현금</span><strong>{usd(current.cash_balance)}</strong></div>
          <div><span>현재 라운드 손익</span><strong className={performance.profitAmount !== null && performance.profitAmount < 0 ? 'profit-negative' : 'profit-positive'}>{performance.profitAmount === null ? '-' : signedUsd(performance.profitAmount)}</strong></div>
        </div>
        <InitialPrincipalReturn principal={initialPrincipal} cash={toNumber(current.cash_balance)} quantity={current.position_qty} price={reference?.price} />
      </Link>

      <div className="card-actions">
        <Link className="button primary" href={`/strategies/${current.id}/plan`}>오늘 주문 보기</Link>
        <Link className="button ghost" href={`/strategies/${current.id}/executions/new`}>체결 입력</Link>
      </div>
    </article>
  );
  const state = toStrategyState(current);
  const plan = state.mode === 'normal' ? calculateNormalPlan(state, references[0]?.price) : calculateReversePlan(state, references.slice(0,5).map(r => r.price), references[0]?.price);
  return (
    <div className="stack page-stack">
      <section className="hero home-hero"><div><h1>HELLO {getAppDisplayName()}</h1></div></section>
        <section aria-label="SOXL 20분할">{strategyCard}</section>
        <section className="panel">
          <div className="section-head"><h2>오늘 주문</h2><Link className="text-link" href={`/strategies/${current.id}/plan`}>전체 보기 →</Link></div>
          <span className="subtle-label">{references[0] ? `${references[0].date} 종가 기준` : '기준가 없음'}</span>
          <div className="home-order-grid">{[ ...plan.buyOrders.filter(o => !o.isSupplemental).map(o => ({...o, side:'매수'})), ...plan.sellOrders.filter(o => !o.isSupplemental).map(o => ({...o, side:'매도'})) ].map((order,index) => <div className={`home-order ${order.side === '매수' ? 'buy' : 'sell'}`} key={index}><span>{order.side} · {order.orderType}</span><strong>{order.price ? usd(order.price) : '시장가'}</strong><span>{order.quantity}주</span></div>)}</div>
        </section>
        <section className="panel">
          <div className="section-head"><h2>최근 체결</h2><Link className="text-link" href={`/strategies/${current.id}/rounds?view=assets`}>자산차트 →</Link></div>
          <div className="round-list">{recentExecutions.map(e => <Link className="round-row" href={`/strategies/${current.id}/rounds`} key={e.id}><div><strong>{e.side === 'buy' ? '매수' : '매도'} {e.quantity}주</strong><span>{e.executed_at}</span></div><strong>{usd(e.avg_execution_price)}</strong></Link>)}</div>
          {!recentExecutions.length && <p className="muted">아직 체결 기록이 없습니다.</p>}
        </section>
      <div className="actions"><Link className="text-link" href={'/strategies/' + current.id + '/rounds?view=rounds'}>라운드 기록</Link></div>
    </div>
  );
}
