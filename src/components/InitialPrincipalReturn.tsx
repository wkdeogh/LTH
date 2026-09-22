import { compact, usd } from './Format';
import { calculateAccountPerformance } from '@/lib/trading';

export function InitialPrincipalReturn({ principal, cash, quantity, price }: {
  principal: number; cash: number; quantity: number; price?: number;
}) {
  const { profitAmount, profitRate } = calculateAccountPerformance(principal, cash, quantity, price);
  const sign = profitAmount !== null && profitAmount < 0 ? 'profit-negative' : 'profit-positive';
  return (
    <div className="initial-principal-return">
      <div><span>최초 원금 대비</span><small>원금 {usd(principal)}</small></div>
      <div className={sign}>
        <strong>{profitAmount === null ? '—' : `${profitAmount >= 0 ? '+' : '-'}${usd(Math.abs(profitAmount))}`}</strong>
        <span>{profitRate === null ? '—' : `${profitRate >= 0 ? '+' : ''}${compact(profitRate, 2)}%`}</span>
      </div>
    </div>
  );
}
