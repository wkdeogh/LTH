import 'server-only';
import webpush from 'web-push';
import { brokerDb, check } from './store';

export function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}
export async function notify(eventKey: string, strategyId: string | null, title: string, body: string, tone: 'success' | 'warning' | 'info') {
  const r = await brokerDb().from('broker_notifications').upsert({ event_key: eventKey, strategy_id: strategyId, title, body, tone },
    { onConflict: 'event_key', ignoreDuplicates: true }); check(r.error);
}
export async function deliverNotifications() {
  if (!pushConfigured()) return { configured: false };
  const db = brokerDb();
  const [events, devices] = await Promise.all([
    db.from('broker_notifications').select('*').is('push_sent_at', null).order('created_at').limit(50),
    db.from('broker_push_subscriptions').select('*'),
  ]);
  check(events.error); check(devices.error);
  for (const event of events.data ?? []) {
    let failed = false;
    for (const device of devices.data ?? []) {
      // A subscription may only target the browser vendors' push endpoints.
      try {
        await webpush.sendNotification(device.subscription, JSON.stringify({ id: event.id, title: event.title,
          body: event.body, url: event.strategy_id ? `/strategies/${event.strategy_id}` : '/' }), {
          TTL: 86400, vapidDetails: { subject: process.env.VAPID_SUBJECT!, publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! },
        });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          const deleted = await db.from('broker_push_subscriptions').delete().eq('id', device.id); check(deleted.error);
        } else { failed = true; console.error('푸시 전송 실패', status ?? 'unknown'); }
      }
    }
    if (!failed && (devices.data?.length ?? 0) > 0) {
      const saved = await db.from('broker_notifications').update({ push_sent_at: new Date().toISOString() }).eq('id', event.id); check(saved.error);
    }
  }
  return { configured: true };
}
