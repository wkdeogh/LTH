import { redirect } from 'next/navigation';
import { STRATEGY_ID } from '@/lib/strategyConfig';

export default function RoundsPage() {
  redirect('/strategies/' + STRATEGY_ID + '/rounds?view=rounds');
}
