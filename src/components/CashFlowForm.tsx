'use client';

import { useActionState, useId, useState } from 'react';
import { submitCashFlow } from '@/app/actions';
import { usd, compact } from '@/components/Format';
import { koreaDate } from '@/lib/date';
import { calculateCashFlow } from '@/lib/trading/cashFlow';
import { toStrategyState, type Strategy, type CashFlow } from '@/lib/types';
import styles from './CashFlowForm.module.css';

export function CashFlowForm({ strategy, referencePrice, earliestDate, cashFlows }: {
  strategy: Strategy; referencePrice?: number; earliestDate: string; cashFlows: CashFlow[];
}) {
  const [feedback, action, pending] = useActionState(submitCashFlow, { error: null });
  const [requestId] = useState(() => crypto.randomUUID());
  const [direction, setDirection] = useState('deposit');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(koreaDate());
  const [memo, setMemo] = useState('');
  const [timing, setTiming] = useState('');
  const [review, setReview] = useState(false);
  const choiceId = useId();
  let preview: ReturnType<typeof calculateCashFlow> | null = null;
  let previewError: string | null = null;
  if (timing === 'immediate' && Number(amount) > 0) {
    try { preview = calculateCashFlow(toStrategyState(strategy), Number(amount) * (direction === 'withdrawal' ? -1 : 1), referencePrice); }
    catch (error) { previewError = (error as Error).message; }
  }
  const reservations = cashFlows.filter(flow => flow.status === 'pending');
  return <details className="panel disclosure" id="cash-flow">
    <summary><span><strong>현금 입금·인출</strong>{reservations.length > 0 && <small>다음 라운드 반영 대기 {reservations.length}건</small>}</span><span aria-hidden="true">＋</span></summary>
    <form className={`form disclosure-body ${styles.form}`} action={action} data-managed-submit="true">
      <input type="hidden" name="strategy_id" value={strategy.id} />
      <input type="hidden" name="expected_version" value={strategy.version} />
      <input type="hidden" name="request_id" value={requestId} />
      <div className="form-grid">
        <label>구분<select name="direction" value={direction} onChange={e => { setDirection(e.target.value); setReview(false); setTiming(''); }}><option value="deposit">입금</option><option value="withdrawal">인출</option></select></label>
        <label>금액($)<input name="amount" type="number" min="0.0001" step="0.0001" inputMode="decimal" required value={amount} onChange={e => { setAmount(e.target.value); setReview(false); setTiming(''); }} /></label>
        <label>기록일<input name="requested_date" type="date" min={earliestDate} max={koreaDate()} required value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>메모<input name="memo" value={memo} onChange={e => setMemo(e.target.value)} placeholder="선택 입력" maxLength={500} /></label>
      </div>
      {!review ? <button type="button" className="secondary" onClick={e => { if (e.currentTarget.form?.reportValidity()) setReview(true); }}>반영 시점 선택</button> : <>
        <fieldset className={styles.choices}>
          <legend>이번 {direction === 'deposit' ? '입금' : '인출'} {usd(Number(amount))}을 언제 반영할까요?</legend>
          {[['immediate', '즉시 반영', '현재 라운드의 원금·현금과 T값에 반영'], ['next_round', '다음 라운드에 반영', '현재 라운드를 유지하고 종료 시 적용']].map(([value, title, description]) => <label key={value} className={timing === value ? styles.selected : ''} htmlFor={`${choiceId}-${value}`}>
            <input id={`${choiceId}-${value}`} type="radio" name="timing" value={value} checked={timing === value} onChange={e => setTiming(e.target.value)} required />
            <span><strong>{title}</strong><small>{description}</small></span>
          </label>)}
        </fieldset>
        {preview && <div className={styles.preview} aria-live="polite"><span>원금 <strong>{usd(preview.principal)}</strong></span><span>현금 <strong>{usd(preview.cashBalance)}</strong></span><span>T <strong>{compact(strategy.t_value)} → {compact(preview.tValue)}</strong></span></div>}
        {previewError && <p className="danger-text" role="alert">{previewError}</p>}
        <button type="submit" disabled={pending || !timing || !!previewError}>{pending ? '저장 중...' : timing === 'next_round' ? '다음 라운드 반영 예약' : '입출금 저장'}</button>
      </>}
      {feedback.error && <p className="danger-text" role="alert">{feedback.error}</p>}
    </form>
    {reservations.length > 0 && <div className={`disclosure-body ${styles.reservations}`} aria-label="입출금 예약">
      {reservations.map(flow => <CashFlowReservation key={flow.id} flow={flow} strategy={strategy} />)}
    </div>}
  </details>;
}

function CashFlowReservation({ flow, strategy }: { flow: CashFlow; strategy: Strategy }) {
  const [feedback, action, pending] = useActionState(submitCashFlow, { error: null });
  return <form action={action} data-managed-submit="true" className={styles.reservation}>
    <input type="hidden" name="operation" value="cancel" /><input type="hidden" name="strategy_id" value={strategy.id} /><input type="hidden" name="cash_flow_id" value={flow.id} /><input type="hidden" name="expected_version" value={strategy.version} />
    <div><strong>{Number(flow.amount) > 0 ? '입금' : '인출'} {usd(Math.abs(Number(flow.amount)))}</strong><small>{flow.requested_date} · 다음 라운드 대기</small></div>
    <button type="submit" className="secondary" disabled={pending}>{pending ? '취소 중...' : '예약 취소'}</button>
    {feedback.error && <p className="danger-text" role="alert">{feedback.error}</p>}
  </form>;
}
