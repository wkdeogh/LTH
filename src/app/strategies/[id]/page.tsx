import { notFound } from 'next/navigation';
import { addDailyPrice, deleteStrategy, switchToNormal, switchToReverse, updateStrategy } from '@/app/actions';
import { compact, usd } from '@/components/Format';
import { SetupNotice } from '@/components/SetupNotice';
import { StrategyTabs } from '@/components/StrategyTabs';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { DailyPrice, Strategy } from '@/lib/types';
import { modeLabel } from '@/lib/trading';

export default async function StrategyPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const { id } = await params;
  const supabase = createSupabaseServerClient();
  const { data: strategy } = await supabase!.from('strategies').select('*').eq('id', id).single<Strategy>();

  if (!strategy) notFound();

  const { data: prices } = await supabase!
    .from('daily_prices')
    .select('*')
    .eq('strategy_id', id)
    .order('trade_date', { ascending: false })
    .limit(7)
    .returns<DailyPrice[]>();

  return (
    <div className="stack">
      <section className="hero">
        <h1>{strategy.name}</h1>
      </section>

      <StrategyTabs strategyId={id} active="detail" />

      <section className="panel summary-panel">
        <h2>현재 상태</h2>
        <div className="stat-grid">
          <div className="stat"><span>원금</span><strong>{usd(strategy.principal)}</strong></div>
          <div className="stat"><span>현금</span><strong>{usd(strategy.cash_balance)}</strong></div>
          <div className="stat"><span>보유수량</span><strong>{strategy.position_qty}주</strong></div>
          <div className="stat"><span>평단</span><strong>{usd(strategy.avg_price)}</strong></div>
          <div className="stat"><span>T값</span><strong>{compact(strategy.t_value)}</strong></div>
          <div className="stat"><span>리버스 첫 매도</span><strong>{strategy.reverse_first_sell_done ? '완료' : '미완료'}</strong></div>
        </div>
      </section>

      <section className="panel">
        <h2>현재 상태 직접 수정</h2>
        <form className="form" action={updateStrategy}>
          <input type="hidden" name="id" value={strategy.id} />
          <div className="form-grid">
            <label>전략명<input name="name" defaultValue={strategy.name} required /></label>
            <label>종목<select name="symbol" defaultValue={strategy.symbol}><option>TQQQ</option><option>SOXL</option></select></label>
            <label>분할 수<select name="split_count" defaultValue={strategy.split_count}><option value="20">20</option><option value="40">40</option></select></label>
            <label>원금($)<input name="principal" type="number" step="0.0001" defaultValue={String(strategy.principal)} required /></label>
            <label>현금($)<input name="cash_balance" type="number" step="0.0001" defaultValue={String(strategy.cash_balance)} required /></label>
            <label>보유수량<input name="position_qty" type="number" defaultValue={strategy.position_qty} required /></label>
            <label>평단($)<input name="avg_price" type="number" step="0.0001" defaultValue={String(strategy.avg_price)} required /></label>
            <label>T값<input name="t_value" type="number" step="0.0000000001" defaultValue={String(strategy.t_value)} required /></label>
            <label>모드<select name="mode" defaultValue={strategy.mode}><option value="normal">일반모드</option><option value="reverse">리버스모드</option></select></label>
          </div>
          <div className="actions"><button type="submit">상태 저장</button></div>
        </form>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>종가 입력</h2>
          <form className="form" action={addDailyPrice}>
            <input type="hidden" name="strategy_id" value={strategy.id} />
            <label>날짜<input name="trade_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
            <label>종가<input name="close_price" type="number" step="0.0001" required /></label>
            <button type="submit">종가 저장</button>
          </form>
        </div>

        <div className="panel">
          <h2>최근 종가</h2>
          {prices && prices.length > 0 ? (
            <table>
              <thead><tr><th>날짜</th><th>종가</th></tr></thead>
            <tbody>{prices.map((price) => <tr key={price.id}><td>{price.trade_date}</td><td>{usd(price.close_price)}</td></tr>)}</tbody>
            </table>
          ) : <p className="muted">저장된 종가가 없습니다.</p>}
        </div>
      </section>

      <section className="panel">
        <h2>모드 전환</h2>
        <div className="actions">
          <form action={switchToReverse}><input type="hidden" name="id" value={id} /><button type="submit" className="secondary">리버스모드로 전환</button></form>
          <form action={switchToNormal}><input type="hidden" name="id" value={id} /><button type="submit" className="secondary">일반모드로 복귀</button></form>
          <form action={deleteStrategy}><input type="hidden" name="id" value={id} /><button type="submit" className="danger">전략 삭제</button></form>
        </div>
      </section>
    </div>
  );
}
