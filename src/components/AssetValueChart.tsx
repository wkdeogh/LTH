'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type AreaData,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import { usd } from '@/components/Format';
import type { AssetValuePoint } from '@/lib/trading';

type RangeKey = '3M' | '6M' | '1Y' | 'ALL';

function subtractRange(dateText: string, range: Exclude<RangeKey, 'ALL'>) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (range === '3M') date.setUTCMonth(date.getUTCMonth() - 3);
  if (range === '6M') date.setUTCMonth(date.getUTCMonth() - 6);
  if (range === '1Y') date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

function timeToDate(time: Time) {
  if (typeof time === 'string') return time;
  if (typeof time === 'number') return new Date(time * 1000).toISOString().slice(0, 10);
  return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}

export function AssetValueChart({ points }: { points: AssetValuePoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<RangeKey>('3M');
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const pointsByDate = useMemo(() => new Map(points.map((point) => [point.date, point])), [points]);
  const chartData = useMemo(() => points.map((point) => ({
    time: point.date as Time,
    value: point.accountValue,
  })), [points]);

  useEffect(() => {
    if (!containerRef.current || chartData.length === 0) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 390,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#677281',
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: '#eef1f4' },
        horzLines: { color: '#eef1f4' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#dde3e9' },
      timeScale: { borderColor: '#dde3e9', timeVisible: false, rightOffset: 4 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: '#155eef',
      lineWidth: 3,
      topColor: 'rgba(21, 94, 239, 0.28)',
      bottomColor: 'rgba(21, 94, 239, 0.025)',
      crosshairMarkerBackgroundColor: '#155eef',
      crosshairMarkerBorderColor: '#ffffff',
      priceLineVisible: false,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    series.setData(chartData);

    if (range === 'ALL' || points.length === 1) {
      chart.timeScale().fitContent();
    } else {
      const lastDate = points.at(-1)!.date;
      const requestedStart = subtractRange(lastDate, range);
      const firstDate = points[0].date;
      chart.timeScale().setVisibleRange({
        from: (requestedStart > firstDate ? requestedStart : firstDate) as Time,
        to: lastDate as Time,
      });
    }

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      if (!param.time) {
        setHoveredDate(null);
        return;
      }
      const data = param.seriesData.get(series) as AreaData<Time> | undefined;
      if (!data || !('value' in data)) return;
      setHoveredDate(timeToDate(param.time));
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);
    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
    };
  }, [chartData, points, range]);

  if (points.length === 0) {
    return <section className="panel asset-chart-empty"><strong>아직 자산 기록이 없습니다</strong></section>;
  }

  const displayed = (hoveredDate ? pointsByDate.get(hoveredDate) : null) ?? points.at(-1)!;

  return (
    <section className="panel asset-chart-panel">
      <div className="asset-chart-toolbar">
        <div className="asset-chart-value" aria-live="polite">
          <span>{displayed.date} · 계좌 평가액</span>
          <strong>{usd(displayed.accountValue)}</strong>
        </div>
        <div className="chart-ranges asset-chart-ranges" aria-label="자산차트 기간">
          {(['3M', '6M', '1Y', 'ALL'] as RangeKey[]).map((option) => (
            <button
              className={range === option ? 'active' : ''}
              key={option}
              onClick={() => setRange(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <div className="asset-chart-breakdown" aria-live="polite">
        <span>현금 <strong>{usd(displayed.cashBalance)}</strong></span>
        <span>주식 <strong>{usd(displayed.positionValue)}</strong></span>
        <span>보유 <strong>{displayed.positionQty}주</strong></span>
        <span>종가 <strong>{usd(displayed.closePrice)}</strong></span>
      </div>
      <div className="asset-value-chart" ref={containerRef} aria-label="일별 계좌 평가액 차트" />
    </section>
  );
}
