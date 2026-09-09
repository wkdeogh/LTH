'use client';
import { useRetainedForm } from '@/components/useRetainedForm';
import { useActionState } from 'react';
import { submitStrategyCorrection } from '@/app/actions';
import { koreaDate } from '@/lib/date';
import type { Strategy } from '@/lib/types';

export function StrategyCorrectionForm({ strategy }: { strategy: Strategy }) {
  const [feedback, action, pending] = useActionState(submitStrategyCorrection, { error: null });
  const form = useRetainedForm(feedback);
  return (
        <form className="form disclosure-body" action={action} {...form} data-managed-submit="true" data-inline-validation data-validation-kind="strategy" noValidate>
          <input type="hidden" name="id" value={strategy.id} />
          <input type="hidden" name="expected_version" value={strategy.version} />
          <div className="form-grid">
            <label>적용일<input name="effective_date" type="date" max={koreaDate()} defaultValue={koreaDate()} required /></label>
            <label>전략명<input name="name" defaultValue={strategy.name} required /></label>
            <label>종목<select name="symbol" defaultValue={strategy.symbol}><option>TQQQ</option><option>SOXL</option></select></label>
            <label>분할 수<select name="split_count" defaultValue={strategy.split_count}><option value="20">20</option><option value="40">40</option></select></label>
            <label>원금($)<input name="principal" type="number" min="0.0001" step="0.0001" inputMode="decimal" defaultValue={String(strategy.principal)} required /></label>
            <label>현금($)<input name="cash_balance" type="number" min="0" step="0.0001" inputMode="decimal" defaultValue={String(strategy.cash_balance)} required /></label>
            <label>보유수량<input name="position_qty" type="number" min="0" inputMode="numeric" defaultValue={strategy.position_qty} required /></label>
            <label>평단($)<input name="avg_price" type="number" min="0" step="0.0001" inputMode="decimal" defaultValue={String(strategy.avg_price)} required /></label>
            <label>T값<input name="t_value" type="number" min="0" step="0.0000000001" inputMode="decimal" defaultValue={String(strategy.t_value)} required /></label>
            <label>모드<select name="mode" defaultValue={strategy.mode}><option value="normal">일반모드</option><option value="reverse">리버스모드</option></select></label>
          </div>
          <label>보정 사유<input name="reason" placeholder="선택 입력" /></label>
          <p className="danger-text" role="alert">{feedback.error}</p>
          <div className="actions"><button type="submit" disabled={pending}>{pending ? '저장 중...' : '상태 저장'}</button></div>
        </form>
  );
}
