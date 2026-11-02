import type { NextRequest } from 'next/server';
import { syncMarketData } from '@/lib/marketData/candles';
import { reconcileBroker } from '@/lib/broker/service';
import { notify, deliverNotifications } from '@/lib/broker/notifications';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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

  let broker: unknown;
  try { broker = await reconcileBroker(); }
  catch (error) {
    const message = error instanceof Error ? error.message : '체결 조회 실패';
    failures.push({ symbol: 'SOXL', error: message });
    try { await notify(`morning:${new Date().toISOString().slice(0,10)}`, null, '체결 자동 반영 확인 필요', message, 'warning'); await deliverNotifications(); }
    catch (noticeError) { console.error('오류 알림 저장 실패', noticeError instanceof Error ? noticeError.message : 'unknown'); }
  }
  if (failures.length > 0) {
    console.error('자동 캔들 갱신 실패', failures);
    return Response.json({ success: false, failures }, { status: 502 });
  }

  return Response.json({
    success: true,
    broker,
    symbols,
    updatedAt: new Date().toISOString(),
  });
}
