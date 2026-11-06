import { redirect } from 'next/navigation';
import { STRATEGY_ID } from '@/lib/strategyConfig';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  redirect(`/strategies/${STRATEGY_ID}`);
}
