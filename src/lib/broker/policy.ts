import type { OrderGuide, NormalPlan } from '@/lib/trading/normalMode';
import type { ReversePlan } from '@/lib/trading/reverseMode';
import type { Strategy, StrategyState, SymbolCode } from '@/lib/types';
import { toStrategyState } from '@/lib/types';
import { calculateNormalPlan } from '@/lib/trading/normalMode';
import { calculateReversePlan } from '@/lib/trading/reverseMode';
import { groupSupplementalOrders } from './orderGrouping';

export type GuidePlan = NormalPlan | ReversePlan;
export type ApiOrder = {
  key: string; side: 'buy' | 'sell'; orderType: 'LOC' | 'LIMIT' | 'MOC';
  price: number | null; quantity: number; sources: OrderGuide[];
};
export type ProcessedGuide = { orders: ApiOrder[]; skipped: { label: string; reason: string }[]; currentPrice: number };

export function strategyGuide(strategy: Strategy, referencePrice?: number): GuidePlan {
  const state = toStrategyState(strategy);
  return state.mode === 'normal' ? calculateNormalPlan(state, referencePrice)
    : calculateReversePlan(state, [], referencePrice);
}

export function processGuide(plan: GuidePlan, currentPrice: number): ProcessedGuide {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) throw new Error('유효한 현재가가 없습니다.');
  if (plan.kind === 'normal' && plan.phase === 'reverse_required') throw new Error('리버스모드 전환 후 주문을 다시 확인해 주세요.');
  // Work in cents: buys round down at the cap, supplemental cutoff rounds up.
  const cap = Math.floor((currentPrice * 120 + 1e-8)) / 100;
  const lower = Math.ceil((currentPrice * 90 - 1e-8)) / 100;
  const candidates: ApiOrder[] = [];
  const skipped: ProcessedGuide['skipped'] = [];
  for (const original of [...plan.buyOrders, ...plan.sellOrders]) {
    if (!Number.isSafeInteger(original.quantity) || original.quantity < 0) throw new Error('주문 수량을 확인해 주세요.');
    if (!original.quantity) continue;
    if (original.orderType !== 'MOC' && (!original.price || !Number.isFinite(original.price) || original.price <= 0)) {
      throw new Error(`${original.label}: 주문가격이 없습니다.`);
    }
    if (original.side === 'sell' && original.price !== null && original.price + 1e-8 >= currentPrice * 1.2) {
      skipped.push({ label: original.label, reason: '현재가 +20% 이상 매도 제외' }); continue;
    }
    if (original.side === 'buy' && original.isSupplemental && original.price! < lower) {
      skipped.push({ label: original.label, reason: '현재가 -10% 미만 보완매수 제외' }); continue;
    }
    const price = original.side === 'buy' && original.price !== null ? Math.min(original.price, cap) : original.price;
    const key = `${original.side}:${original.orderType}:${price === null ? 'market' : Math.round(price * 100)}`;
    candidates.push({ key, side: original.side, orderType: original.orderType, price,
      quantity: original.quantity, sources: [original] });
  }
  const result = new Map<string, ApiOrder>();
  for (const order of groupSupplementalOrders(candidates)) {
    const existing = result.get(order.key);
    if (existing) { existing.quantity += order.quantity; existing.sources.push(...order.sources); }
    else result.set(order.key, { ...order, sources: [...order.sources] });
  }
  const orders = [...result.values()];
  // Selling LIMIT first preserves the existing intraday sell / LOC-buy workflow.
  orders.sort((a, b) => Number(b.side === 'sell') - Number(a.side === 'sell')
    || Number(b.orderType === 'LIMIT') - Number(a.orderType === 'LIMIT') || (b.price ?? 0) - (a.price ?? 0));
  return { orders, skipped, currentPrice };
}

export function validateFunding(orders: ApiOrder[], state: StrategyState, brokerCash: number, sellable: number) {
  if (![brokerCash, sellable].every(v => Number.isFinite(v) && v >= 0)) throw new Error('증권사 주문가능금액·수량을 확인하지 못했습니다.');
  const sells = orders.filter(o => o.side === 'sell').reduce((n, o) => n + o.quantity, 0);
  if (sells > Math.min(state.positionQty, sellable)) throw new Error('매도 주문 수량이 매도 가능 수량을 초과합니다.');
  const buys = orders.filter(o => o.side === 'buy');
  const reserved = buys.reduce((n, o) => n + (o.price ?? 0) * o.quantity, 0);
  if (reserved > Math.min(state.cashBalance, brokerCash) + 1e-7) {
    throw new Error('기본·보완매수 주문의 예약 금액이 주문 가능 현금을 초과합니다.');
  }
}

export function orderBody(symbol: SymbolCode, order: ApiOrder) {
  return { ovrs_stck_symb_iscd: symbol, ovrs_exch_vndr_idno: symbol === 'SOXL' ? '0066' : '0537',
    oder_cls_code: order.orderType === 'LOC' ? '32' : order.orderType === 'MOC' ? '34' : '01',
    oder_cond_cls_code: order.orderType === 'LIMIT' ? '0' : '7', odqt: order.quantity,
    ovrs_stck_oder_prc: order.price === null ? '0' : order.price.toFixed(4), warn_cnfr_yn: 'N' };
}

export function matchGuideOrder(plan: GuidePlan, currentPrice: number, order: Pick<ApiOrder,'side'|'orderType'|'price'|'quantity'>) {
  const original = [...plan.buyOrders, ...plan.sellOrders].map(o => ({ ...o, sources: [o] }));
  const candidates = [...original, ...processGuide(plan, currentPrice).orders].filter(o => o.side === order.side
    && o.orderType === order.orderType && o.quantity === order.quantity
    && (order.orderType === 'MOC' || Math.abs((o.price ?? 0) - (order.price ?? 0)) < 0.0001));
  if (!candidates.length) return null;
  const meanings = new Set(candidates.map(o => o.sources.some(s => s.completesBuyUnit)));
  if (meanings.size > 1 && order.side === 'buy') throw new Error('수동 주문의 반회·1회 매수 구분을 확인해 주세요.');
  return candidates[0];
}

export function judgeOrder(body: Record<string, unknown>) {
  const data = body.data as Record<string, unknown> | undefined;
  const warning = data?.warn_cls_code;
  if (warning != null && String(warning) !== '0') return 'rejected' as const;
  if (body.rsp_cd === '0001' && String(warning) === '0' && /^[1-9]\d*$/.test(String(data?.oder_no ?? ''))) return 'accepted' as const;
  if (typeof body.rsp_cd === 'string' && body.rsp_cd && body.rsp_cd !== '0001') return 'rejected' as const;
  return 'unknown' as const;
}

export function validateOrderBounds(orders: ApiOrder[], price: number) {
  if (!Number.isFinite(price) || price <= 0 || orders.some(o => o.price !== null && (o.side === 'buy' && o.price > price * 1.2 + 1e-7
    || o.side === 'sell' && o.price >= price * 1.2 - 1e-7
    || o.side === 'buy' && o.sources.every(s => s.isSupplemental) && o.price < price * 0.9 - 1e-7))) {
    throw new Error('현재가가 달라져 주문 범위를 벗어났습니다. 미리보기를 다시 확인해 주세요.');
  }
}
