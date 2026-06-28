import { notFound } from 'next/navigation';
import { compact, usd } from '@/components/Format';
import { SetupNotice } from '@/components/SetupNotice';
import { StrategyTabs } from '@/components/StrategyTabs';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CompletedRound, Execution, Strategy, TEffect } from '@/lib/types';

function daysBetween(startedAt: string, endedAt: string) {
  const start = new Date(`${startedAt}T00:00:00`);
  const end = new Date(`${endedAt}T00:00:00`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return Math.max(days, 1);
}

function signedUsd(value: number | string) {
  const number = typeof value === 'string' ? Number(value) : value;
  return `${number >= 0 ? '+' : '-'}${usd(Math.abs(number))}`;
}

function sideLabel(side: Execution['side']) {
  return side === 'buy' ? '매수' : '매도';
}

function effectLabel(effect: TEffect | null) {
  switch (effect) {
    case 'buy_full':
      return '1회 매수';
    case 'buy_half':
      return '절반 매수';
    case 'quarter_sell':
      return '쿼터매도';
    case 'limit_sell_then_full_buy':
      return '지정가매도+1회매수';
    case 'limit_sell_then_half_buy':
      return '지정가매도+절반매수';
    case 'reverse_buy':
      return '리버스 매수';
    case 'reverse_sell':
      return '리버스 매도';
    case 'none':
      return '변경 없음';
    default:
      return '-';
  }
}

export default async function StrategyRoundsPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const { id } = await params;
  const supabase = createSupabaseServerClient();
  const { data: strategy } = await supabase!.from('strategies').select('*').eq('id', id).single<Strategy>();
  if (!strategy) notFound();

  const { data: rounds } = await supabase!
    .from('completed_rounds')
    .select('*')
    .eq('strategy_id', id)
    .order('round_number', { ascending: false })
    .returns<CompletedRound[]>();

  const roundIds = (rounds ?? []).map((round) => round.id);
  const { data: executions } = roundIds.length > 0
    ? await supabase!
      .from('executions')
      .select('*')
      .in('round_id', roundIds)
      .order('executed_at', { ascending: true })
      .returns<Execution[]>()
    : { data: [] as Execution[] };

  const executionsByRound = new Map<string, Execution[]>();
  for (const execution of executions ?? []) {
    if (!execution.round_id) continue;
    executionsByRound.set(execution.round_id, [...(executionsByRound.get(execution.round_id) ?? []), execution]);
  }

  return (
    <div className="stack">
      <section className="hero">
        <h1>{strategy.name} 전략 기록</h1>
        <p className="muted">전량 매도로 종료된 라운드의 수익과 체결 흐름을 모아봅니다.</p>
      </section>

      <StrategyTabs strategyId={id} active="rounds" />

      {rounds && rounds.length > 0 ? rounds.map((round) => {
        const roundExecutions = executionsByRound.get(round.id) ?? [];
        const profitAmount = Number(round.profit_amount);
        const profitRate = Number(round.profit_rate);

        return (
          <section className="panel" key={round.id}>
            <div className="title-row">
              <div>
                <h2>{round.round_number}라운드</h2>
                <p className="muted">{round.started_at} ~ {round.ended_at} · {daysBetween(round.started_at, round.ended_at)}일 · {round.symbol} {round.split_count}분할</p>
              </div>
              <span className={`pill ${profitAmount >= 0 ? '' : 'sell'}`}>{profitRate >= 0 ? '+' : ''}{compact(profitRate, 2)}%</span>
            </div>

            <div className="stat-grid">
              <div className="stat"><span>시작 원금</span><strong>{usd(round.started_principal)}</strong></div>
              <div className="stat"><span>종료 현금</span><strong>{usd(round.ending_cash_balance)}</strong></div>
              <div className="stat"><span>수익금</span><strong className={profitAmount >= 0 ? 'profit-positive' : 'profit-negative'}>{signedUsd(profitAmount)}</strong></div>
              <div className="stat"><span>체결</span><strong>{round.execution_count}건</strong></div>
              <div className="stat"><span>매수 합계</span><strong>{usd(round.total_buy_amount)}</strong></div>
              <div className="stat"><span>매도 합계</span><strong>{usd(round.total_sell_amount)}</strong></div>
            </div>

            <details className="round-details" open>
              <summary>체결 내역 {roundExecutions.length}건</summary>
              {roundExecutions.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>날짜</th><th>구분</th><th>방식</th><th>수량</th><th>평균가</th><th>금액</th><th>T 반영</th><th>메모</th></tr></thead>
                    <tbody>
                      {roundExecutions.map((execution) => (
                        <tr key={execution.id}>
                          <td>{execution.executed_at}</td>
                          <td>{sideLabel(execution.side)}</td>
                          <td>{execution.order_type}</td>
                          <td>{execution.quantity}주</td>
                          <td>{usd(execution.avg_execution_price)}</td>
                          <td>{usd(execution.total_amount)}</td>
                          <td>{effectLabel(execution.t_effect)}</td>
                          <td>{execution.memo ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="muted">연결된 체결 내역이 없습니다.</p>}
            </details>
          </section>
        );
      }) : (
        <section className="panel">
          <h2>아직 종료된 라운드가 없습니다</h2>
          <p className="muted">체결 입력에서 매도 후 최종 보유수량을 0으로 저장하면 자동으로 라운드 기록이 생성됩니다.</p>
        </section>
      )}
    </div>
  );
}
