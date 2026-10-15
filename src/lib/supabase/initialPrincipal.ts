import 'server-only';
import type { createSupabaseServerClient } from './server';
import { toNumber } from '@/lib/types';

export async function loadInitialPrincipal(
  supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>,
  strategyId: string,
  currentPrincipal: number,
) {
  const [round, snapshot, firstFlow, flows] = await Promise.all([
    supabase.from('completed_rounds').select('started_principal,created_at').eq('strategy_id', strategyId)
      .order('round_number', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('strategy_snapshots').select('principal,created_at').eq('strategy_id', strategyId)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('strategy_adjustments').select('before_state,created_at').eq('strategy_id', strategyId).eq('kind', 'cash_flow')
      .order('created_at', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('strategy_cash_flows').select('amount').eq('strategy_id', strategyId).eq('status', 'applied'),
  ]);
  if (round.error) throw round.error;
  if (snapshot.error) throw snapshot.error;
  if (firstFlow.error) throw firstFlow.error;
  if (flows.error) throw flows.error;
  const candidates = [
    ...(round.data ? [{ principal: toNumber(round.data.started_principal), created: round.data.created_at }] : []),
    ...(snapshot.data?.principal != null ? [{ principal: toNumber(snapshot.data.principal), created: snapshot.data.created_at }] : []),
    ...(firstFlow.data ? [{ principal: toNumber(firstFlow.data.before_state.principal), created: firstFlow.data.created_at }] : []),
  ].sort((a, b) => a.created.localeCompare(b.created));
  return (candidates[0]?.principal ?? currentPrincipal) + (flows.data ?? []).reduce((total, flow) => total + toNumber(flow.amount), 0);
}
