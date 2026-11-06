'use client';

import { useId, useMemo, useState } from 'react';
import { usd } from '@/components/Format';
import type { OrderGuide } from '@/lib/trading/normalMode';
import { groupSupplementalOrders, SUPPLEMENTAL_GROUP_PERCENT } from '@/lib/broker/orderGrouping';

const PAGE_SIZE = 5;

export function SupplementalOrders({ orders }: { orders: OrderGuide[] }) {
  const [grouped, setGrouped] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const listId = useId();
  const groupedOrders = useMemo(() => groupSupplementalOrders(orders.map((order,index) => ({
    key: `supplemental-${index}`, side: order.side, orderType: order.orderType,
    price: order.price, quantity: order.quantity, sources: [order],
  }))).map(order => ({ label: order.key, price: order.price, quantity: order.quantity })), [orders]);
  const displayedOrders = grouped ? groupedOrders : orders;
  const visibleOrders = displayedOrders.slice(0, visibleCount);
  const remainingCount = Math.max(displayedOrders.length - visibleOrders.length, 0);
  const nextCount = Math.min(PAGE_SIZE, remainingCount);

  return (
    <article className="supplemental-orders">
      <div className="supplemental-orders-head">
        <div>
          <strong>하락 보완 매수</strong>
        </div>
        <span className="pill">LOC · {displayedOrders.length}건</span>
      </div>
      <div className="supplemental-view-switch" role="group" aria-label="하락 보완매수 보기">
        {[false,true].map(value => <button key={String(value)} type="button" aria-pressed={grouped === value}
          aria-controls={listId} onClick={() => { setGrouped(value); setVisibleCount(PAGE_SIZE); }}>
          {value ? `묶음 (${SUPPLEMENTAL_GROUP_PERCENT}%)` : '기존'}
        </button>)}
      </div>
      <div className="supplemental-order-list" id={listId} aria-label="하락 보완 LOC 주문 목록">
        {visibleOrders.map((order, index) => (
          <div className="supplemental-order-row" key={`${order.label}-${index}`}>
            <span>{index + 1}</span>
            <strong>{order.price ? usd(order.price) : '-'}</strong>
            <b>{order.quantity}주</b>
          </div>
        ))}
      </div>
      {remainingCount > 0 && (
        <div className="supplemental-orders-footer">
          <span>{visibleOrders.length}/{displayedOrders.length}개 표시</span>
          <button
            aria-controls={listId}
            className="supplemental-more-button"
            onClick={() => setVisibleCount((count) => Math.min(count + PAGE_SIZE, displayedOrders.length))}
            type="button"
          >
            {nextCount}개 더보기 <span aria-hidden="true">↓</span>
          </button>
        </div>
      )}
    </article>
  );
}
