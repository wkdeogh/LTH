'use client';

import { useState } from 'react';
import { recordExecution, recordPairedExecution } from '@/app/actions';
import { compact } from '@/components/Format';
import type { OrderType, SplitCount, TEffect, TradeMode, TradeSide } from '@/lib/types';
import { applyTEffect } from '@/lib/trading';

const singleEffectOptions = [
  ['buy_full', '일반모드 1회 매수: T + 1'],
  ['buy_half', '일반모드 절반 매수: T + 0.5'],
  ['quarter_sell', '쿼터매도: T × 0.75'],
  ['full_sell', '전량매도: T = 0'],
  ['reverse_sell', '리버스 매도'],
  ['reverse_buy', '리버스 매수'],
  ['none', 'T값 변경 없음'],
] as const satisfies ReadonlyArray<readonly [TEffect, string]>;

type PairedEffect = 'limit_sell_then_full_buy' | 'limit_sell_then_half_buy';

const pairedEffectOptions: ReadonlyArray<readonly [PairedEffect, string]> = [
  ['limit_sell_then_full_buy', '1회 매수'],
  ['limit_sell_then_half_buy', '절반 매수'],
];

type Props = {
  strategyId: string;
  executedAt: string;
  currentCash: number;
  currentPosition: number;
  currentT: number;
  splitCount: SplitCount;
  currentMode: TradeMode;
  latestClose?: number;
  singleDefaults: {
    side: TradeSide;
    orderType: OrderType;
    quantity?: number;
    tEffect: TEffect;
  };
  pairedDefaults?: {
    sellQuantity?: number;
    sellPrice?: number;
    buyQuantity?: number;
    buyPrice?: number;
    tEffect: PairedEffect;
  };
};

export function ExecutionEntryForm({
  strategyId,
  executedAt: initialExecutedAt,
  currentCash,
  currentPosition,
  currentT,
  splitCount,
  currentMode,
  latestClose,
  singleDefaults,
  pairedDefaults,
}: Props) {
  const [entryKind, setEntryKind] = useState<'single' | 'paired'>('single');
  const [executedAt, setExecutedAt] = useState(initialExecutedAt);
  const [pairedEffect, setPairedEffect] = useState<PairedEffect>(
    pairedDefaults?.tEffect ?? 'limit_sell_then_full_buy',
  );

  return (
    <>
      <div className={`execution-kind-switch ${pairedDefaults ? '' : 'single-option'}`} role="group" aria-label="체결 입력 방식">
        <button
          type="button"
          className={entryKind === 'single' ? 'active' : ''}
          aria-pressed={entryKind === 'single'}
          onClick={() => setEntryKind('single')}
        >
          단일 체결
        </button>
        {pairedDefaults && (
          <button
            type="button"
            className={entryKind === 'paired' ? 'active' : ''}
            aria-pressed={entryKind === 'paired'}
            onClick={() => setEntryKind('paired')}
          >
            지정가 매도 + LOC 매수
          </button>
        )}
      </div>

      {entryKind === 'single' || !pairedDefaults ? (
        <form
          className="form execution-entry-form"
          action={recordExecution}
          data-current-cash={currentCash}
          data-current-position={currentPosition}
          data-inline-validation
          data-validation-kind="execution"
          noValidate
        >
          <input type="hidden" name="strategy_id" value={strategyId} />
          <div className="form-grid">
            <label>체결일<input name="executed_at" type="date" value={executedAt} onChange={(event) => setExecutedAt(event.target.value)} required /></label>
            <label>매수/매도<select name="side" defaultValue={singleDefaults.side}><option value="buy">매수</option><option value="sell">매도</option></select></label>
            <input type="hidden" name="order_type" value={singleDefaults.orderType} />
            <label>수량<input name="quantity" type="number" min="1" inputMode="numeric" defaultValue={singleDefaults.quantity || undefined} placeholder="체결 수량" required /></label>
            <label>평균 체결가($)<input name="avg_execution_price" type="number" min="0.0001" step="0.0001" inputMode="decimal" defaultValue={latestClose} placeholder="예: 72.3500" required /></label>
            <label>T 반영 방식<select name="t_effect" defaultValue={singleDefaults.tEffect}>{singleEffectOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          </div>

          <details className="nested-disclosure compact-disclosure">
            <summary><span><strong>T값 변화 미리 보기</strong><small>선택한 반영 방식의 결과</small></span><span aria-hidden="true">＋</span></summary>
            <div className="disclosure-body">
              <ul>
                {singleEffectOptions.map(([value, label]) => (
                  <li key={value}>{label}: {compact(applyTEffect(currentT, value, splitCount))}</li>
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
                <label>최종 모드<select name="final_mode" defaultValue={currentMode}><option value="normal">일반모드</option><option value="reverse">리버스모드</option></select></label>
              </div>
              <p className="helper-copy">매도 후 최종 보유수량이 0이면 라운드를 종료하고 기록에 남깁니다.</p>
            </div>
          </details>

          <label>메모<textarea name="memo" rows={3} placeholder="예: 별지점 LOC 매수" /></label>
          <div className="sticky-form-actions"><button type="submit" className="primary">체결 저장하기</button></div>
        </form>
      ) : (
        <form
          className="form execution-entry-form paired-execution-form"
          action={recordPairedExecution}
          data-current-cash={currentCash}
          data-current-position={currentPosition}
          data-inline-validation
          data-validation-kind="paired-execution"
          noValidate
        >
          <input type="hidden" name="strategy_id" value={strategyId} />

          <label className="paired-execution-date">체결일<input name="executed_at" type="date" value={executedAt} onChange={(event) => setExecutedAt(event.target.value)} required /></label>

          <div className="paired-execution-legs">
            <section className="execution-leg execution-leg-sell">
              <header>
                <span className="execution-leg-mark" aria-hidden="true">↓</span>
                <div><strong>지정가 매도</strong><span>LIMIT</span></div>
              </header>
              <div className="execution-leg-fields">
                <label>매도 수량<input name="sell_quantity" type="number" min="1" inputMode="numeric" defaultValue={pairedDefaults.sellQuantity || undefined} placeholder="체결 수량" required /></label>
                <label>평균 매도가($)<input name="sell_avg_execution_price" type="number" min="0.0001" step="0.0001" inputMode="decimal" defaultValue={pairedDefaults.sellPrice} placeholder="예: 82.5000" required /></label>
              </div>
            </section>

            <section className="execution-leg execution-leg-buy">
              <header>
                <span className="execution-leg-mark" aria-hidden="true">↑</span>
                <div><strong>LOC 매수</strong><span>LOC</span></div>
              </header>
              <div className="execution-leg-fields">
                <label>매수 수량<input name="buy_quantity" type="number" min="1" inputMode="numeric" defaultValue={pairedDefaults.buyQuantity || undefined} placeholder="체결 수량" required /></label>
                <label>평균 매수가($)<input name="buy_avg_execution_price" type="number" min="0.0001" step="0.0001" inputMode="decimal" defaultValue={pairedDefaults.buyPrice} placeholder="예: 68.2500" required /></label>
              </div>
            </section>
          </div>

          <div className="paired-execution-common">
            <label>T 반영 방식
              <select name="t_effect" value={pairedEffect} onChange={(event) => setPairedEffect(event.target.value as PairedEffect)}>
                {pairedEffectOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <div className="paired-t-result" aria-live="polite">
              <span>반영 후 T</span>
              <strong>{compact(applyTEffect(currentT, pairedEffect, splitCount))}</strong>
              <small>{compact(currentT)} × 0.25 + {pairedEffect === 'limit_sell_then_full_buy' ? '1' : '0.5'}</small>
            </div>
          </div>

          <label>메모<textarea name="memo" rows={3} placeholder="선택 입력" /></label>
          <div className="sticky-form-actions"><button type="submit" className="primary">매도·매수 함께 저장</button></div>
        </form>
      )}
    </>
  );
}
