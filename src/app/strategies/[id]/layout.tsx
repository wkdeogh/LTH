import { notFound } from 'next/navigation';
import { STRATEGY_ID } from '@/lib/strategyConfig';

export default async function StrategyLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ id: string }>;
}) {
  if ((await params).id !== STRATEGY_ID) notFound();
  return children;
}
