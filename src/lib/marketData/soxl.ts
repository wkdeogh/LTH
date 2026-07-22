import 'server-only';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { roundPrice } from '@/lib/trading/rounding';

const SOXL_CHART_ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart/SOXL';

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
    }>;
    error?: { description?: string } | null;
  };
};

function unixSeconds(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

function newYorkTradeDate(timestamp: number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp * 1000));
}

export async function syncSoxlMarketData() {
  const supabase = createSupabaseServerClient();
  if (!supabase) return;

  const period2 = new Date();
  period2.setUTCDate(period2.getUTCDate() + 1);
  const { data: latestCandle, error: latestCandleError } = await supabase
    .from('market_candles')
    .select('trade_date')
    .eq('symbol', 'SOXL')
    .order('trade_date', { ascending: false })
    .limit(1)
    .maybeSingle<{ trade_date: string }>();
  if (latestCandleError) throw latestCandleError;

  const period1 = latestCandle
    ? new Date(`${latestCandle.trade_date}T00:00:00Z`)
    : new Date(period2);
  if (latestCandle) {
    period1.setUTCDate(period1.getUTCDate() - 7);
  } else {
    period1.setUTCFullYear(period1.getUTCFullYear() - 3);
    period1.setUTCDate(period1.getUTCDate() - 10);
  }

  const url = new URL(SOXL_CHART_ENDPOINT);
  url.searchParams.set('period1', String(unixSeconds(period1)));
  url.searchParams.set('period2', String(unixSeconds(period2)));
  url.searchParams.set('interval', '1d');
  url.searchParams.set('events', 'history');
  url.searchParams.set('includeAdjustedClose', 'true');

  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; LTH/1.0; +https://localhost)',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`SOXL OHLC API 오류: ${response.status}`);

  const payload = await response.json() as YahooChartResponse;
  if (payload.chart?.error) throw new Error(payload.chart.error.description ?? 'SOXL OHLC API 응답 오류');

  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  const adjustedCloses = result?.indicators?.adjclose?.[0]?.adjclose ?? [];
  if (!quote || timestamps.length === 0) throw new Error('SOXL OHLC 데이터가 비어 있습니다.');

  const fetchedAt = new Date().toISOString();
  const rows = timestamps.flatMap((timestamp, index) => {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    if (open == null || high == null || low == null || close == null) return [];

    return [{
      symbol: 'SOXL' as const,
      trade_date: newYorkTradeDate(timestamp),
      open_price: roundPrice(open),
      high_price: roundPrice(high),
      low_price: roundPrice(low),
      close_price: roundPrice(close),
      adjusted_close: adjustedCloses[index] == null ? null : roundPrice(adjustedCloses[index]!),
      volume: Math.max(0, Math.trunc(quote.volume?.[index] ?? 0)),
      fetched_at: fetchedAt,
    }];
  });

  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await supabase
      .from('market_candles')
      .upsert(rows.slice(index, index + 500), { onConflict: 'symbol,trade_date' });
    if (error) throw error;
  }
}
