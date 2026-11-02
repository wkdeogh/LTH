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
type Status = { configured: boolean; enabled: boolean; activeFrom?: string | null; syncEnabled?: boolean;
  lastError?: string | null; ordersReady?: boolean; message?: string };
// Retain the last confirmed value across cached App Router navigation. Never
// persist a guessed state or treat an unfinished request as a saved setting.
const statusCache = new Map<string, Status>();

export function AutoTradeControl({ strategyId, initialStatus }: { strategyId: string; initialStatus: Status | null }) {
  const [status, setStatus] = useState<Status | null>(() => statusCache.get(strategyId) ?? initialStatus);
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState(''), [failed, setFailed] = useState(false);
  const [dismissedIssue, setDismissedIssue] = useState('');
  const revision = useRef(0);
  const router = useRouter();
  useEffect(() => {
    let active = true;
    const current = revision.current;
    request(`/api/broker?strategyId=${strategyId}`).then(data => {
      if (active && revision.current === current) { statusCache.set(strategyId, data); setStatus(data); }
    }).catch(e => { if (active && revision.current === current) { setFailed(true); setFeedback(e.message); } });
    return () => { active = false; };
  }, [strategyId]);
  useEffect(() => {
    if (!feedback || failed) return;
    const timer = window.setTimeout(() => setFeedback(''), 3400);
    return () => window.clearTimeout(timer);
  }, [feedback, failed]);
  async function toggle() {
    if (!status || busy) return;
    revision.current++;
    setBusy(true); setFeedback(''); setFailed(false);
    try {
      const data = await request('/api/broker', { action: 'toggle', strategyId, enabled: !status.enabled });
      const next = { ...status, enabled: data.enabled, activeFrom: data.activeFrom };
      statusCache.set(strategyId, next); setStatus(next); setFeedback(data.message);
      router.refresh();
    } catch (e) { setFailed(true); setFeedback((e as Error).message); }
    finally { setBusy(false); }
  }
  const issue = status?.lastError || status?.message || (status?.ordersReady === false ? '주문 설정을 확인해 주세요.' : '');
  const subtitle = !status ? '확인 중…' : issue ? '설정 확인 필요' : status.enabled
    ? `켜짐${status.activeFrom ? ` · ${status.activeFrom.slice(5).replace('-', '.')}부터` : ''}` : '꺼짐';
  return <>
    <section className="broker-control" aria-label="자동매매 설정">
      <div className="broker-control-row">
        <div><strong>자동매매</strong><small title={issue || undefined}>{subtitle}</small></div>
        {status ? <button type="button" role="switch" aria-checked={status.enabled} aria-label="자동매매"
          className={`broker-switch ${status.enabled ? 'on' : ''}`} onClick={toggle}
          disabled={!status.configured || status.ordersReady === false || busy} aria-busy={busy}><span /></button>
          : <span className="broker-switch-pending" role="status" aria-label="자동매매 상태 확인 중" />}
      </div>
    </section>
    {(feedback || issue && issue !== dismissedIssue) && <div className="app-toast" role={failed || issue ? 'alert' : 'status'}>
      <span>{feedback || issue}</span>
      <button type="button" className="app-toast-close" aria-label="안내 닫기" onClick={() => {
        setFeedback(''); setDismissedIssue(issue);
      }}>×</button>
    </div>}
  </>;
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
  const [loaded, setLoaded] = useState(false), [loadError, setLoadError] = useState('');
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false), [pushConnected, setPushConnected] = useState(false);
  const [pushError, setPushError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const load = useCallback(async () => {
    if (document.visibilityState === 'hidden') return null;
    try {
      const data = await request('/api/notifications');
      setItems(data.notifications ?? []); setPublicKey(data.publicKey ?? null); setLoaded(true); setLoadError('');
      return data.notifications as NotificationItem[];
    } catch { setLoadError('알림 내역을 불러오지 못했습니다.'); return null; }
  }, []);
  useEffect(() => { void load(); const interval = window.setInterval(() => { void load(); }, 60000);
    const visible = () => { void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, [load]);
  useEffect(() => {
    if (!open || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    let active = true;
    navigator.serviceWorker.getRegistration('/sw.js').then(r => r?.pushManager.getSubscription())
      .then(s => { if (active) setPushConnected(Boolean(s)); }).catch(() => {});
    return () => { active = false; };
  }, [open]);
  const unread = items.filter(i => !i.read_at).length;
  async function show() {
    dialog.current?.showModal(); setOpen(true);
    const current = await load();
    const ids = current?.filter(i => !i.read_at).map(i => i.id) ?? [];
    if (ids.length) {
      try {
        await request('/api/notifications', { action: 'read', ids });
        setItems(previous => previous.map(i => ids.includes(i.id) ? { ...i, read_at: new Date().toISOString() } : i));
      } catch { /* Preserve unread markers when saving fails. */ }
    }
  }
  async function subscribe() {
    if (pushBusy) return;
    setPushError('');
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setPushError('아이폰은 홈 화면에 추가한 앱에서 알림을 허용해 주세요.'); return;
    }
    if (!publicKey) { setPushError('서버의 푸시 알림 설정을 확인해 주세요.'); return; }
    setPushBusy(true);
    try {
      // Keep the permission request in the user's click gesture for iOS.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('기기 설정에서 이 앱의 알림을 허용해 주세요.');
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const key = publicKey.replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(key), c => c.charCodeAt(0));
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: bytes,
      });
      await request('/api/notifications', { action: 'subscribe', subscription: subscription.toJSON() });
      setPushConnected(true);
    } catch (e) { setPushError((e as Error).message || '푸시 알림 연결에 실패했습니다.'); }
    finally { setPushBusy(false); }
  }
  return <div className="broker-notifications">
    <button type="button" className="broker-notification-button" onClick={show} aria-label={unread ? `알림, 읽지 않은 알림 ${unread}개` : '알림'}
      aria-haspopup="dialog" aria-expanded={open} aria-controls="broker-notification-list">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" />
      </svg>
      {unread > 0 && <span className="broker-unread" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
    </button>
    <dialog ref={dialog} id="broker-notification-list" className="broker-notification-dialog" aria-labelledby="broker-notification-title"
      onClose={() => setOpen(false)} onClick={event => { if (event.target === dialog.current) {
        const box = dialog.current.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.current.close();
      } }}>
      <div className="broker-notification-heading"><h2 id="broker-notification-title">알림</h2>
        <button type="button" className="broker-icon-button" aria-label="알림 닫기" onClick={() => dialog.current?.close()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div className="broker-push-settings">
        <div><strong>푸시 알림</strong><small>{pushConnected ? '이 기기로 알림을 받습니다' : '주문·체결 결과와 오류 알림'}</small></div>
        <button type="button" className="secondary" onClick={subscribe} disabled={pushBusy || !loaded || pushConnected} aria-busy={pushBusy}>
          {pushBusy ? '연결 중…' : pushConnected ? '연결됨' : '알림 받기'}
        </button>
      </div>
      {pushError && <p className="broker-message error" role="alert">{pushError}</p>}
      <section className="broker-notification-list" aria-label="알림 내역">
        {loadError ? <p role="alert">{loadError}<button type="button" className="broker-text-button" onClick={() => { void load(); }}>다시 시도</button></p>
          : !loaded ? <p className="muted" role="status">알림을 불러오는 중…</p>
          : !items.length ? <p className="broker-notification-empty muted">새 알림이 없습니다.</p> : null}
        {items.map(item => <article key={item.id} data-tone={item.tone}><strong>{item.title}</strong><p>{item.body}</p></article>)}
      </section>
    </dialog>
  </div>;
}
