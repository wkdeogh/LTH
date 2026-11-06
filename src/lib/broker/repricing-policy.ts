import type { OrderGuide } from '@/lib/trading/normalMode';
import type { BrokerRow } from './meritz';
import { processGuide, type ApiOrder, type GuidePlan } from './policy';
import { pollRead, type PollOptions } from './polling';

export type TrackedOrder = { id: string; order_key: string; body: Record<string, unknown>; guide_order: ApiOrder;
  status: string; broker_order_no: string | null; broker_order_date: string | null; attempted_at: string };
export type CancellationTarget = { order: TrackedOrder; history: BrokerRow; quantity: number };
export function exceedsFivePercent(initial: number, current: number) {
  if (![initial,current].every(p => Number.isFinite(p) && p > 0 && Math.round(p * 10000) > 0 && Number.isSafeInteger(Math.round(p * 10000)))) throw new Error('비교할 현재가가 유효하지 않습니다.');
  const a = BigInt(Math.round(initial * 10000)), b = BigInt(Math.round(current * 10000));
  return (a > b ? a - b : b - a) * BigInt(100) > a * BigInt(5);
}
export function historyIdentity(row: BrokerRow) { return `${row.oder_date}:${row.oder_no}`; }
export function matchesTrackedOrder(order: TrackedOrder, row: BrokerRow, recoverNumber = false) {
  if (String(row.oder_rctf_cncl_cls_code) !== '0') return false;
  if (!recoverNumber && String(row.oder_no) !== order.broker_order_no) return false;
  if (order.broker_order_date && String(row.oder_date) !== order.broker_order_date) return false;
  const symbol = String(row.ovrs_stck_symb_iscd ?? row.iscd ?? '').split('.')[0];
  if (![Number(row.ovrs_stck_oder_prc), Number(order.body.ovrs_stck_oder_prc)].every(Number.isFinite)) return false;
  if (symbol !== order.body.ovrs_stck_symb_iscd || Number(row.oder_dqty ?? row.odqt) !== order.guide_order.quantity
    || String(row.seln_byov_clcd) !== (order.guide_order.side === 'buy' ? '2' : '1')
    || String(row.aspr_type_code) !== ({LIMIT:'2',LOC:'5',MOC:'7'})[order.guide_order.orderType]
    || Math.abs(Number(row.ovrs_stck_oder_prc) - Number(order.body.ovrs_stck_oder_prc)) > 0.00001) return false;
  // Order numbers can repeat on the next Korea-local order date. Until the
  // broker's official date is known, disambiguate with the recorded attempt.
  if (!order.broker_order_date) {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(row.oder_exec_ymdh))) return false;
    const elapsed = Date.parse(`${String(row.oder_exec_ymdh).replace(' ','T')}+09:00`) - Date.parse(order.attempted_at);
    if (!Number.isFinite(elapsed) || elapsed < -5000 || elapsed > 120000) return false;
  }
  return true;
}
function sourceKey(o: OrderGuide) { return JSON.stringify([o.side,o.orderType,o.label,o.price,!!o.isSupplemental,!!o.completesBuyUnit]); }
export function planReplacement(plan: GuidePlan, orders: TrackedOrder[], history: BrokerRow[], price: number) {
  if (!orders.length || orders.some(o => o.status !== 'accepted' || !o.broker_order_no || o.order_key.startsWith('reprice:'))) throw new Error('1차 주문 접수 상태를 확인해 주세요.');
  const targets: CancellationTarget[] = [], completed = new Set<string>(), identities = new Set<string>();
  let buyQuantity = 0, sellQuantity = 0, cashChange = 0;
  for (const order of orders) {
    const matches = history.filter(r => matchesTrackedOrder(order, r));
    if (matches.length !== 1) throw new Error('1차 주문과 증권사 주문내역의 연결이 불명확합니다.');
    const row = matches[0], identity = historyIdentity(row);
    if (identities.has(identity) || !/^\d{8}$/.test(String(row.oder_date))) throw new Error('주문 날짜·번호가 중복되거나 잘못되었습니다.');
    identities.add(identity);
    const qty = Number(row.oder_dqty ?? row.odqt), filled = Number(row.cntg_dqty ?? row.cntg_qty);
    if (!['0','3'].includes(String(row.ovrs_stck_oder_stat_cls_code)) || !Number.isSafeInteger(filled) || filled < 0 || filled > qty) throw new Error('1차 주문의 수량·접수 상태를 확인해 주세요.');
    if (filled > 0 && filled < qty) throw new Error('부분체결 주문이 있어 자동 취소·재주문을 보류했습니다.');
    if (filled === qty) {
      const amount = Number(row.cntg_camt);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('기체결 금액을 확인하지 못했습니다.');
      if (order.guide_order.side === 'buy') { buyQuantity += filled; cashChange -= amount; }
      else { sellQuantity += filled; cashChange += amount; }
      for (const source of order.guide_order.sources) {
        const key = sourceKey(source);
        if (completed.has(key)) throw new Error('기체결 주문의 가이드 수량이 중복됩니다.');
        completed.add(key);
      }
    } else targets.push({order,history:row,quantity:qty});
  }
  if (history.some(r => String(r.oder_rctf_cncl_cls_code) === '0'
    && !['1','2','4'].includes(String(r.ovrs_stck_oder_stat_cls_code)) && !identities.has(historyIdentity(r)))) throw new Error('앱의 1차 주문 외에 다른 SOXL 주문이 있어 재주문을 보류했습니다.');
  if (history.some(r => String(r.oder_rctf_cncl_cls_code) !== '0'
    && orders.some(o => String(r.orgl_oder_no) === o.broker_order_no))) throw new Error('1차 주문에 별도의 정정·취소 내역이 있습니다.');
  const remaining = { ...plan, buyOrders: plan.buyOrders.filter(o => !completed.has(sourceKey(o))), sellOrders: plan.sellOrders.filter(o => !completed.has(sourceKey(o))) } as GuidePlan;
  return { targets, completed, identities, processed: processGuide(remaining, price), buyQuantity, sellQuantity, cashChange };
}
export function cancellableRow(target: CancellationTarget, live: BrokerRow[]) {
  const rows = live.filter(r => String(r.oder_date) === String(target.history.oder_date) && String(r.oder_no) === target.order.broker_order_no && String(r.oder_rctf_cncl_cls_code) === '0');
  if (rows.length !== 1) throw new Error('원주문의 현재 취소 가능 내역을 확인하지 못했습니다.');
  const row = rows[0];
  if (Number(row.cntg_qty) !== 0 || Number(row.odqt) !== target.quantity || Number(row.cncl_cnfr_qty) !== 0
    || Number(row.rctf_cnfr_qty) !== 0 || Number(row.oder_able_qty) !== target.quantity || Number(row.ncnt_qty) !== target.quantity) throw new Error('체결·정정 또는 취소 가능 수량이 바뀌어 재주문을 보류했습니다.');
  return row;
}
function hasQuantity(row: BrokerRow, key: string, expected: number) {
  const value = row[key];
  return value !== null && value !== undefined && String(value).trim() !== ''
    && Number.isSafeInteger(Number(value)) && Number(value) === expected;
}
export function isCancellationConfirmed(target: CancellationTarget, live: BrokerRow[], cancelNo: string) {
  if (!/^[1-9]\d*$/.test(cancelNo) || cancelNo === target.order.broker_order_no) return false;
  const rows = live.filter(r => String(r.oder_date) === String(target.history.oder_date) && String(r.oder_no) === target.order.broker_order_no && String(r.oder_rctf_cncl_cls_code) === '0');
  const cancellations = live.filter(r => String(r.oder_date) === String(target.history.oder_date)
    && String(r.oder_no) === cancelNo && String(r.orgl_oder_no) === target.order.broker_order_no
    && String(r.oder_rctf_cncl_cls_code) === '2');
  if (rows.length !== 1 || cancellations.length !== 1) return false;
  const row = rows[0], cancellation = cancellations[0];
  // Meritz reports confirmed cancellation quantity on the cancellation row;
  // the original row can keep cncl_cnfr_qty=0 even after full cancellation.
  return matchesTrackedOrder(target.order, row)
    && String(cancellation.ovrs_stck_symb_iscd ?? cancellation.iscd ?? '').split('.')[0] === target.order.body.ovrs_stck_symb_iscd
    && String(cancellation.seln_byov_clcd) === String(row.seln_byov_clcd)
    && String(cancellation.ovrs_stck_oder_stat_cls_code) === '0'
    && String(cancellation.rctf_cncl_cls_code) === '3'
    && hasQuantity(row, 'odqt', target.quantity)
    && ['cntg_qty','rctf_cnfr_qty','ncnt_qty','oder_able_qty'].every(key => hasQuantity(row, key, 0))
    && hasQuantity(cancellation, 'odqt', target.quantity)
    && hasQuantity(cancellation, 'cncl_cnfr_qty', target.quantity)
    && ['cntg_qty','rctf_cnfr_qty','ncnt_qty','oder_able_qty'].every(key => hasQuantity(cancellation, key, 0));
}

// Include growing cancellation rows, DB writes and both bounded polling windows.
// This is a preflight estimate, not a guarantee about future network latency.
export function replacementBudgetMs(cancelCount: number, orderCount: number, pages: number, pageSize: number, requestMs: number) {
  const finalPages = pages + Math.ceil(cancelCount / Math.max(1, pageSize));
  const requests = cancelCount * (finalPages + 1) + orderCount + finalPages + 8;
  return Math.ceil(requests * requestMs + (cancelCount + orderCount) * 250 + 45000);
}
// One path owns the cancel -> confirmation -> replacement boundary, so a warning,
// timeout, partial cancellation or disabled switch can never fall through to buy.
export async function cancelThenReplace<T>(targets: CancellationTarget[], deps: {
  guard: () => Promise<void>; live: () => Promise<BrokerRow[]>;
  cancel: (target: CancellationTarget) => Promise<string>; confirmed: (targets: CancellationTarget[]) => Promise<void>;
  replace: () => Promise<T>;
  preflight?: (rows: BrokerRow[]) => void | Promise<void>;
  polling?: PollOptions;
  onConfirmed?: (count: number) => void;
}) {
  const cancelNumbers = new Map<CancellationTarget, string>(), identities = new Set<string>();
  if (targets.length) {
    await deps.guard();
    const rows = await deps.live();
    for (const target of targets) cancellableRow(target, rows);
    await deps.preflight?.(rows);
  }
  for (const target of targets) {
    await deps.guard(); cancellableRow(target, await deps.live());
    const cancelNo = await deps.cancel(target), identity = `${target.history.oder_date}:${cancelNo}`;
    if (!/^[1-9]\d*$/.test(cancelNo) || cancelNo === target.order.broker_order_no || identities.has(identity)) throw new Error('취소 주문번호를 확인하지 못해 새 주문을 보내지 않았습니다.');
    cancelNumbers.set(target, cancelNo); identities.add(identity);
  }
  if (targets.length) {
    const { matched } = await pollRead(deps.live, rows => {
      const count = targets.filter(target => isCancellationConfirmed(target, rows, cancelNumbers.get(target)!)).length;
      deps.onConfirmed?.(count);
      return count === targets.length;
    }, deps.polling);
    if (!matched) throw new Error('취소 확정 수량을 확인하지 못해 새 주문을 보내지 않았습니다.');
  }
  await deps.confirmed(targets); await deps.guard();
  return deps.replace();
}
