import { hasAppAccess } from '@/lib/access/server';
import { sameRequestOrigin } from '@/lib/access/origin';
import { brokerDb, check } from '@/lib/broker/store';
import { pushConfigured } from '@/lib/broker/notifications';

export const dynamic = 'force-dynamic';
export async function GET() {
  if (!await hasAppAccess()) return Response.json({ error: '접속 비밀번호를 입력해 주세요.' }, { status: 401 });
  if (process.env.NODE_ENV === 'production' && !process.env.APP_PASSWORD) return Response.json({ error: '앱 접속 비밀번호 설정이 필요합니다.' }, { status: 503 });
  try {
    const r = await brokerDb().from('broker_notifications').select('id,strategy_id,event_key,title,body,tone,read_at,created_at').order('created_at', { ascending: false }).limit(30); check(r.error);
    return Response.json({ notifications: r.data, publicKey: pushConfigured() ? process.env.VAPID_PUBLIC_KEY : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!await hasAppAccess()) return Response.json({ error: '접속 비밀번호를 입력해 주세요.' }, { status: 401 });
  if (!sameRequestOrigin(request)) return Response.json({ error: '요청 출처를 확인해 주세요.' }, { status: 403 });
  try {
    if (process.env.NODE_ENV === 'production' && !process.env.APP_PASSWORD) throw new Error('알림 연결을 사용하려면 앱 접속 비밀번호를 설정해 주세요.');
    const body = await request.json(), db = brokerDb();
    if (body.action === 'read') {
      if (!Array.isArray(body.ids) || body.ids.length > 30 || body.ids.some((id: unknown) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) throw new Error('알림을 확인해 주세요.');
      check((await db.from('broker_notifications').update({ read_at: new Date().toISOString() }).in('id', body.ids)).error);
    } else if (body.action === 'subscribe') {
      if (!pushConfigured()) throw new Error('서버의 푸시 알림 설정이 필요합니다.');
      const subscription = body.subscription;
      const url = new URL(subscription?.endpoint ?? '');
      const approved = url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com'
        || url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com');
      if (url.protocol !== 'https:' || url.port && url.port !== '443' || !approved || url.username || url.password
        || typeof subscription?.keys?.p256dh !== 'string' || typeof subscription?.keys?.auth !== 'string'
        || !/^[A-Za-z0-9_\-=]{16,200}$/.test(subscription.keys.p256dh) || !/^[A-Za-z0-9_\-=]{16,200}$/.test(subscription.keys.auth)) throw new Error('푸시 구독 정보를 확인해 주세요.');
      check((await db.from('broker_push_subscriptions').upsert({ endpoint: url.href, subscription }, { onConflict: 'endpoint' })).error);
    } else throw new Error('지원하지 않는 요청입니다.');
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
}
