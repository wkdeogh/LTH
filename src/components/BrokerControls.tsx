'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

async function request(path: string, body?: unknown) {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    : { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || '요청을 완료하지 못했습니다.');
  return data;
}
type Status = { configured: boolean; enabled: boolean; activeFrom?: string; syncEnabled?: boolean;
  lastError?: string; publicPushKey?: string; ordersReady?: boolean; message?: string };

export function AutoTradeControl({ strategyId }: { strategyId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [pushState, setPushState] = useState('알림 받기');
  useEffect(() => {
    let active = true;
    request(`/api/broker?strategyId=${strategyId}`).then(data => { if (active) setStatus(data); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [strategyId]);
  async function toggle() {
    if (!status || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await request('/api/broker', { action: 'toggle', strategyId, enabled: !status.enabled });
      setStatus({ ...status, enabled: data.enabled, activeFrom: data.activeFrom }); setMessage(data.message);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function subscribe() {
    setError('');
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setError('아이폰은 홈 화면에 추가한 앱에서 알림을 허용해 주세요.'); return;
    }
    if (!status?.publicPushKey) { setError('서버의 푸시 알림 설정이 필요합니다.'); return; }
    // Request permission directly in this click, before network/worker awaits.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { setError('알림을 허용해야 잠금화면 알림을 받을 수 있습니다.'); return; }
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const key = status.publicPushKey.replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(key), c => c.charCodeAt(0));
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: bytes,
      });
      await request('/api/notifications', { action: 'subscribe', subscription: subscription.toJSON() });
      setPushState('알림 연결됨'); setMessage('이 기기로 푸시 알림을 받습니다.');
    } catch (e) { setError((e as Error).message || '푸시 알림 연결에 실패했습니다.'); }
  }
  return <section className="broker-control" aria-label="자동매매 설정">
    <div className="broker-control-row">
      <div><strong>자동매매</strong><small>{status?.enabled ? `${status.activeFrom} 거래일부터` : '꺼짐'}</small></div>
      <button type="button" role="switch" aria-checked={status?.enabled ?? false} aria-label="자동매매"
        className={`broker-switch ${status?.enabled ? 'on' : ''}`} onClick={toggle}
        disabled={!status?.configured || status.ordersReady === false || busy} aria-busy={busy}><span /></button>
    </div>
    {status?.syncEnabled && <div className="broker-connection"><span>체결 자동 반영 연결됨</span><button type="button" className="broker-text-button" onClick={subscribe}>{pushState}</button></div>}
    {(error || status?.lastError || status?.message) && <p className="broker-message error" role="alert">{error || status?.lastError || status?.message}</p>}
    {status?.ordersReady === false && <p className="broker-message error">주문 기능을 사용하려면 앱 접속 비밀번호 설정이 필요합니다.</p>}
    {message && <p className="broker-message" role="status">{message}</p>}
  </section>;
}

type Preview = { runId: string; token: string; symbol: string; currentPrice: number;
  orders: { key: string; side: string; orderType: string; price: number | null; quantity: number }[];
  skipped: { label: string; reason: string }[] };
export function ApiOrderButton({ strategyId }: { strategyId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState(''), [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), inFlight = useRef(false);
  const router = useRouter();
  useEffect(() => { if (preview) dialog.current?.showModal(); }, [preview]);
  async function prepare() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setFeedback(''); setFailed(false);
    try { setPreview(await request('/api/broker', { action: 'preview', strategyId })); }
    catch (e) { setFailed(true); setFeedback((e as Error).message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function confirm() {
    if (!preview || inFlight.current) return;
    inFlight.current = true; setSending(true); setFeedback('');
    try {
      const result = await request('/api/broker', { action: 'confirm', runId: preview.runId, token: preview.token });
      setFailed(false); setFeedback(result.message); dialog.current?.close(); setPreview(null); router.refresh();
    } catch (e) { setFailed(true); setFeedback((e as Error).message); }
    finally { inFlight.current = false; setSending(false); }
  }
  return <section className="broker-order-panel">
    <button type="button" className="broker-api-button" onClick={prepare} disabled={busy || sending} aria-busy={busy || sending}>{busy ? '주문 확인 중…' : 'API 주문'}</button>
    {feedback && !preview && <p className={`broker-message ${failed ? 'error' : ''}`} role={failed ? 'alert' : 'status'}>{feedback}</p>}
    <dialog ref={dialog} className="broker-dialog" aria-labelledby="broker-order-title"
      onCancel={event => { if (sending) event.preventDefault(); }} onClose={() => { if (!sending) setPreview(null); }}>
      <h2 id="broker-order-title">{preview?.symbol} API 주문 확인</h2>
      <p className="broker-dialog-reference">현재가 ${preview?.currentPrice.toFixed(2)}</p>
      <div className="broker-order-preview">{preview?.orders.map(o => <div className="broker-order-line" key={o.key}>
        <strong className={o.side === 'buy' ? 'profit-negative' : 'profit-positive'}>{o.side === 'buy' ? '매수' : '매도'} <small>{o.orderType}</small></strong>
        <span>{o.price === null ? '시장가' : `$${o.price.toFixed(2)}`}</span><strong>{o.quantity}주</strong>
      </div>)}</div>
      {!!preview?.skipped.length && <details className="broker-skipped"><summary>제외된 주문 {preview.skipped.length}건</summary>
        {preview.skipped.map((o, i) => <p key={`${o.label}-${i}`}>{o.label} · {o.reason}</p>)}</details>}
      <p>위 주문을 실계좌로 전송할까요?</p>
      {feedback && <p className="broker-message error" role="alert">{feedback}</p>}
      <div className="broker-dialog-actions"><button type="button" className="secondary" disabled={sending} onClick={() => dialog.current?.close()}>취소</button>
        <button type="button" disabled={sending} onClick={confirm}>{sending ? '1초 간격으로 전송 중…' : '주문 전송'}</button></div>
    </dialog>
  </section>;
}

type NotificationItem = { id: string; strategy_id: string | null; title: string; body: string; tone: string; read_at: string | null };
export function BrokerNotifications() {
  const [items, setItems] = useState<NotificationItem[]>([]), [open, setOpen] = useState(false);
  const load = useCallback(() => {
    if (document.visibilityState === 'hidden') return;
    request('/api/notifications').then(r => setItems(r.notifications ?? [])).catch(() => {});
  }, []);
  useEffect(() => { load(); const interval = window.setInterval(load, 60000);
    document.addEventListener('visibilitychange', load);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', load); };
  }, [load]);
  const unread = items.filter(i => !i.read_at).length;
  async function toggle() {
    setOpen(!open);
    if (!open && unread) {
      try { await request('/api/notifications', { action: 'read', ids: items.filter(i => !i.read_at).map(i => i.id) }); load(); } catch { /* keep unread for next attempt */ }
    }
  }
  return <div className="broker-notifications">
    <button type="button" className="broker-notification-button" onClick={toggle} aria-expanded={open} aria-controls="broker-notification-list">알림{unread > 0 && <span>{unread}</span>}</button>
    {open && <section id="broker-notification-list" className="broker-notification-list" aria-label="알림 내역">
      {!items.length && <p className="muted">새 알림이 없습니다.</p>}
      {items.map(item => <article key={item.id} data-tone={item.tone}><strong>{item.title}</strong><p>{item.body}</p></article>)}
    </section>}
  </div>;
}
