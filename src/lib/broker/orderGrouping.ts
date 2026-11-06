import type { ApiOrder } from './policy';

export const SUPPLEMENTAL_GROUP_PERCENT = 3;

// Supplemental limits only: compare every member with the group's highest
// price, never chain adjacent 3% gaps. The lowest limit avoids buying a leg
// above its original trigger. Preserve sources for cash fitting and fill/T sync.
export function groupSupplementalOrders(orders: ApiOrder[]): ApiOrder[] {
  const supplemental = orders.filter(order => order.side === 'buy' && order.sources.length > 0
    && order.sources.every(source => source.isSupplemental));
  const result = orders.filter(order => !supplemental.includes(order));
  supplemental.sort((a,b) => a.orderType.localeCompare(b.orderType) || (b.price ?? 0) - (a.price ?? 0));
  let group: ApiOrder[] = [];
  const cents = (order: ApiOrder) => {
    const value = Math.round((order.price ?? 0) * 100);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('보완매수 주문가격을 확인해 주세요.');
    return value;
  };
  const flush = () => {
    if (!group.length) return;
    const price = group.at(-1)!.price!;
    result.push({ ...group[0], key: `buy:${group[0].orderType}:${Math.round(price * 100)}`, price,
      quantity: group.reduce((sum, order) => sum + order.quantity, 0), sources: group.flatMap(order => order.sources) });
    group = [];
  };
  for (const order of supplemental) {
    const price = cents(order);
    if (group.length && (order.orderType !== group[0].orderType
      || BigInt(price) * BigInt(100) < BigInt(cents(group[0])) * BigInt(100 - SUPPLEMENTAL_GROUP_PERCENT))) flush();
    group.push(order);
  }
  flush();
  return result;
}
