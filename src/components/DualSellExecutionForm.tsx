'use client';

import { useActionState, useState } from 'react';
import { submitExecution } from '@/app/actions';
import { useRetainedForm } from './useRetainedForm';
import { compact } from './Format';
import { applyTEffect } from '@/lib/trading/tValue';
import type { SplitCount } from '@/lib/types';

export type DualSellDefaults = {
  limitQuantity: number;
  limitPrice?: number;
  locQuantity: number;
  locPrice?: number;
  selected: boolean;
};

type Props = {
  strategyId: string; requestId: string; expectedVersion: number;
  executedAt: string; onDateChange: (date: string) => void;
  earliestDate: string | null; latestDate: string; dateError: string | null;
  currentPosition: number; currentT: number; splitCount: SplitCount;
  defaults: DualSellDefaults;
};

export function DualSellExecutionForm(props: Props) {
  const [feedback, action, pending] = useActionState(submitExecution, { error: null });
  const retainedForm = useRetainedForm(feedback);
  const [limitQuantity, setLimitQuantity] = useState(String(props.defaults.limitQuantity));
  const [locQuantity, setLocQuantity] = useState(String(props.defaults.locQuantity));
  const total = Number(limitQuantity) + Number(locQuantity);
  const exceedsPosition = total > props.currentPosition;
  const complete = total === props.currentPosition;
  return (
    <form className="form execution-entry-form" action={action} {...retainedForm}
      data-managed-submit="true" data-inline-validation data-validation-kind="dual-sell"
      data-current-position={props.currentPosition} noValidate>
      <input type="hidden" name="strategy_id" value={props.strategyId} />
      <input type="hidden" name="request_id" value={props.requestId} />
      <input type="hidden" name="expected_version" value={props.expectedVersion} />
      <input type="hidden" name="entry_kind" value="dual-sell" />
      <input type="hidden" name="side" value="sell" />
      <label className="paired-execution-date">체결일<input name="executed_at" type="date" min={props.earliestDate ?? undefined} max={props.latestDate} value={props.executedAt} onChange={event => props.onDateChange(event.target.value)} required /></label>
      <div className="paired-execution-legs">
        <section className="execution-leg execution-leg-sell">
          <header><span className="execution-leg-mark" aria-hidden="true">↓</span><div><strong>쿼터 매도</strong><span>LOC</span></div></header>
          <div className="execution-leg-fields">
            <label>쿼터 매도 수량<input name="loc_quantity" type="number" min="1" step="1" inputMode="numeric" value={locQuantity} onChange={event => setLocQuantity(event.target.value)} required /></label>
            <label>쿼터 체결가($)<input name="loc_price" type="number" min="0.0001" step="0.0001" inputMode="decimal" defaultValue={props.defaults.locPrice} required /></label>
          </div>
        </section>
        <section className="execution-leg execution-leg-sell">
          <header><span className="execution-leg-mark" aria-hidden="true">↓</span><div><strong>지정가 매도</strong><span>LIMIT</span></div></header>
          <div className="execution-leg-fields">
            <label>지정가 매도 수량<input name="limit_quantity" type="number" min="1" step="1" inputMode="numeric" value={limitQuantity} onChange={event => setLimitQuantity(event.target.value)} required /></label>
            <label>지정가 체결가($)<input name="limit_price" type="number" min="0.0001" step="0.0001" inputMode="decimal" defaultValue={props.defaults.limitPrice} required /></label>
          </div>
        </section>
      </div>
      <div className="paired-execution-common">
        <div className="paired-t-result"><span>매도 합계</span><strong>{compact(total)}주</strong><small>보유 {props.currentPosition}주</small></div>
        <div className="paired-t-result" aria-live="polite"><span>{complete ? '전량매도 · 라운드 종료' : '반영 후 T'}</span><strong>{exceedsPosition ? '—' : compact(applyTEffect(props.currentT, complete ? 'full_sell' : 'quarter_sell', props.splitCount))}</strong></div>
      </div>
      <label>메모<textarea name="memo" rows={3} placeholder="선택 입력" /></label>
      <p className="danger-text" role="alert">{feedback.error ?? props.dateError ?? (exceedsPosition ? `매도 합계가 보유수량 ${props.currentPosition}주를 초과합니다.` : null)}</p>
      <div className="sticky-form-actions"><button type="submit" className="primary" disabled={pending || !!props.dateError || exceedsPosition}>{pending ? '저장 중...' : '매도 2건 함께 저장'}</button></div>
    </form>
  );
}
