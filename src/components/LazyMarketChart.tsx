'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { MarketChartProps } from '@/components/MarketChart';

const DynamicMarketChart = dynamic(
  () => import('@/components/MarketChart').then((module) => module.MarketChart),
  {
    ssr: false,
    loading: () => <ChartSkeleton />,
  },
);

function ChartSkeleton({ symbol }: { symbol?: string }) {
  return (
    <div className="chart-loading" role="status" aria-label={`${symbol ?? '종목'} 차트 불러오는 중`}>
      <span className="sr-only">{symbol ?? '종목'} 차트를 불러오고 있습니다.</span>
      <div className="chart-loading-toolbar" aria-hidden="true">
        <span className="skeleton-block" />
        <span className="skeleton-block" />
      </div>
      <span className="skeleton-block chart-loading-canvas" aria-hidden="true" />
    </div>
  );
}

export function LazyMarketChart(props: MarketChartProps) {
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
      {isVisible ? <DynamicMarketChart {...props} /> : <ChartSkeleton symbol={props.symbol} />}
    </div>
  );
}
