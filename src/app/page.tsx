import Link from 'next/link';
import { SetupNotice } from '@/components/SetupNotice';
import { compact, usd } from '@/components/Format';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Strategy } from '@/lib/types';
import { modeLabel } from '@/lib/trading';

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
                <Link className="button" href={`/strategies/${strategy.id}/plan`}>오늘 계산</Link>
                <Link className="button secondary" href={`/strategies/${strategy.id}`}>상세</Link>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="panel">
          <h2>아직 전략이 없습니다</h2>
          <p className="muted">TQQQ 또는 SOXL 전략을 하나 추가하면 계산을 시작할 수 있습니다.</p>
        </section>
      )}
    </div>
  );
}
