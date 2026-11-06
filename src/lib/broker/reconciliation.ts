import type { Strategy, TEffect } from '@/lib/types';
import { toStrategyState } from '@/lib/types';
import { applyTEffect } from '@/lib/trading/tValue';
import { roundMoney } from '@/lib/trading/rounding';
import { calculateRoundPerformance } from '@/lib/trading/marketReference';
import { shouldAutoReturnToNormalMode } from '@/lib/trading/reverseMode';
import { shouldEnterReverseMode } from '@/lib/trading/mode';
import type { BrokerRow } from './meritz';
import type { GuidePlan } from './policy';
import { closeMinute, isTradingDay, nyTime } from './calendar';

// Meritz order/fill timestamps are Korea-local strings; keep the separate
// broker order date unchanged for detail lookups and deduplication.
function brokerOrderTime(row: BrokerRow) {
  const text = String(row.oder_exec_ymdh ?? '');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) throw new Error('주문 접수 시각을 확인하지 못했습니다.');
  const date = new Date(`${text.replace(' ', 'T')}+09:00`);
  if (!Number.isFinite(date.getTime())
    || new Date(date.getTime() + 9 * 3600000).toISOString().slice(0,19).replace('T',' ') !== text) throw new Error('주문 접수 시각이 잘못되었습니다.');
  return date;
}
export function brokerSession(row: BrokerRow) { return nyTime(brokerOrderTime(row)).date; }

export function blocksSessionOrder(row: BrokerRow, symbol: string, session: string) {
  if (String(row.ovrs_stck_symb_iscd ?? row.iscd ?? '').split('.')[0] !== symbol) return false;
  const accepted = nyTime(brokerOrderTime(row));
  // Only pre-close submissions belong unambiguously to an earlier session.
  // An after-close submission may be queued for the next session, even while
  // its New York calendar date still reads yesterday.
  if (accepted.date < session && isTradingDay(accepted.date) && accepted.minute < closeMinute(accepted.date)) return false;
  return String(row.oder_rctf_cncl_cls_code) === '0'
    && !['1','2','4'].includes(String(row.ovrs_stck_oder_stat_cls_code))
    && Number(row.oder_dqty ?? row.odqt) > Number(row.cncl_cnfr_qty ?? 0);
}

export type BrokerFill = { orderDate: string; orderNo: string; fillNo: string; symbol: string;
  side: 'buy' | 'sell'; orderType: 'LOC' | 'MOC' | 'LIMIT'; quantity: number; amount: number;
  price: number; limitPrice: number; time: string; orderQuantity: number };

export function recordedFillsMatch(fills: Pick<BrokerFill, 'side' | 'quantity' | 'amount'>[], local: { side: string; quantity: number; total_amount: number | string }[]) {
  const totals = (items: { side: string; quantity: number; amount: number }[]) => ['buy','sell'].map(side => ({ side,
    quantity: items.filter(i => i.side === side).reduce((n,i) => n + i.quantity,0),
    amount: Math.round(items.filter(i => i.side === side).reduce((n,i) => n + i.amount,0) * 10000) / 10000 }));
  return fills.length > 0 && local.length > 0 && JSON.stringify(totals(fills)) === JSON.stringify(totals(local.map(e => ({ side:e.side,quantity:e.quantity,amount:Number(e.total_amount) }))));
}

export function normalizeDetails(rows: BrokerRow[], history: BrokerRow, options: { recordedManually?: boolean } = {}): BrokerFill[] {
  const expected = Number(history.cntg_dqty ?? history.cntg_qty ?? 0);
  const orderQuantity = Number(history.oder_dqty ?? history.odqt);
  if (!expected) return [];
  if (!Number.isSafeInteger(expected) || !Number.isSafeInteger(orderQuantity) || expected < 0 || expected > orderQuantity
    || !options.recordedManually && expected !== orderQuantity) {
    throw new Error('부분체결 또는 소수점 체결은 T값 확인 후 반영해야 합니다.');
  }
  const unique = new Map<string, BrokerFill>();
  for (const r of rows) {
    const quantity = Number(r.cntg_dqty ?? 0);
    if (!quantity) continue;
    const fillNo = String(r.cntg_no ?? '0');
    const amount = Number(r.cntg_camt);
    const side = String(r.seln_byov_clcd) === '2' ? 'buy' : String(r.seln_byov_clcd) === '1' ? 'sell' : null;
    const orderType = ({ '2': 'LIMIT', '5': 'LOC', '7': 'MOC' } as Record<string, 'LIMIT' | 'LOC' | 'MOC'>)[String(r.aspr_type_code)];
    if (!/^[1-9]\d*$/.test(fillNo) || !side || !orderType || !Number.isSafeInteger(quantity)
      || quantity < 1 || !Number.isFinite(amount) || amount <= 0 || !r.cntg_ymdh) throw new Error('체결 번호·수량·금액·시간·주문유형을 확인하지 못했습니다.');
    const fill: BrokerFill = { orderDate: String(r.oder_date), orderNo: String(r.oder_no), fillNo,
      symbol: String(r.iscd).split('.')[0], side, orderType, quantity, amount,
      price: amount / quantity, limitPrice: Number(r.ovrs_stck_oder_prc), time: String(r.cntg_ymdh), orderQuantity };
    const previous = unique.get(fillNo);
    if (previous && JSON.stringify(previous) !== JSON.stringify(fill)) throw new Error('같은 체결번호에 서로 다른 내역이 있습니다.');
    if (fill.orderNo !== String(history.oder_no) || fill.orderDate !== String(history.oder_date)) throw new Error('주문과 상세 체결의 연결이 다릅니다.');
    unique.set(fillNo, fill);
  }
  const fills = [...unique.values()];
  const quantity = fills.reduce((n, f) => n + f.quantity, 0);
  const amount = fills.reduce((n, f) => n + f.amount, 0);
  const expectedAmount = Number(history.cntg_camt);
  if (quantity !== expected || !Number.isFinite(expectedAmount) || Math.abs(amount - expectedAmount) > 0.01) {
    throw new Error('주문 누적 체결과 상세 체결 합계가 일치하지 않습니다.');
  }
  return fills;
}

export function buildBrokerCommit(strategy: Strategy, plan: GuidePlan, fills: BrokerFill[], session: string, close: number, options: { buyCompletesUnit?: boolean } = {}) {
  if (!fills.length || !Number.isFinite(close) || close <= 0) throw new Error('실제 체결과 해당 거래일 종가가 필요합니다.');
  if (fills.some(f => f.symbol !== strategy.symbol)) throw new Error('전략과 체결 종목이 다릅니다.');
  const state = toStrategyState(strategy);
  const groups = new Map<string, { side: 'buy' | 'sell'; order_type: 'LOC' | 'LIMIT' | 'MOC'; quantity: number; total_amount: number }>();
  for (const fill of [...fills].sort((a, b) => a.time.localeCompare(b.time) || a.fillNo.localeCompare(b.fillNo))) {
    const key = `${fill.side}:${fill.orderType}`;
    const prev = groups.get(key);
    if (prev) { prev.quantity += fill.quantity; prev.total_amount = roundMoney(prev.total_amount + fill.amount); }
    else groups.set(key, { side: fill.side, order_type: fill.orderType, quantity: fill.quantity, total_amount: fill.amount });
  }
  const legs = [...groups.values()].sort((a, b) => Number(b.side === 'sell') - Number(a.side === 'sell')
    || Number(b.order_type === 'LIMIT') - Number(a.order_type === 'LIMIT'));
  if (legs.length > 2) throw new Error('복합 체결은 수동으로 순서와 T값을 확인해 주세요.');
  const buy = legs.find(l => l.side === 'buy');
  const sells = legs.filter(l => l.side === 'sell');
  const sellQty = sells.reduce((n, l) => n + l.quantity, 0);
  if (sellQty > state.positionQty) throw new Error('체결 매도수량이 LTH 보유수량보다 많습니다.');
  if (buy && buy.order_type !== 'LOC') throw new Error('LOC 이외의 매수 체결은 T값 확인이 필요합니다.');
  let effect: TEffect;
  if (plan.kind === 'reverse') {
    if (buy && sells.length) throw new Error('리버스 매수·매도 동시 체결은 확인이 필요합니다.');
    effect = buy ? 'reverse_buy' : 'reverse_sell';
  } else {
    const fullBoundary = plan.buyOrders.find(o => !o.isSupplemental && o.completesBuyUnit)?.price;
    const fullBuy = plan.phase !== 'first_half' || (options.buyCompletesUnit ?? (fullBoundary !== null && fullBoundary !== undefined && buy && buy.total_amount / buy.quantity <= fullBoundary + 1e-8));
    if (buy && sells.length) {
      if (sells.some(l => l.order_type !== 'LIMIT')) throw new Error('동시 체결의 매도 유형을 확인해 주세요.');
      effect = fullBuy ? 'limit_sell_then_full_buy' : 'limit_sell_then_half_buy';
    } else if (buy) effect = fullBuy ? 'buy_full' : 'buy_half';
    else {
      if (sellQty !== state.positionQty && sells.some(l => l.order_type === 'LIMIT')) throw new Error('지정가 단독 일부 매도의 T값 확인이 필요합니다.');
      effect = sellQty === state.positionQty ? 'full_sell' : 'quarter_sell';
    }
  }
  let cash = state.cashBalance, qty = state.positionQty, avg = state.avgPrice;
  const snapshots: Record<string, unknown>[] = [];
  const executions = legs.map((leg, index) => {
    const before = { cash_balance: cash, position_qty: qty, avg_price: avg, t_value: state.tValue };
    if (leg.side === 'sell') { cash = roundMoney(cash + leg.total_amount); qty -= leg.quantity; if (!qty) avg = 0; }
    else { avg = roundMoney((avg * qty + leg.total_amount) / (qty + leg.quantity)); qty += leg.quantity; cash = roundMoney(cash - leg.total_amount); }
    if (cash < 0 || qty < 0) throw new Error('실제 체결과 LTH 현금·수량이 일치하지 않습니다.');
    snapshots.push({ ...before, after_cash_balance: cash, after_position_qty: qty });
    return { ...leg, id: crypto.randomUUID(), executed_at: session,
      avg_execution_price: roundMoney(leg.total_amount / leg.quantity),
      t_effect: index === legs.length - 1 ? effect : 'none', memo: '메리츠 실제 체결 자동 반영' };
  });
  const completed = !buy && qty === 0 && state.positionQty > 0;
  const t = applyTEffect(state.tValue, effect!, state.splitCount);
  const returned = !completed && state.mode === 'reverse' && shouldAutoReturnToNormalMode({ ...state, avgPrice: avg }, close);
  const mode = completed || returned ? 'normal' : state.mode === 'normal' && shouldEnterReverseMode({ ...state, tValue: t }) ? 'reverse' : state.mode;
  const final = { principal: completed && strategy.compounding_type === 'compound' ? cash : state.principal,
    cash_balance: cash, position_qty: qty, avg_price: completed ? 0 : avg, t_value: completed ? 0 : t,
    mode, reverse_first_sell_done: !completed && mode === 'reverse' && (effect! === 'reverse_sell' || state.reverseFirstSellDone),
    reverse_started_at: mode === 'reverse' ? state.reverseStartedAt ?? session : null,
    started_at: completed ? session : strategy.started_at };
  const performance = completed ? calculateRoundPerformance(state.principal, cash) : null;
  return { executions, snapshots, final, round: performance ? { profit_amount: performance.profitAmount,
    profit_rate: performance.profitRate, ending_t_value: t } : null };
}
