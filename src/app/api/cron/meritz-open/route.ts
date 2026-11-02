import { runOpeningJob } from '@/lib/broker/service';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try { return Response.json(await runOpeningJob(new URL(request.url).searchParams.get('watchdog') === '1')); }
  catch (error) { console.error('메리츠 22시 주문 작업 실패', (error as Error).message); return Response.json({ error: (error as Error).message }, { status: 502 }); }
}
