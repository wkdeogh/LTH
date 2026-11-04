import type { CashFlow } from '@/lib/types';
import { usd } from './Format';

export function CashFlowHistory({ cashFlows }: { cashFlows: CashFlow[] }) {
  if (!cashFlows.length) return null;
  return <details className="panel disclosure">
    <summary><strong>입출금 이력 · {cashFlows.length}건</strong><span aria-hidden="true">＋</span></summary>
    <div className="disclosure-body round-list">{cashFlows.map(flow => <div className="round-row correction-row" key={flow.id}>
      <div><strong>{flow.requested_date} · {flow.source === 'meritz_round' ? `라운드 종료 후 현금 ${Number(flow.amount) > 0 ? '증가' : '감소'}` : flow.source === 'meritz_withdrawal' ? '주문 전 현금 감소' : Number(flow.amount) > 0 ? '입금' : '인출'} {usd(Math.abs(Number(flow.amount)))}</strong>{flow.memo && <span>{flow.memo}</span>}</div>
      <div><span>{flow.timing === 'immediate' ? '즉시 반영' : '다음 라운드에 반영'} · {flow.status === 'pending' ? '대기 중' : flow.status === 'cancelled' ? '예약 취소' : `${flow.applied_date} 반영 완료`}</span></div>
    </div>)}</div>
  </details>;
}
