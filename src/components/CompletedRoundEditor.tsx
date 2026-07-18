import { deleteCompletedRound, updateCompletedRound } from '@/app/actions';
import type { CompletedRound } from '@/lib/types';

export function CompletedRoundEditor({ round, returnPath = '/rounds' }: { round: CompletedRound; returnPath?: string }) {
  return (
    <details className="nested-disclosure record-editor">
      <summary>
        <span>
          <strong>기록 수정·삭제</strong>
          <small>금액 수정 시 수익금과 수익률은 자동 재계산됩니다</small>
        </span>
        <span aria-hidden="true">＋</span>
      </summary>

      <div className="disclosure-body record-editor-body">
        <form className="form" action={updateCompletedRound}>
          <input type="hidden" name="id" value={round.id} />
          <input type="hidden" name="strategy_id" value={round.strategy_id} />
          <input type="hidden" name="return_to" value={returnPath} />
          <div className="form-grid">
            <label>시작일<input name="started_at" type="date" defaultValue={round.started_at} required /></label>
            <label>종료일<input name="ended_at" type="date" defaultValue={round.ended_at} required /></label>
            <label>시작 원금($)<input name="started_principal" type="number" min="0.0001" step="0.0001" inputMode="decimal" defaultValue={String(round.started_principal)} required /></label>
            <label>종료 현금($)<input name="ending_cash_balance" type="number" min="0" step="0.0001" inputMode="decimal" defaultValue={String(round.ending_cash_balance)} required /></label>
            <label>매수 합계($)<input name="total_buy_amount" type="number" min="0" step="0.0001" inputMode="decimal" defaultValue={String(round.total_buy_amount)} required /></label>
            <label>매도 합계($)<input name="total_sell_amount" type="number" min="0" step="0.0001" inputMode="decimal" defaultValue={String(round.total_sell_amount)} required /></label>
            <label>종료 T값<input name="ending_t_value" type="number" min="0" step="0.0000000001" inputMode="decimal" defaultValue={String(round.ending_t_value)} required /></label>
          </div>
          <p className="helper-copy">수익금 = 종료 현금 − 시작 원금, 수익률 = 수익금 ÷ 시작 원금 × 100으로 다시 계산합니다.</p>
          <div className="actions"><button type="submit" className="secondary">기록 수정 저장</button></div>
        </form>

        <div className="record-delete-row">
          <div>
            <strong>이 완료 기록 삭제</strong>
            <p>연결된 체결 내역도 함께 삭제되며 되돌릴 수 없습니다.</p>
          </div>
          <form action={deleteCompletedRound}>
            <input type="hidden" name="id" value={round.id} />
            <input type="hidden" name="strategy_id" value={round.strategy_id} />
            <input type="hidden" name="return_to" value={returnPath} />
            <button
              type="submit"
              className="danger"
              data-confirm="이 완료 기록과 연결된 체결 내역을 모두 삭제할까요? 삭제 후에는 되돌릴 수 없습니다."
            >
              기록 삭제
            </button>
          </form>
        </div>
      </div>
    </details>
  );
}
