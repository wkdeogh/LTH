import { hasAppAccess } from '@/lib/access/server';
import { sameRequestOrigin } from '@/lib/access/origin';
import { confirmOrders, getBrokerStatus, prepareOrders, verifyRecordedExecutions } from '@/lib/broker/service';
import { updateAutomation } from '@/lib/broker/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
export async function GET(request: Request) {
  if (!await hasAppAccess()) return Response.json({ error: '접속 비밀번호를 입력해 주세요.' }, { status: 401 });
  try {
    const id = new URL(request.url).searchParams.get('strategyId') ?? '';
    if (!uuid.test(id)) throw new Error('전략을 확인해 주세요.');
    return Response.json(await getBrokerStatus(id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}
export async function POST(request: Request) {
  if (!await hasAppAccess()) return Response.json({ error: '접속 비밀번호를 입력해 주세요.' }, { status: 401 });
  if (!sameRequestOrigin(request)) return Response.json({ error: '요청 출처를 확인해 주세요.' }, { status: 403 });
  try {
    if (process.env.NODE_ENV === 'production' && !process.env.APP_PASSWORD) throw new Error('주문 기능을 사용하려면 앱 접속 비밀번호(APP_PASSWORD)를 설정해 주세요.');
    const body = await request.json();
    if (body.action === 'confirm') {
      if (!uuid.test(body.runId ?? '') || typeof body.token !== 'string') throw new Error('주문 확인 정보가 없습니다.');
      const result = await confirmOrders(body.runId, body.token);
      return Response.json(result, { status: result.ok ? 200 : 502 });
    }
    if (!uuid.test(body.strategyId ?? '')) throw new Error('전략을 확인해 주세요.');
    if (body.action === 'verify-recorded') return Response.json(await verifyRecordedExecutions(body.strategyId));
    if (body.action === 'toggle' && typeof body.enabled === 'boolean') return Response.json(await updateAutomation(body.strategyId, body.enabled));
    if (body.action === 'preview') return Response.json(await prepareOrders(body.strategyId));
    throw new Error('지원하지 않는 요청입니다.');
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}
