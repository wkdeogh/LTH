import Link from 'next/link';
import { SetupNotice } from '@/components/SetupNotice';
import { compact, usd } from '@/components/Format';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CompletedRound, DailyPrice, Execution, Strategy } from '@/lib/types';
import { toNumber } from '@/lib/types';
import {
  buildMarketReferenceHistory,
  calculatePositionPerformance,
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

function groupByStrategy<T extends { strategy_id: string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(row.strategy_id, [...(grouped.get(row.strategy_id) ?? []), row]);
  return grouped;
}

export default async function HomePage() {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const supabase = createSupabaseServerClient();
  const { data: strategies, error } = await supabase!
    .from('strategies')
    .select('*')
    .eq('is_archived', false)
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

  const strategyIds = (strategies ?? []).map((strategy) => strategy.id);
  let dailyPrices: DailyPrice[] = [];
  let executions: Execution[] = [];
  let rounds: CompletedRound[] = [];

  if (strategyIds.length > 0) {
    const [priceResult, executionResult, roundResult] = await Promise.all([
      supabase!
        .from('daily_prices')
        .select('*')
        .in('strategy_id', strategyIds)
        .order('trade_date', { ascending: false })
        .returns<DailyPrice[]>(),
      supabase!
        .from('executions')
        .select('*')
        .in('strategy_id', strategyIds)
        .order('executed_at', { ascending: false })
        .order('created_at', { ascending: false })
        .returns<Execution[]>(),
      supabase!
        .from('completed_rounds')
        .select('*')
        .in('strategy_id', strategyIds)
        .order('created_at', { ascending: false })
        .limit(6)
        .returns<CompletedRound[]>(),
    ]);
    dailyPrices = priceResult.data ?? [];
    executions = executionResult.data ?? [];
    rounds = roundResult.data ?? [];
  }

  const pricesByStrategy = groupByStrategy(dailyPrices);
  const executionsByStrategy = groupByStrategy(executions);
  const strategyNames = new Map((strategies ?? []).map((strategy) => [strategy.id, strategy.name]));

  return (
    <div className="stack page-stack">
      <section className="hero home-hero">
        <div>
          <span className="eyebrow">MY STRATEGIES</span>
          <h1>마이 빠우라!</h1>
          <p>원칙대로 ㄱㄱ</p>
        </div>
        <Link className="text-link" href="/guide">무한매수법 사용법 보기 <span aria-hidden="true">→</span></Link>
      </section>

      {strategies && strategies.length > 0 ? (
        <section className="strategy-list" aria-label="전략 목록">
          {strategies.map((strategy) => {
            const history = buildMarketReferenceHistory(
              pricesByStrategy.get(strategy.id) ?? [],
              executionsByStrategy.get(strategy.id) ?? [],
            );
            const reference = history[0];
            const performance = calculatePositionPerformance(
              strategy.position_qty,
              toNumber(strategy.avg_price),
              reference?.price,
            );
            const progress = Math.min(Math.max((toNumber(strategy.t_value) / strategy.split_count) * 100, 0), 100);

            return (
              <article className="strategy-card" key={strategy.id}>
                <div className="strategy-card-head">
                  <div>
                    <div className="badge-row">
                      <span className={`symbol-badge symbol-${strategy.symbol.toLowerCase()}`}>{strategy.symbol}</span>
                      <span className="mode-label">{modeLabel(strategy.mode)} · {strategy.split_count}분할</span>
                    </div>
                    <h2>{strategy.name}</h2>
                  </div>
                  <div className={`return-block ${performance.profitRate !== null && performance.profitRate < 0 ? 'negative' : ''}`}>
                    <span>현재 수익률</span>
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
                  <div><span>평가손익</span><strong className={performance.profitAmount !== null && performance.profitAmount < 0 ? 'profit-negative' : 'profit-positive'}>{performance.profitAmount === null ? '-' : signedUsd(performance.profitAmount)}</strong></div>
                </div>

                <div className="card-actions">
                  <Link className="button primary" href={`/strategies/${strategy.id}/plan`}>오늘 주문 보기</Link>
                  <Link className="button ghost" href={`/strategies/${strategy.id}`}>전략 관리</Link>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="empty-state">
          <span className="empty-number">01</span>
          <h2>첫 전략을 만들어 보세요</h2>
          <p>TQQQ, SOXL, RAM 중 하나를 선택하면 주문 계산을 시작할 수 있습니다.</p>
        </section>
      )}

      <section className="add-strategy-panel">
        <div>
          <span className="eyebrow">NEW STRATEGY</span>
          <h2>새 전략 추가</h2>
          <p>새 전략은 현재 목록의 가장 아래에 추가됩니다.</p>
        </div>
        <Link className="button primary" href="/strategies/new">전략 추가하기</Link>
      </section>

      <section className="panel rounds-preview">
        <div className="section-head">
          <div>
            <span className="eyebrow">HISTORY</span>
            <h2>최근 완료 기록</h2>
          </div>
          <div className="section-head-actions">
            <span className="subtle-label">최근 {Math.min(rounds.length, 6)}건</span>
            <Link className="text-link" href="/rounds">전체 기록 관리 <span aria-hidden="true">→</span></Link>
          </div>
        </div>
        {rounds.length > 0 ? (
          <div className="round-list">
            {rounds.map((round) => (
              <Link className="round-row" href={`/strategies/${round.strategy_id}/rounds`} key={round.id}>
                <div>
                  <strong>{strategyNames.get(round.strategy_id) ?? round.symbol}</strong>
                  <span>{round.round_number}라운드 · {round.started_at} ~ {round.ended_at}</span>
                </div>
                <div className={Number(round.profit_amount) >= 0 ? 'profit-positive' : 'profit-negative'}>
                  <strong>{Number(round.profit_rate) >= 0 ? '+' : ''}{compact(round.profit_rate, 2)}%</strong>
                  <span>{signedUsd(round.profit_amount)}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : <p className="muted empty-copy">아직 완료된 라운드가 없습니다. 전량 매도를 기록하면 이곳에 자동으로 정리됩니다.</p>}
      </section>
    </div>
  );
}
