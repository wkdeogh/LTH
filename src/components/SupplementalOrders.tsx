'use client';

import { useId, useState } from 'react';
import { usd } from '@/components/Format';

type SupplementalOrder = {
  label: string;
  price: number | null;
  quantity: number;
};

const PAGE_SIZE = 5;

export function SupplementalOrders({ orders }: { orders: SupplementalOrder[] }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const listId = useId();
  const visibleOrders = orders.slice(0, visibleCount);
  const remainingCount = Math.max(orders.length - visibleOrders.length, 0);
  const nextCount = Math.min(PAGE_SIZE, remainingCount);

  return (
    <article className="supplemental-orders">
      <div className="supplemental-orders-head">
        <div>
          <strong>하락 보완 1주 매수</strong>
          <p>종가가 내려갈수록 1회 매수금을 채우는 LOC 주문입니다.</p>
        </div>
        <span className="pill">LOC · {orders.length}건</span>
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
          <span>{visibleOrders.length}/{orders.length}개 표시</span>
          <button
            aria-controls={listId}
            className="supplemental-more-button"
            onClick={() => setVisibleCount((count) => Math.min(count + PAGE_SIZE, orders.length))}
            type="button"
          >
            {nextCount}개 더보기 <span aria-hidden="true">↓</span>
          </button>
        </div>
      )}
    </article>
  );
}
