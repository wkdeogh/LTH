import type { NextRequest } from 'next/server';
import { syncMarketData } from '@/lib/marketData/candles';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const symbols = ['SOXL', 'TQQQ'] as const;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ success: false, error: 'CRON_SECRET is not configured.' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const results = await Promise.allSettled(symbols.map((symbol) => syncMarketData(symbol)));
  const failures = results.flatMap((result, index) => (
    result.status === 'rejected'
      ? [{
        symbol: symbols[index],
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      }]
      : []
  ));

  if (failures.length > 0) {
    console.error('자동 캔들 갱신 실패', failures);
    return Response.json({ success: false, failures }, { status: 502 });
  }

  return Response.json({
    success: true,
    symbols,
    updatedAt: new Date().toISOString(),
  });
}
