import Link from 'next/link';
import { notFound } from 'next/navigation';
import { compact, usd } from '@/components/Format';
import { CompletedRoundEditor } from '@/components/CompletedRoundEditor';
import { SetupNotice } from '@/components/SetupNotice';
import { StrategyTabs } from '@/components/StrategyTabs';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CompletedRound, Execution, Strategy, TEffect } from '@/lib/types';

type RecordView = 'rounds' | 'executions';

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
    case 'full_sell':
      return '전량매도';
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

function ExecutionRecords({
  executions,
  roundNumberById,
}: {
  executions: Execution[];
  roundNumberById: Map<string, number>;
}) {
  if (executions.length === 0) {
    return (
      <section className="panel">
        <h2>아직 체결 기록이 없습니다</h2>
        <p className="muted">체결 탭에서 실제 매수·매도 결과를 입력하면 이곳에 표시됩니다.</p>
      </section>
    );
  }

  return (
    <section className="records-list" aria-label="전략 체결 기록">
      {executions.map((execution) => {
        const roundNumber = execution.round_id ? roundNumberById.get(execution.round_id) : null;

        return (
          <article className="panel execution-record-card" key={execution.id}>
            <div className="record-card-head">
              <div>
                <div className="badge-row">
                  <span className={`execution-side-badge ${execution.side}`}>{sideLabel(execution.side)}</span>
                  <span className="archived-badge">{roundNumber ? `${roundNumber}라운드` : '현재 라운드'}</span>
                </div>
                <h2>{execution.executed_at} 체결</h2>
              </div>
              <div className="execution-record-total">
                <span>체결금액</span>
                <strong>{usd(execution.total_amount)}</strong>
              </div>
            </div>

            <div className="metric-grid execution-record-metrics">
              <div><span>구분</span><strong>{sideLabel(execution.side)}</strong></div>
              <div><span>수량</span><strong>{execution.quantity}주</strong></div>
              <div><span>평균 체결가</span><strong>{usd(execution.avg_execution_price)}</strong></div>
              <div><span>T 반영</span><strong>{effectLabel(execution.t_effect)}</strong></div>
            </div>

            {execution.memo && (
              <p className="execution-record-memo">
                <strong>메모</strong>
                <span>{execution.memo}</span>
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}

function RoundRecords({
  rounds,
  executionsByRound,
  strategyId,
}: {
  rounds: CompletedRound[];
  executionsByRound: Map<string, Execution[]>;
  strategyId: string;
}) {
  if (rounds.length === 0) {
    return (
      <section className="panel">
        <h2>아직 종료된 라운드가 없습니다</h2>
        <p className="muted">체결 입력에서 매도 후 최종 보유수량을 0으로 저장하면 자동으로 라운드 기록이 생성됩니다.</p>
      </section>
    );
  }

  return rounds.map((round) => {
    const roundExecutions = executionsByRound.get(round.id) ?? [];
    const profitAmount = Number(round.profit_amount);
    const profitRate = Number(round.profit_rate);

    return (
      <section className="panel" key={round.id}>
        <div className="title-row">
          <div>
            <span className="eyebrow">COMPLETED</span>
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
                <thead><tr><th>날짜</th><th>구분</th><th>수량</th><th>평균가</th><th>금액</th><th>T 반영</th><th>메모</th></tr></thead>
                <tbody>
                  {roundExecutions.map((execution) => (
                    <tr key={execution.id}>
                      <td>{execution.executed_at}</td>
                      <td>{sideLabel(execution.side)}</td>
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

        <CompletedRoundEditor round={round} returnPath={`/strategies/${strategyId}/rounds`} />
      </section>
    );
  });
}

export default async function StrategyRoundsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const view: RecordView = query.view === 'executions' ? 'executions' : 'rounds';
  const supabase = createSupabaseServerClient();
  const [strategyResult, roundResult, executionResult] = await Promise.all([
    supabase!.from('strategies').select('*').eq('id', id).single<Strategy>(),
    supabase!
      .from('completed_rounds')
      .select('*')
      .eq('strategy_id', id)
      .order('round_number', { ascending: false })
      .returns<CompletedRound[]>(),
    supabase!
      .from('executions')
      .select('*')
      .eq('strategy_id', id)
      .order('executed_at', { ascending: true })
      .order('created_at', { ascending: true })
      .returns<Execution[]>(),
  ]);

  const strategy = strategyResult.data;
  if (!strategy) notFound();

  if (roundResult.error || executionResult.error) {
    return (
      <section className="panel">
        <h1>전략 기록을 불러오지 못했습니다</h1>
        <p className="danger-text">{roundResult.error?.message ?? executionResult.error?.message}</p>
      </section>
    );
  }

  const rounds = roundResult.data ?? [];
  const executions = executionResult.data ?? [];
  const executionsByRound = new Map<string, Execution[]>();
  const roundNumberById = new Map(rounds.map((round) => [round.id, round.round_number]));

  for (const execution of executions) {
    if (!execution.round_id) continue;
    executionsByRound.set(execution.round_id, [...(executionsByRound.get(execution.round_id) ?? []), execution]);
  }

  return (
    <div className="stack page-stack">
      <section className="hero compact-hero">
        <span className="eyebrow">STRATEGY HISTORY</span>
        <h1>{strategy.name} 전략 기록</h1>
        <p>완료된 라운드의 성과와 지금까지 입력한 체결을 선택해서 확인할 수 있습니다.</p>
      </section>

      <StrategyTabs strategyId={id} active="rounds" />

      <nav className="record-view-tabs" aria-label="전략 기록 종류 선택">
        <Link className={`record-view-tab ${view === 'rounds' ? 'active' : ''}`} href={`/strategies/${id}/rounds`}>
          <span>라운드 기록</span><strong>{rounds.length}</strong>
        </Link>
        <Link className={`record-view-tab ${view === 'executions' ? 'active' : ''}`} href={`/strategies/${id}/rounds?view=executions`}>
          <span>체결 기록</span><strong>{executions.length}</strong>
        </Link>
      </nav>

      {view === 'rounds'
        ? <RoundRecords rounds={rounds} executionsByRound={executionsByRound} strategyId={id} />
        : <ExecutionRecords executions={[...executions].reverse()} roundNumberById={roundNumberById} />}
    </div>
  );
}
