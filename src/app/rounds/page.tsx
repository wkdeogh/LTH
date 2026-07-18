import Link from 'next/link';
import { compact, usd } from '@/components/Format';
import { CompletedRoundEditor } from '@/components/CompletedRoundEditor';
import { SetupNotice } from '@/components/SetupNotice';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CompletedRound } from '@/lib/types';

type StrategySummary = {
  id: string;
  name: string;
  is_archived: boolean;
};

function signedUsd(value: number | string) {
  const number = typeof value === 'string' ? Number(value) : value;
  return `${number >= 0 ? '+' : '-'}${usd(Math.abs(number))}`;
}

export default async function AllRoundsPage() {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const supabase = createSupabaseServerClient();
  const [roundResult, strategyResult] = await Promise.all([
    supabase!
      .from('completed_rounds')
      .select('*')
      .order('created_at', { ascending: false })
      .returns<CompletedRound[]>(),
    supabase!
      .from('strategies')
      .select('id, name, is_archived')
      .returns<StrategySummary[]>(),
  ]);

  if (roundResult.error || strategyResult.error) {
    return (
      <section className="panel">
        <h1>기록을 불러오지 못했습니다</h1>
        <p className="danger-text">{roundResult.error?.message ?? strategyResult.error?.message}</p>
      </section>
    );
  }

  const rounds = roundResult.data ?? [];
  const strategyById = new Map((strategyResult.data ?? []).map((strategy) => [strategy.id, strategy]));
  const archivedCount = rounds.filter((round) => strategyById.get(round.strategy_id)?.is_archived).length;

  return (
    <div className="stack page-stack records-page">
      <section className="hero compact-hero records-hero">
        <div>
          <span className="eyebrow">ALL HISTORY</span>
          <h1>완료 기록 관리</h1>
          <p>활성 전략과 삭제된 전략의 완료 기록을 모두 확인하고 수정하거나 삭제할 수 있습니다.</p>
        </div>
        <div className="records-summary">
          <div><span>전체 기록</span><strong>{rounds.length}건</strong></div>
          <div><span>삭제된 전략 기록</span><strong>{archivedCount}건</strong></div>
        </div>
      </section>

      <div className="notice-strip">
        <strong>메인에는 활성 전략의 기록만 표시됩니다.</strong>
        <span>삭제된 전략의 테스트 기록은 이 화면에서 정리할 수 있습니다.</span>
      </div>

      {rounds.length > 0 ? (
        <section className="records-list" aria-label="전체 완료 기록">
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
      ) : (
        <section className="empty-state">
          <span className="empty-number">00</span>
          <h2>완료 기록이 없습니다</h2>
          <p>전량 매도한 라운드가 생기면 이곳에서 관리할 수 있습니다.</p>
        </section>
      )}
    </div>
  );
}
