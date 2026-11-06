import type { StrategyState } from '@/lib/types';
import type { BrokerRow } from './meritz';
import { validateFunding, type ApiOrder, type ProcessedGuide } from './policy';
import { pollRead, type PollOptions } from './polling';

function moneyUnits(value: number) {
  const units = Math.floor(value * 10000 + 1e-7);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(units)) throw new Error('주문가능 현금을 확인하지 못했습니다.');
  return units;
}
export function orderCash(rows: BrokerRow[]) {
  const usd = rows.filter(row => row.crcd === 'USD');
  const value = usd[0]?.oder_crnc_oder_able_camt;
  if (usd.length !== 1 || value === null || value === undefined || String(value).trim() === '') throw new Error('USD 주문가능 현금을 확인하지 못했습니다.');
  moneyUnits(Number(value));
  return Number(value);
}
export function buyReservation(orders: ApiOrder[]) {
  return orders.filter(order => order.side === 'buy').reduce((sum, order) => sum + (order.price ?? 0) * order.quantity, 0);
}

// Never resize a guide leg: its original quantity and T meaning stay together.
// Reserve all affordable base legs before considering any supplemental leg,
// including when both were merged into the same capped API price.
export function fitOrderFunding(processed: ProcessedGuide, state: StrategyState, brokerCash: number, sellable: number): ProcessedGuide {
  let remaining = Math.min(moneyUnits(state.cashBalance), moneyUnits(brokerCash));
  const skipped = [...processed.skipped];
  const legs = processed.orders.filter(order => order.side === 'buy').flatMap(order => {
    if (order.price === null || order.price <= 0 || !order.sources.length
      || order.sources.reduce((sum, source) => sum + source.quantity, 0) !== order.quantity) throw new Error('매수 가이드의 가격·수량 연결을 확인해 주세요.');
    return order.sources.map(source => {
      const cost = Math.round(order.price! * 10000) * source.quantity;
      if (!Number.isSafeInteger(source.quantity) || source.quantity <= 0 || !Number.isSafeInteger(cost) || cost <= 0) throw new Error('매수 주문금액을 확인해 주세요.');
      return { order, source, cost };
    });
  }).sort((a,b) => Number(!!a.source.isSupplemental) - Number(!!b.source.isSupplemental)
    || b.order.price! - a.order.price!);
  const baseCost = legs.filter(leg => !leg.source.isSupplemental).reduce((sum, leg) => sum + leg.cost, 0);
  if (!Number.isSafeInteger(baseCost)) throw new Error('기본매수 주문금액을 확인해 주세요.');
  // Keep a two-leg half/full-unit guide intact; funding just its second leg
  // would otherwise label a half-sized purchase as a completed full unit.
  const baseAffordable = baseCost <= remaining;
  const accepted = new Set<typeof legs[number]>();
  for (const leg of legs) {
    if (!baseAffordable || leg.cost > remaining) {
      skipped.push({ label: leg.source.label, reason: `주문가능 현금 부족 · ${leg.source.isSupplemental ? '보완매수' : '기본매수'} 제외` });
    } else { remaining -= leg.cost; accepted.add(leg); }
  }
  const orders = processed.orders.flatMap(order => {
    if (order.side === 'sell') return [order];
    const sources = legs.filter(leg => leg.order === order && accepted.has(leg)).map(leg => leg.source);
    return sources.length ? [{ ...order, sources, quantity: sources.reduce((sum, source) => sum + source.quantity, 0) }] : [];
  });
  validateFunding(orders, state, brokerCash, sellable);
  return { ...processed, orders, skipped };
}

// After confirmed cancellation, read-only polls give released reservations a
// chance to appear. If cash remains lower, fit the batch instead of aborting it.
export async function waitForOrderFunding(requiredCash: number, requiredSellable: number,
  read: () => Promise<{ cash: number; sellable: number }>, options: PollOptions = {}) {
  const { value } = await pollRead(async () => {
    const result = await read(); moneyUnits(result.cash);
    if (!Number.isSafeInteger(result.sellable) || result.sellable < 0) throw new Error('매도 가능 수량을 확인하지 못했습니다.');
    return result;
  }, result => moneyUnits(result.cash) >= moneyUnits(requiredCash) && result.sellable >= requiredSellable,
  { timeoutMs: 15000, ...options });
  return value;
}
export function fundingSummary(processed: ProcessedGuide) {
  const count = processed.skipped.filter(item => item.reason.startsWith('주문가능 현금 부족')).length;
  return count ? ` 주문가능 현금 부족으로 매수 ${count}건을 제외했습니다.` : '';
}
