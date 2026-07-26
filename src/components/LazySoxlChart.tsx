'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { SoxlChartProps } from '@/components/SoxlChart';

const DynamicSoxlChart = dynamic(
  () => import('@/components/SoxlChart').then((module) => module.SoxlChart),
  {
    ssr: false,
    loading: () => <ChartSkeleton />,
  },
);

function ChartSkeleton() {
  return (
    <div className="chart-loading" role="status" aria-label="SOXL 차트 불러오는 중">
      <span className="sr-only">SOXL 차트를 불러오고 있습니다.</span>
      <div className="chart-loading-toolbar" aria-hidden="true">
        <span className="skeleton-block" />
        <span className="skeleton-block" />
      </div>
      <span className="skeleton-block chart-loading-canvas" aria-hidden="true" />
    </div>
  );
}

export function LazySoxlChart(props: SoxlChartProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const target = shellRef.current;
    if (!target || isVisible) return;
    if (!('IntersectionObserver' in window)) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setIsVisible(true);
      observer.disconnect();
    }, { rootMargin: '280px 0px' });

    observer.observe(target);
    return () => observer.disconnect();
  }, [isVisible]);

  return (
    <div className="lazy-chart-shell" ref={shellRef}>
      {isVisible ? <DynamicSoxlChart {...props} /> : <ChartSkeleton />}
    </div>
  );
}
