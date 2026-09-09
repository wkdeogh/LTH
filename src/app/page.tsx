import { loadStrategyReferences } from '@/lib/marketData/references';
import { toStrategyState } from '@/lib/types';
import type { Execution } from '@/lib/types';
import { calculateNormalPlan, calculateReversePlan } from '@/lib/trading';
import Link from 'next/link';
import { setMainStrategy } from '@/app/actions';
import { SetupNotice } from '@/components/SetupNotice';
import { compact, usd } from '@/components/Format';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseReadClient } from '@/lib/supabase/read';
import type { Strategy } from '@/lib/types';
import { toNumber } from '@/lib/types';
import {
  calculateAccountPerformance,
  modeLabel,
  referenceSourceLabel,
} from '@/lib/trading';


function signedUsd(value: number | string) {
  const number = typeof value === 'string' ? Number(value) : value;
  return `${number >= 0 ? '+' : '-'}${usd(Math.abs(number))}`;
}

function signedPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${compact(value, 2)}%`;
}

export default async function HomePage() {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const supabase = createSupabaseReadClient();
  const { data: strategies, error } = await supabase!
    .from('strategies')
    .select('*')
    .eq('is_archived', false)
    .order('is_main', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .returns<Strategy[]>();

  if (error) {
    return (
      <section className="panel">
        <h1>데이터를 불러오지 못했습니다</h1>
        <p className="danger-text">{error.message}</p>
      </section>
    );
  }

  const main = strategies?.find(strategy => strategy.is_main);
  const [historyEntries, recentResult] = await Promise.all([
    Promise.all((strategies ?? []).map(async strategy => [strategy.id, await loadStrategyReferences(supabase!, strategy.id, strategy.symbol)] as const)),
    main ? supabase!.from('executions').select('*').eq('strategy_id', main.id).order('executed_at', { ascending: false }).order('created_at', { ascending: false }).limit(3).returns<Execution[]>() : Promise.resolve({ data: [], error: null }),
  ]);
  if (recentResult.error) throw recentResult.error;
  const recentExecutions = recentResult.data ?? [];
  const histories = new Map(historyEntries);

  const renderStrategy = (strategy: Strategy) => {
            const history = histories.get(strategy.id) ?? [];
            const reference = history[0];
            const performance = calculateAccountPerformance(
              toNumber(strategy.principal),
              toNumber(strategy.cash_balance),
              strategy.position_qty,
              reference?.price,
            );
            const progress = Math.min(Math.max((toNumber(strategy.t_value) / strategy.split_count) * 100, 0), 100);

            return (
              <article className={`strategy-card clickable-strategy-card${strategy.is_main ? ' main-strategy-card' : ''}`} key={strategy.id}>
                <div className="strategy-primary-control">
                  {strategy.is_main ? (
                    <svg className="main-strategy-badge" viewBox="0 0 24 24" role="img" aria-label="메인 전략">
                      <defs>
                        <linearGradient id={`main-star-${strategy.id}`} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                          <stop stopColor="#38bdf8" />
                          <stop offset="0.5" stopColor="#6366f1" />
                          <stop offset="1" stopColor="#a855f7" />
                        </linearGradient>
                      </defs>
                      <path fill={`url(#main-star-${strategy.id})`} d="m12 2.5 2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55L2.48 9.42l6.58-.96L12 2.5Z" />
                    </svg>
                  ) : (
                    <form action={setMainStrategy}>
                      <input type="hidden" name="id" value={strategy.id} />
                      <button type="submit" className="main-strategy-select" aria-label={`${strategy.name} 메인으로 설정`}>메인으로 설정</button>
                    </form>
                  )}
                </div>
                <Link className="strategy-card-main-link" href={`/strategies/${strategy.id}`} aria-label={`${strategy.name} 상세 보기`}>
                  <div className="strategy-card-head">
                    <div>
                      <div className="badge-row">
                        <span className={`symbol-badge symbol-${strategy.symbol.toLowerCase()}`}>{strategy.symbol}</span>
                        <span className="mode-label">{modeLabel(strategy.mode)} · {strategy.split_count}분할</span>
                      </div>
                      <h2>{strategy.name}</h2>
                    </div>
                    <div className={`return-block ${performance.profitRate !== null && performance.profitRate < 0 ? 'negative' : ''}`}>
                      <span>원금 대비 수익률</span>
                      <strong>{performance.profitRate === null ? '-' : signedPercent(performance.profitRate)}</strong>
                    </div>
                  </div>

                  <div className="price-line">
                    <div><span>평단</span><strong>{usd(strategy.avg_price)}</strong></div>
                    <span className="price-arrow" aria-hidden="true">→</span>
                    <div><span>{referenceSourceLabel(reference?.source)}</span><strong>{reference ? usd(reference.price) : '-'}</strong></div>
                  </div>

                  <div className="turn-progress">
                    <div className="turn-progress-label">
                      <span>T 진행도</span>
                      <strong>{compact(strategy.t_value)} / {strategy.split_count}</strong>
                    </div>
                    <div className="progress-track" role="progressbar" aria-label={`${strategy.name} T 진행도`} aria-valuemin={0} aria-valuemax={strategy.split_count} aria-valuenow={toNumber(strategy.t_value)}>
                      <span style={{ width: `${progress}%` }} />
                    </div>
                  </div>

                  <div className="strategy-mini-stats">
                    <div><span>보유</span><strong>{strategy.position_qty}주</strong></div>
                    <div><span>현금</span><strong>{usd(strategy.cash_balance)}</strong></div>
                    <div><span>계좌손익</span><strong className={performance.profitAmount !== null && performance.profitAmount < 0 ? 'profit-negative' : 'profit-positive'}>{performance.profitAmount === null ? '-' : signedUsd(performance.profitAmount)}</strong></div>
                  </div>
                </Link>

                <div className="card-actions">
                  <Link className="button primary" href={`/strategies/${strategy.id}/plan`}>오늘 주문 보기</Link>
                  <Link className="button ghost" href={`/strategies/${strategy.id}/executions/new`}>체결 입력</Link>
                </div>
              </article>
            );
  };
  const others = strategies?.filter(strategy => !strategy.is_main) ?? [];
  const references = main ? histories.get(main.id) ?? [] : [];
  const state = main ? toStrategyState(main) : null;
  const plan = state ? state.mode === 'normal' ? calculateNormalPlan(state, references[0]?.price) : calculateReversePlan(state, references.slice(0,5).map(r => r.price), references[0]?.price) : null;
  return (
    <div className="stack page-stack">
      <section className="hero home-hero"><div><h1>HELLO DAEHO</h1></div></section>
      {main && <>
        <section aria-label="메인 전략">{renderStrategy(main)}</section>
        <section className="panel">
          <div className="section-head"><h2>오늘 주문</h2><Link className="text-link" href={`/strategies/${main.id}/plan`}>전체 보기 →</Link></div>
          <span className="subtle-label">{references[0] ? `${references[0].date} 종가 기준` : '기준가 없음'}</span>
          <div className="home-order-grid">{plan && [ ...plan.buyOrders.filter(o => !o.isSupplemental).map(o => ({...o, side:'매수'})), ...plan.sellOrders.filter(o => !o.isSupplemental).map(o => ({...o, side:'매도'})) ].map((order,index) => <div className={`home-order ${order.side === '매수' ? 'buy' : 'sell'}`} key={index}><span>{order.side} · {order.orderType}</span><strong>{order.price ? usd(order.price) : '시장가'}</strong><span>{order.quantity}주</span></div>)}</div>
        </section>
        <section className="panel">
          <div className="section-head"><h2>최근 체결</h2><Link className="text-link" href={`/strategies/${main.id}/rounds?view=assets`}>자산차트 →</Link></div>
          <div className="round-list">{recentExecutions.map(e => <Link className="round-row" href={`/strategies/${main.id}/rounds`} key={e.id}><div><strong>{e.side === 'buy' ? '매수' : '매도'} {e.quantity}주</strong><span>{e.executed_at}</span></div><strong>{usd(e.avg_execution_price)}</strong></Link>)}</div>
          {!recentExecutions.length && <p className="muted">아직 체결 기록이 없습니다.</p>}
        </section>
      </>}
      {others.length > 0 && <details className="panel disclosure"><summary><strong>다른 전략 {others.length}</strong><span aria-hidden="true">＋</span></summary><div className="disclosure-body strategy-list">{others.map(renderStrategy)}</div></details>}
      {!strategies?.length && <section className="empty-state"><h2>첫 전략을 만들어 보세요</h2></section>}
      <div className="actions"><Link className="button secondary" href="/strategies/new">새 전략 추가</Link><Link className="text-link" href="/rounds">전체 전략 라운드</Link></div>
    </div>
  );
}
