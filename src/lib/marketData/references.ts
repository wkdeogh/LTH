import 'server-only';
import { latestClosedMarketDate } from '@/lib/date';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { buildMarketReferenceHistory } from '@/lib/trading/marketReference';
import type { DailyPrice, MarketCandle, SymbolCode } from '@/lib/types';

export async function loadStrategyReferences(
  supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>, strategyId: string, symbol: SymbolCode,
) {
  const cutoff = latestClosedMarketDate();
  const [prices, candles] = await Promise.all([
    supabase.from('daily_prices').select('*').eq('strategy_id', strategyId).lte('trade_date', cutoff).order('trade_date', { ascending: false }).limit(7).returns<DailyPrice[]>(),
    supabase.from('market_candles').select('*').eq('symbol', symbol).lte('trade_date', cutoff).order('trade_date', { ascending: false }).limit(7).returns<MarketCandle[]>(),
  ]);
  if (prices.error) throw prices.error;
  if (candles.error) throw candles.error;
  return buildMarketReferenceHistory(prices.data ?? [], candles.data ?? []);
}
