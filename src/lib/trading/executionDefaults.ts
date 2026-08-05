import type { OrderType, TEffect, TradeSide } from '@/lib/types';
import type { NormalPlan, OrderGuide } from '@/lib/trading/normalMode';
import type { ReversePlan } from '@/lib/trading/reverseMode';

export type ExecutionDefaults = {
  side: TradeSide;
  orderType: OrderType;
  quantity: number;
  tEffect: TEffect;
};

function fromOrder(order: OrderGuide | undefined, tEffect: TEffect): ExecutionDefaults | null {
  if (!order || order.quantity <= 0) return null;
  return {
    side: order.side,
    orderType: order.orderType,
    quantity: order.quantity,
    tEffect,
  };
}

export function inferExecutionDefaultsFromClose(
  plan: NormalPlan | ReversePlan,
  closePrice?: number,
): ExecutionDefaults | null {
  if (!closePrice || closePrice <= 0) return null;

  if (plan.kind === 'reverse') {
    if (plan.isFirstDay) {
      return fromOrder(plan.sellOrders[0], 'reverse_sell');
    }

    if (!plan.referencePrice) return null;
    if (closePrice > plan.referencePrice) {
      return fromOrder(plan.sellOrders[0], 'reverse_sell');
    }
    if (closePrice < plan.referencePrice) {
      return fromOrder(plan.buyOrders[0], 'reverse_buy');
    }
    return null;
  }

  if (plan.phase === 'reverse_required') return null;

  const finalSell = plan.sellOrders.find((order) => order.orderType === 'LIMIT');
  if (finalSell?.price && closePrice >= finalSell.price) {
    const quantity = plan.sellOrders.reduce((sum, order) => sum + order.quantity, 0);
    return quantity > 0 ? {
      side: 'sell',
      orderType: 'LIMIT',
      quantity,
      tEffect: 'full_sell',
    } : null;
  }

  const quarterSell = plan.sellOrders.find((order) => order.orderType === 'LOC');
  if (quarterSell?.price && closePrice >= quarterSell.price) {
    return fromOrder(quarterSell, 'quarter_sell');
  }

  const filledBuyOrders = plan.buyOrders.filter((order) => (
    order.price !== null && closePrice <= order.price && order.quantity > 0
  ));
  if (filledBuyOrders.length === 0) return null;

  const quantity = filledBuyOrders.reduce((sum, order) => sum + order.quantity, 0);
  const isHalfBuy = plan.phase === 'first_half' && filledBuyOrders.length < plan.buyOrders.length;
  return {
    side: 'buy',
    orderType: 'LOC',
    quantity,
    tEffect: isHalfBuy ? 'buy_half' : 'buy_full',
  };
}
