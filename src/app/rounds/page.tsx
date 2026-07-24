import Link from 'next/link';
import { compact, usd } from '@/components/Format';
import { CompletedRoundEditor } from '@/components/CompletedRoundEditor';
import { SetupNotice } from '@/components/SetupNotice';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CompletedRound, Execution, SymbolCode, TEffect } from '@/lib/types';

type StrategySummary = {
  id: string;
  name: string;
  symbol: SymbolCode;
  is_archived: boolean;
};

type RecordView = 'rounds' | 'executions';

const effectLabels: Record<TEffect, string> = {
  buy_full: '일반 1회 매수',
  buy_half: '일반 절반 매수',
  quarter_sell: '쿼터매도',
  full_sell: '전량매도',
  limit_sell_then_full_buy: '지정가매도 후 1회 매수',
  limit_sell_then_half_buy: '지정가매도 후 절반 매수',
  reverse_buy: '리버스 매수',
  reverse_sell: '리버스 매도',
  none: 'T값 변경 없음',
};

function signedUsd(value: number | string) {
  const number = typeof value === 'string' ? Number(value) : value;
  return `${number >= 0 ? '+' : '-'}${usd(Math.abs(number))}`;
}

function ExecutionRecords({
  executions,
  strategyById,
}: {
  executions: Execution[];
  strategyById: Map<string, StrategySummary>;
}) {
  if (executions.length === 0) {
    return (
      <section className="empty-state">
        <span className="empty-number">00</span>
        <h2>체결 기록이 없습니다</h2>
        <p>매수·매도 체결을 입력하면 이곳에서 시간순으로 확인할 수 있습니다.</p>
      </section>
    );
  }

  return (
    <section className="records-list" aria-label="전체 체결 기록">
      {executions.map((execution) => {
        const strategy = strategyById.get(execution.strategy_id);
        const isArchived = strategy?.is_archived ?? true;

        return (
          <article className="panel execution-record-card" key={execution.id}>
            <div className="record-card-head">
              <div>
                <div className="badge-row">
                  <span className={`symbol-badge symbol-${(strategy?.symbol ?? 'SOXL').toLowerCase()}`}>{strategy?.symbol ?? 'SOXL'}</span>
                  <span className={`execution-side-badge ${execution.side}`}>{execution.side === 'buy' ? '매수' : '매도'}</span>
                  {execution.round_id && <span className="archived-badge">완료 라운드</span>}
                  {isArchived && <span className="archived-badge">삭제된 전략</span>}
                </div>
                <h2>{strategy?.name ?? '삭제된 전략'}</h2>
                <p>{execution.executed_at} · {effectLabels[execution.t_effect ?? 'none']}</p>
              </div>
              <div className="execution-record-total">
                <span>체결금액</span>
                <strong>{usd(execution.total_amount)}</strong>
              </div>
            </div>

            <div className="metric-grid execution-record-metrics">
              <div><span>구분</span><strong>{execution.side === 'buy' ? '매수' : '매도'}</strong></div>
              <div><span>수량</span><strong>{execution.quantity}주</strong></div>
              <div><span>평균 체결가</span><strong>{usd(execution.avg_execution_price)}</strong></div>
              <div><span>주문 유형</span><strong>{execution.order_type}</strong></div>
            </div>

            {execution.memo && <p className="execution-record-memo"><strong>메모</strong><span>{execution.memo}</span></p>}
            {!isArchived && (
              <div className="record-card-actions">
                <Link className="text-link" href={`/strategies/${execution.strategy_id}`}>전략 상태 보기 <span aria-hidden="true">→</span></Link>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}

function RoundRecords({
  rounds,
  strategyById,
}: {
  rounds: CompletedRound[];
  strategyById: Map<string, StrategySummary>;
}) {
  if (rounds.length === 0) {
    return (
      <section className="empty-state">
        <span className="empty-number">00</span>
        <h2>라운드 기록이 없습니다</h2>
        <p>전량 매도한 라운드가 생기면 이곳에서 관리할 수 있습니다.</p>
      </section>
    );
  }

  return (
    <section className="records-list" aria-label="전체 라운드 기록">
      {rounds.map((round) => {
        const strategy = strategyById.get(round.strategy_id);
        const isArchived = strategy?.is_archived ?? true;
        const profitAmount = Number(round.profit_amount);
        const profitRate = Number(round.profit_rate);

        return (
          <article className="panel record-card" key={round.id}>
            <div className="record-card-head">
              <div>
                <div className="badge-row">
                  <span className={`symbol-badge symbol-${round.symbol.toLowerCase()}`}>{round.symbol}</span>
                  {isArchived && <span className="archived-badge">삭제된 전략</span>}
                </div>
                <h2>{strategy?.name ?? `${round.symbol} 전략`} · {round.round_number}라운드</h2>
                <p>{round.started_at} ~ {round.ended_at} · {round.split_count}분할</p>
              </div>
              <div className={profitAmount >= 0 ? 'record-profit profit-positive' : 'record-profit profit-negative'}>
                <strong>{profitRate >= 0 ? '+' : ''}{compact(profitRate, 2)}%</strong>
                <span>{signedUsd(profitAmount)}</span>
              </div>
            </div>

            <div className="metric-grid record-metrics">
              <div><span>시작 원금</span><strong>{usd(round.started_principal)}</strong></div>
              <div><span>종료 현금</span><strong>{usd(round.ending_cash_balance)}</strong></div>
              <div><span>체결</span><strong>{round.execution_count}건</strong></div>
              <div><span>종료 T값</span><strong>{compact(round.ending_t_value)}</strong></div>
            </div>

            <div className="record-card-actions">
              {!isArchived && <Link className="text-link" href={`/strategies/${round.strategy_id}/rounds`}>체결 상세 보기 <span aria-hidden="true">→</span></Link>}
            </div>

            <CompletedRoundEditor round={round} />
          </article>
        );
      })}
    </section>
  );
}

export default async function AllRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const query = await searchParams;
  const view: RecordView = query.view === 'executions' ? 'executions' : 'rounds';
  const supabase = createSupabaseServerClient();
  const [roundResult, executionResult, strategyResult] = await Promise.all([
    supabase!
      .from('completed_rounds')
      .select('*')
      .order('created_at', { ascending: false })
      .returns<CompletedRound[]>(),
    supabase!
      .from('executions')
      .select('*')
      .order('executed_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1000)
      .returns<Execution[]>(),
    supabase!
      .from('strategies')
      .select('id, name, symbol, is_archived')
      .returns<StrategySummary[]>(),
  ]);

  if (roundResult.error || executionResult.error || strategyResult.error) {
    return (
      <section className="panel">
        <h1>기록을 불러오지 못했습니다</h1>
        <p className="danger-text">{roundResult.error?.message ?? executionResult.error?.message ?? strategyResult.error?.message}</p>
      </section>
    );
  }

  const rounds = roundResult.data ?? [];
  const executions = executionResult.data ?? [];
  const strategyById = new Map((strategyResult.data ?? []).map((strategy) => [strategy.id, strategy]));

  return (
    <div className="stack page-stack records-page">
      <section className="hero compact-hero records-hero">
        <div>
          <span className="eyebrow">ALL HISTORY</span>
          <h1>거래 기록</h1>
          <p>라운드별 성과와 개별 매수·매도 체결을 선택해서 확인할 수 있습니다.</p>
        </div>
        <div className="records-summary">
          <div><span>라운드 기록</span><strong>{rounds.length}건</strong></div>
          <div><span>체결 기록</span><strong>{executions.length}건</strong></div>
        </div>
      </section>

      <nav className="record-view-tabs" aria-label="기록 종류 선택">
        <Link className={`record-view-tab ${view === 'rounds' ? 'active' : ''}`} href="/rounds">
          <span>라운드 기록</span><strong>{rounds.length}</strong>
        </Link>
        <Link className={`record-view-tab ${view === 'executions' ? 'active' : ''}`} href="/rounds?view=executions">
          <span>체결 기록</span><strong>{executions.length}</strong>
        </Link>
      </nav>

      <div className="notice-strip">
        <strong>{view === 'rounds' ? '완료된 라운드의 성과 기록입니다.' : '입력한 모든 매수·매도 체결 기록입니다.'}</strong>
        <span>{view === 'rounds' ? '라운드 기록은 아래에서 수정하거나 삭제할 수 있습니다.' : '가장 최근 체결 취소는 각 전략의 체결 입력 화면에서 할 수 있습니다.'}</span>
      </div>

      {view === 'rounds'
        ? <RoundRecords rounds={rounds} strategyById={strategyById} />
        : <ExecutionRecords executions={executions} strategyById={strategyById} />}
    </div>
  );
}
