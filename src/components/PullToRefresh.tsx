'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type RefreshPhase = 'idle' | 'pulling' | 'ready' | 'refreshing' | 'done';

const TRIGGER_DISTANCE = 68;
const MAX_DISTANCE = 92;
const ignoredTargetSelector = [
  'a',
  'button',
  'summary',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '.soxl-chart',
  '.table-wrap',
].join(',');

const phaseLabels: Record<RefreshPhase, string> = {
  idle: '',
  pulling: '조금 더 당겨 주세요',
  ready: '놓으면 새로고침',
  refreshing: '최신 상태 확인 중',
  done: '새로고침 완료!',
};

export function PullToRefresh() {
  const router = useRouter();
  const indicatorRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const trackingRef = useRef(false);
  const verticalRef = useRef(false);
  const phaseRef = useRef<RefreshPhase>('idle');
  const sawPendingRef = useRef(false);
  const refreshStartedAtRef = useRef(0);
  const fallbackTimerRef = useRef<number | null>(null);
  const resetTimerRef = useRef<number | null>(null);
  const [phase, setPhaseState] = useState<RefreshPhase>('idle');
  const [isPending, startTransition] = useTransition();

  const setPhase = useCallback((nextPhase: RefreshPhase) => {
    phaseRef.current = nextPhase;
    setPhaseState(nextPhase);
  }, []);

  const setDistance = useCallback((distance: number) => {
    indicatorRef.current?.style.setProperty('--pull-distance', `${distance}px`);
  }, []);

  const reset = useCallback(() => {
    trackingRef.current = false;
    verticalRef.current = false;
    setPhase('idle');
    setDistance(0);
  }, [setDistance, setPhase]);

  const finishRefresh = useCallback(() => {
    if (phaseRef.current !== 'refreshing') return;
    if (fallbackTimerRef.current) window.clearTimeout(fallbackTimerRef.current);

    const elapsed = Date.now() - refreshStartedAtRef.current;
    const remaining = Math.max(520 - elapsed, 0);
    window.setTimeout(() => {
      setPhase('done');
      setDistance(56);
      if ('vibrate' in navigator) navigator.vibrate([8, 35, 8]);
      resetTimerRef.current = window.setTimeout(reset, 650);
    }, remaining);
  }, [reset, setDistance, setPhase]);

  const refresh = useCallback(() => {
    trackingRef.current = false;
    verticalRef.current = false;
    sawPendingRef.current = false;
    refreshStartedAtRef.current = Date.now();
    setPhase('refreshing');
    setDistance(60);
    if ('vibrate' in navigator) navigator.vibrate(14);

    startTransition(() => {
      router.refresh();
    });

    fallbackTimerRef.current = window.setTimeout(finishRefresh, 4500);
  }, [finishRefresh, router, setDistance, setPhase]);

  useEffect(() => {
    if (phase !== 'refreshing') return;
    if (isPending) {
      sawPendingRef.current = true;
      return;
    }
    if (sawPendingRef.current) finishRefresh();
  }, [finishRefresh, isPending, phase]);

  useEffect(() => {
    const handleTouchStart = (event: TouchEvent) => {
      if (phaseRef.current !== 'idle' || window.scrollY > 0 || event.touches.length !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(ignoredTargetSelector)) return;

      startXRef.current = event.touches[0].clientX;
      startYRef.current = event.touches[0].clientY;
      trackingRef.current = true;
      verticalRef.current = false;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!trackingRef.current || event.touches.length !== 1) return;

      const deltaX = event.touches[0].clientX - startXRef.current;
      const deltaY = event.touches[0].clientY - startYRef.current;

      if (!verticalRef.current) {
        if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
        if (Math.abs(deltaX) >= Math.abs(deltaY) || deltaY <= 0) {
          trackingRef.current = false;
          return;
        }
        verticalRef.current = true;
      }

      if (window.scrollY > 0 || deltaY <= 0) {
        reset();
        return;
      }

      event.preventDefault();
      const distance = Math.min(deltaY * 0.46, MAX_DISTANCE);
      setDistance(distance);
      const nextPhase: RefreshPhase = distance >= TRIGGER_DISTANCE ? 'ready' : 'pulling';

      if (nextPhase !== phaseRef.current) {
        if (nextPhase === 'ready' && 'vibrate' in navigator) navigator.vibrate(10);
        setPhase(nextPhase);
      }
    };

    const handleTouchEnd = () => {
      if (!trackingRef.current) return;
      if (phaseRef.current === 'ready') refresh();
      else reset();
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('touchcancel', reset, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', reset);
      if (fallbackTimerRef.current) window.clearTimeout(fallbackTimerRef.current);
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    };
  }, [refresh, reset, setDistance, setPhase]);

  const symbol = phase === 'done' ? '✓' : phase === 'refreshing' ? '↻' : phase === 'ready' ? '↑' : '↓';

  return (
    <div
      aria-hidden={phase === 'idle'}
      aria-live="polite"
      className="pull-refresh-indicator"
      data-phase={phase}
      ref={indicatorRef}
    >
      <span className="pull-refresh-icon" aria-hidden="true">{symbol}</span>
      <span>{phaseLabels[phase]}</span>
    </div>
  );
}
