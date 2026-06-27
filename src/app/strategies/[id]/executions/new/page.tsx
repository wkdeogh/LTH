import { notFound } from 'next/navigation';
import { recordExecution } from '@/app/actions';
import { compact, usd } from '@/components/Format';
import { SetupNotice } from '@/components/SetupNotice';
import { StrategyTabs } from '@/components/StrategyTabs';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Strategy } from '@/lib/types';
import { toStrategyState } from '@/lib/types';
import { applyTEffect, modeLabel } from '@/lib/trading';

export default async function NewExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const { id } = await params;
  const supabase = createSupabaseServerClient();
  const { data: strategy } = await supabase!.from('strategies').select('*').eq('id', id).single<Strategy>();
  if (!strategy) notFound();

  const state = toStrategyState(strategy);
  const effectOptions = [
    ['buy_full', '일반모드 1회 매수: T + 1'],
    ['buy_half', '일반모드 절반 매수: T + 0.5'],
    ['quarter_sell', '쿼터매도: T × 0.75'],
    ['limit_sell_then_full_buy', '지정가매도 후 LOC 1회 매수: T × 0.25 + 1'],
    ['limit_sell_then_half_buy', '지정가매도 후 LOC 절반 매수: T × 0.25 + 0.5'],
    ['reverse_sell', '리버스 매도'],
    ['reverse_buy', '리버스 매수'],
    ['none', 'T값 변경 없음'],
  ] as const;

  return (
    <div className="stack">
      <section className="hero">
        <h1>{strategy.name}</h1>
      </section>

      <StrategyTabs strategyId={id} active="execution" />

      <section className="panel">
        <h2>현재 저장 상태</h2>
        <div className="stat-grid">
          <div className="stat"><span>T</span><strong>{compact(state.tValue)}</strong></div>
          <div className="stat"><span>현금</span><strong>{usd(state.cashBalance)}</strong></div>
          <div className="stat"><span>수량</span><strong>{state.positionQty}주</strong></div>
          <div className="stat"><span>평단</span><strong>{usd(state.avgPrice)}</strong></div>
        </div>
      </section>

      <section className="panel">
        <h2>체결 입력</h2>
        <form className="form" action={recordExecution}>
          <input type="hidden" name="strategy_id" value={id} />
          <div className="form-grid">
            <label>체결일<input name="executed_at" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
            <label>매수/매도<select name="side" defaultValue="buy"><option value="buy">매수</option><option value="sell">매도</option></select></label>
            <label>주문 방식<select name="order_type" defaultValue="LOC"><option value="LOC">LOC</option><option value="MOC">MOC</option><option value="LIMIT">LIMIT</option><option value="MANUAL">MANUAL</option></select></label>
            <label>수량<input name="quantity" type="number" min="1" required /></label>
            <label>평균 체결가($)<input name="avg_execution_price" type="number" step="0.0001" required /></label>
            <label>T 반영 방식<select name="t_effect" defaultValue="none">{effectOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          </div>

          <details className="warning">
            <summary>현재 T값 기준 예상 예시</summary>
            <ul>
              {effectOptions.map(([value, label]) => (
                <li key={value}>{label}: {compact(applyTEffect(state.tValue, value, state.splitCount))}</li>
              ))}
            </ul>
          </details>

          <h3>체결 후 최종 상태</h3>
          <p className="muted">증권사 앱 기준 최종값을 입력하세요. 앱 계산보다 이 값이 우선됩니다.</p>
          <div className="form-grid">
            <label>최종 현금($)<input name="final_cash_balance" type="number" step="0.0001" defaultValue={state.cashBalance} required /></label>
            <label>최종 보유수량<input name="final_position_qty" type="number" defaultValue={state.positionQty} required /></label>
            <label>최종 평단($)<input name="final_avg_price" type="number" step="0.0001" defaultValue={state.avgPrice} required /></label>
            <label>최종 T값<input name="final_t_value" type="number" step="0.0000000001" placeholder="비우면 T 반영 방식으로 자동 계산" /></label>
            <label>최종 모드<select name="final_mode" defaultValue={state.mode}><option value="normal">일반모드</option><option value="reverse">리버스모드</option></select></label>
          </div>

          <label>메모<textarea name="memo" rows={3} placeholder="예: 별지점 LOC 매수" /></label>
          <div className="actions"><button type="submit">체결 저장</button></div>
        </form>
      </section>
    </div>
  );
}
