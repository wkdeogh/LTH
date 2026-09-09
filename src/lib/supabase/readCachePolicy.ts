export const READ_CACHE_TAG = 'lth-read-v1';
export const MARKET_CACHE_TAG = 'lth-market-v1';

const cachedTables = new Set([
  'market_candles', 'daily_prices', 'executions', 'completed_rounds',
  'strategy_snapshots', 'strategy_adjustments',
]);

export function readCachePolicy(url: string, method = 'GET') {
  const parsed = new URL(url);
  const path = parsed.pathname;
  const table = path.startsWith('/rest/v1/') ? path.slice('/rest/v1/'.length) : '';
  const mainIdOnly = table === 'strategies' && parsed.searchParams.get('select') === 'id'
    && parsed.searchParams.get('is_main') === 'eq.true' && parsed.searchParams.get('is_archived') === 'eq.false';
  if (method.toUpperCase() !== 'GET' || (!cachedTables.has(table) && !mainIdOnly)) {
    return { cache: 'no-store' as const };
  }
  return {
    cache: 'force-cache' as const,
    next: { revalidate: 60, tags: table === 'market_candles' ? [READ_CACHE_TAG, MARKET_CACHE_TAG] : [READ_CACHE_TAG] },
  };
}
