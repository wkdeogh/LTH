import { notFound } from 'next/navigation';
import { cancelLatestExecution, recordExecution } from '@/app/actions';
import { compact, usd } from '@/components/Format';
import { SetupNotice } from '@/components/SetupNotice';
import { StrategyTabs } from '@/components/StrategyTabs';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { koreaDate } from '@/lib/date';
import type { Execution, Strategy } from '@/lib/types';
import { toStrategyState } from '@/lib/types';
import { applyTEffect, modeLabel } from '@/lib/trading';

export default async function NewExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const { id } = await params;
  const supabase = createSupabaseServerClient();
  const { data: strategy } = await supabase!.from('strategies').select('*').eq('id', id).single<Strategy>();
  if (!strategy) notFound();

  const { data: latestExecution } = await supabase!
    .from('executions')
    .select('*')
    .eq('strategy_id', id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle<Execution>();

  const state = toStrategyState(strategy);
  const effectOptions = [
    ['buy_full', '일반모드 1회 매수: T + 1'],
    ['buy_half', '일반모드 절반 매수: T + 0.5'],
    ['quarter_sell', '쿼터매도: T × 0.75'],
    ['full_sell', '전량매도: T = 0'],
    ['limit_sell_then_full_buy', '지정가매도 후 LOC 1회 매수: T × 0.25 + 1'],
    ['limit_sell_then_half_buy', '지정가매도 후 LOC 절반 매수: T × 0.25 + 0.5'],
    ['reverse_sell', '리버스 매도'],
    ['reverse_buy', '리버스 매수'],
    ['none', 'T값 변경 없음'],
  ] as const;

  return (
    <div className="stack page-stack">
      <section className="hero compact-hero">
        <span className="eyebrow">RECORD EXECUTION</span>
        <h1>{strategy.name}</h1>
        <p>증권사에서 확인한 실제 체결 결과를 입력하세요.</p>
      </section>

      <StrategyTabs strategyId={id} active="execution" />

      <section className="panel summary-panel">
        <div className="section-head">
          <div><span className="eyebrow">BEFORE</span><h2>체결 전 상태</h2></div>
          <span className="subtle-label">{modeLabel(state.mode)}</span>
        </div>
        <div className="metric-grid">
          <div className="stat"><span>T</span><strong>{compact(state.tValue)}</strong></div>
          <div className="stat"><span>현금</span><strong>{usd(state.cashBalance)}</strong></div>
          <div className="stat"><span>수량</span><strong>{state.positionQty}주</strong></div>
          <div className="stat"><span>평단</span><strong>{usd(state.avgPrice)}</strong></div>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <div><span className="eyebrow">EXECUTION</span><h2>체결 입력</h2></div>
          <span className="required-note">모두 필수</span>
        </div>
        <form className="form" action={recordExecution}>
          <input type="hidden" name="strategy_id" value={id} />
          <div className="form-grid">
            <label>체결일<input name="executed_at" type="date" defaultValue={koreaDate(-1)} required /></label>
            <label>매수/매도<select name="side" defaultValue="buy"><option value="buy">매수</option><option value="sell">매도</option></select></label>
            <input type="hidden" name="order_type" value="MANUAL" />
            <label>수량<input name="quantity" type="number" min="1" inputMode="numeric" placeholder="체결 수량" required /></label>
            <label>평균 체결가($)<input name="avg_execution_price" type="number" min="0.0001" step="0.0001" inputMode="decimal" placeholder="예: 72.3500" required /></label>
            <label>T 반영 방식<select name="t_effect" defaultValue="none">{effectOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          </div>

          <details className="nested-disclosure compact-disclosure">
            <summary><span><strong>T값 변화 미리 보기</strong><small>선택한 반영 방식의 결과를 확인하세요</small></span><span aria-hidden="true">＋</span></summary>
            <div className="disclosure-body">
            <ul>
              {effectOptions.map(([value, label]) => (
                <li key={value}>{label}: {compact(applyTEffect(state.tValue, value, state.splitCount))}</li>
              ))}
            </ul>
            </div>
          </details>

          <details className="nested-disclosure">
            <summary><span><strong>체결 후 상태 직접 보정</strong><small>자동 계산값이 증권사와 다를 때만</small></span><span aria-hidden="true">＋</span></summary>
            <div className="disclosure-body form">
              <label className="checkbox-label"><input name="use_final_state" type="checkbox" /> 아래 입력값을 최종 상태에 반영</label>
              <p className="helper-copy">현금은 체결 수량과 평균 체결가로 자동 계산합니다. 빈칸은 자동 계산값을 유지합니다.</p>
              <div className="form-grid">
                <label>최종 보유수량<input name="final_position_qty" type="number" min="0" inputMode="numeric" placeholder="비우면 자동 계산" /></label>
                <label>최종 평단($)<input name="final_avg_price" type="number" min="0" step="0.0001" inputMode="decimal" placeholder="비우면 자동 계산" /></label>
                <label>최종 T값<input name="final_t_value" type="number" min="0" step="0.0000000001" inputMode="decimal" placeholder="비우면 자동 계산" /></label>
                <label>최종 모드<select name="final_mode" defaultValue={state.mode}><option value="normal">일반모드</option><option value="reverse">리버스모드</option></select></label>
              </div>
              <p className="helper-copy">매도 후 최종 보유수량이 0이면 라운드를 종료하고 기록에 남깁니다.</p>
            </div>
          </details>

          <label>메모<textarea name="memo" rows={3} placeholder="예: 별지점 LOC 매수" /></label>
          <div className="sticky-form-actions"><button type="submit" className="primary">체결 저장하기</button></div>
        </form>
      </section>

      <details className="panel disclosure">
        <summary>
          <span>
            <strong>최근 체결 취소</strong>
            <small>{latestExecution ? '최근 입력 1건만 취소할 수 있습니다' : '취소할 체결 기록이 없습니다'}</small>
          </span>
          <span aria-hidden="true">＋</span>
        </summary>
        <div className="disclosure-body">
          {latestExecution ? (
            <div className="record-delete-row execution-cancel-row">
              <div>
                <strong>{latestExecution.executed_at} · {latestExecution.side === 'buy' ? '매수' : '매도'} {latestExecution.quantity}주</strong>
                <p>평균 체결가 {usd(latestExecution.avg_execution_price)} · 취소하면 체결 직전의 현금·수량·평단·T값으로 복원됩니다.</p>
              </div>
              <form action={cancelLatestExecution}>
                <input name="strategy_id" type="hidden" value={id} />
                <input name="execution_id" type="hidden" value={latestExecution.id} />
                <button
                  className="danger"
                  data-confirm={`${latestExecution.executed_at} ${latestExecution.side === 'buy' ? '매수' : '매도'} ${latestExecution.quantity}주 체결을 취소하고 직전 상태로 되돌릴까요?`}
                  type="submit"
                >최근 체결 취소</button>
              </form>
            </div>
          ) : <p className="muted empty-copy">취소할 체결 기록이 없습니다.</p>}
        </div>
      </details>
    </div>
  );
}
