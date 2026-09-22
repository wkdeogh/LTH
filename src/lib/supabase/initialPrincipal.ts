import 'server-only';
import type { createSupabaseServerClient } from './server';
import { toNumber } from '@/lib/types';

export async function loadInitialPrincipal(
  supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>,
  strategyId: string,
  currentPrincipal: number,
) {
  const [round, snapshot] = await Promise.all([
    supabase.from('completed_rounds').select('started_principal').eq('strategy_id', strategyId)
      .order('round_number', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('strategy_snapshots').select('principal').eq('strategy_id', strategyId)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1).maybeSingle(),
  ]);
  if (round.error) throw round.error;
  if (snapshot.error) throw snapshot.error;
  return toNumber(round.data?.started_principal ?? snapshot.data?.principal ?? currentPrincipal);
}
