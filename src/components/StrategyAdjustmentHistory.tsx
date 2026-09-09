import { compact, usd } from '@/components/Format';
import type { StrategyAdjustment } from '@/lib/trading/assetHistory';

const fields = [
  ['name','전략명'],['symbol','종목'],['split_count','분할 수'],['principal','원금'],
  ['cash_balance','현금'],['position_qty','보유수량'],['avg_price','평단'],['t_value','T값'],['mode','모드'],
] as const;
function format(key: string, value: unknown) {
  if (value == null) return '-';
  if (['principal','cash_balance','avg_price'].includes(key)) return usd(Number(value));
  if (key === 'position_qty') return `${value}주`;
  if (key === 't_value') return compact(Number(value));
  if (key === 'mode') return value === 'normal' ? '일반모드' : '리버스모드';
  return String(value);
}
export function StrategyAdjustmentHistory({ adjustments }: { adjustments: StrategyAdjustment[] }) {
  const corrections = adjustments.filter(a => a.kind === 'correction');
  if (!corrections.length) return null;
  return <details className="panel disclosure">
    <summary><strong>상태 보정 이력</strong><span aria-hidden="true">＋</span></summary>
    <div className="disclosure-body round-list">{corrections.map(a => <div className="round-row correction-row" key={a.id}>
      <div><strong>{a.effective_date}</strong>{a.reason && <span>{a.reason}</span>}</div>
      <div>{fields.filter(([key]) => String(a.before_state[key]) !== String(a.after_state[key])).map(([key,label]) => <span key={key}>{label} {format(key,a.before_state[key])} → {format(key,a.after_state[key])}</span>)}</div>
    </div>)}</div>
  </details>;
}
