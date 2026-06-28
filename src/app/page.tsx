import Link from 'next/link';
import { SetupNotice } from '@/components/SetupNotice';
import { compact, usd } from '@/components/Format';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { CompletedRound, Strategy } from '@/lib/types';
import { modeLabel } from '@/lib/trading';

function signedUsd(value: number | string) {
  const number = typeof value === 'string' ? Number(value) : value;
  return `${number >= 0 ? '+' : '-'}${usd(Math.abs(number))}`;
}

export default async function HomePage() {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const supabase = createSupabaseServerClient();
  const { data: strategies, error } = await supabase!
    .from('strategies')
    .select('*')
    .eq('is_archived', false)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .returns<Strategy[]>();

  if (error) {
    return (
      <section className="panel">
        <h1>DB 오류</h1>
        <p className="danger-text">{error.message}</p>
      </section>
    );
  }

  const { data: rounds } = await supabase!
    .from('completed_rounds')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(8)
    .returns<CompletedRound[]>();

  const strategyNames = new Map((strategies ?? []).map((strategy) => [strategy.id, strategy.name]));

  return (
    <div className="stack">
      <section className="hero">
        <div className="title-row">
          <h1>전략 목록</h1>
          <Link className="button" href="/strategies/new">전략 추가</Link>
        </div>
      </section>

      {strategies && strategies.length > 0 ? (
        <section className="grid">
          {strategies.map((strategy) => (
            <article className="card" key={strategy.id}>
              <div className="actions" style={{ justifyContent: 'space-between' }}>
                <span className="pill">{modeLabel(strategy.mode)}</span>
                <span className="pill sell">{strategy.symbol} {strategy.split_count}분할</span>
              </div>
              <h2>{strategy.name}</h2>
              <div className="stat-grid">
                <div className="stat"><span>T</span><strong>{compact(strategy.t_value)}</strong></div>
                <div className="stat"><span>현금</span><strong>{usd(strategy.cash_balance)}</strong></div>
                <div className="stat"><span>수량</span><strong>{strategy.position_qty}주</strong></div>
                <div className="stat"><span>평단</span><strong>{usd(strategy.avg_price)}</strong></div>
              </div>
              <div className="actions" style={{ marginTop: 16 }}>
                <Link className="button" href={`/strategies/${strategy.id}/plan`}>주문 계산</Link>
                <Link className="button secondary" href={`/strategies/${strategy.id}`}>상세</Link>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="panel">
          <h2>아직 전략이 없습니다</h2>
          <p className="muted">TQQQ, SOXL, RAM 전략을 하나 추가하면 계산을 시작할 수 있습니다.</p>
        </section>
      )}

      <section className="panel">
        <div className="title-row">
          <h2>전략 기록</h2>
          <span className="pill">최근 종료 라운드</span>
        </div>
        {rounds && rounds.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>전략</th><th>라운드</th><th>기간</th><th>수익률</th><th>수익금</th><th>체결</th></tr></thead>
              <tbody>
                {rounds.map((round) => (
                  <tr key={round.id}>
                    <td><Link href={`/strategies/${round.strategy_id}/rounds`}>{strategyNames.get(round.strategy_id) ?? round.symbol}</Link></td>
                    <td>{round.round_number}라운드</td>
                    <td>{round.started_at} ~ {round.ended_at}</td>
                    <td>{Number(round.profit_rate) >= 0 ? '+' : ''}{compact(round.profit_rate, 2)}%</td>
                    <td className={Number(round.profit_amount) >= 0 ? 'profit-positive' : 'profit-negative'}>{signedUsd(round.profit_amount)}</td>
                    <td>{round.execution_count}건</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">아직 종료된 라운드 기록이 없습니다.</p>}
      </section>
    </div>
  );
}
