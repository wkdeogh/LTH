'use client';

import { useEffect } from 'react';

const touchTargetSelector = [
  'button:not(:disabled)',
  'a[href]',
  'summary',
].join(',');

export function TouchFeedback() {
  useEffect(() => {
    let activeTarget: HTMLElement | null = null;

    const release = () => {
      if (!activeTarget) return;
      const target = activeTarget;
      activeTarget = null;
      window.setTimeout(() => {
        target.classList.remove('is-touching');
      }, 70);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>(touchTargetSelector)
        : null;
      if (!target || target.getAttribute('aria-disabled') === 'true') return;

      activeTarget?.classList.remove('is-touching');
      activeTarget = target;
      target.classList.add('is-touching');

      if ('vibrate' in navigator) navigator.vibrate(8);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', release, true);
      activeTarget?.classList.remove('is-touching');
    };
  }, []);

  return null;
}
