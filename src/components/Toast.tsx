'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { noticeMessages, type NoticeKey } from '@/lib/notices';

export function Toast() {
  const searchParams = useSearchParams();
  const [noticeKey, setNoticeKey] = useState<NoticeKey | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const key = searchParams.get('notice') as NoticeKey | null;
    if (!key || !(key in noticeMessages)) return;

    setNoticeKey(key);
    if ('vibrate' in navigator) {
      navigator.vibrate(noticeMessages[key].tone === 'celebrate' ? [10, 35, 10] : 8);
    }

    const url = new URL(window.location.href);
    url.searchParams.delete('notice');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);

    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setNoticeKey(null), 3400);
  }, [searchParams]);

  useEffect(() => () => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
  }, []);

  if (!noticeKey) return null;

  const notice = noticeMessages[noticeKey];
  return (
    <div className="app-toast" data-tone={notice.tone} role="status" aria-live="polite">
      <span className="app-toast-icon" aria-hidden="true">{notice.tone === 'celebrate' ? '★' : '✓'}</span>
      <span>{notice.message}</span>
      <button className="app-toast-close" onClick={() => setNoticeKey(null)} type="button" aria-label="알림 닫기">×</button>
    </div>
  );
}
