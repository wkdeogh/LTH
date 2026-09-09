'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const view = useSearchParams().get('view') ?? '';
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = container.current?.animate([
      { opacity: 0.65, transform: 'translateY(5px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 160, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' });
    return () => animation?.cancel();
  }, [pathname, view]);
  return <div ref={container} className="page-transition">{children}</div>;
}
