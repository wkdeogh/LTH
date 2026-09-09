'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  ColorType,
  LineSeries,
  LineStyle,
  CrosshairMode,
  createChart,
  type AreaData,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import { usd } from '@/components/Format';
import type { SymbolCode } from '@/lib/types';
import { buildAssetComparison, type AssetValuePoint } from '@/lib/trading';

type RangeKey = '3M' | '6M' | '1Y' | 'ALL';

function subtractRange(dateText: string, range: Exclude<RangeKey, 'ALL'>) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (range === '3M') date.setUTCMonth(date.getUTCMonth() - 3);
  if (range === '6M') date.setUTCMonth(date.getUTCMonth() - 6);
  if (range === '1Y') date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

function signedPercent(value: number | null) {
  if (value === null) return '—';
  const rounded = Math.round(value * 100) / 100;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}%`;
}

function timeToDate(time: Time) {
  if (typeof time === 'string') return time;
  if (typeof time === 'number') return new Date(time * 1000).toISOString().slice(0, 10);
  return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}

export function AssetValueChart({ points, symbol }: { points: AssetValuePoint[]; symbol: SymbolCode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<RangeKey>('ALL');
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const comparison = useMemo(() => buildAssetComparison(points), [points]);
  const pointsByDate = useMemo(() => new Map(comparison.map((point) => [point.date, point])), [comparison]);
  const chartData = useMemo(() => comparison.map((point) => (
    point.accountChangePercent === null
      ? { time: point.date as Time }
      : { time: point.date as Time, value: point.accountChangePercent }
  )), [comparison]);
  const closeData = useMemo(() => comparison.map((point) => (
    point.marketChangePercent === null
      ? { time: point.date as Time }
      : { time: point.date as Time, value: point.marketChangePercent }
  )), [comparison]);

  useEffect(() => {
    if (!containerRef.current || chartData.length === 0) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: containerRef.current.clientHeight,
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
      leftPriceScale: { visible: false },
      rightPriceScale: { visible: true, borderColor: '#dde3e9', textColor: '#677281' },
      timeScale: { borderColor: '#dde3e9', timeVisible: false, rightOffset: 4 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });
    const series = chart.addSeries(AreaSeries, {
      priceScaleId: 'right',
      lineColor: '#155eef',
      lineWidth: 3,
      topColor: 'rgba(21, 94, 239, 0.12)',
      bottomColor: 'rgba(21, 94, 239, 0.025)',
      crosshairMarkerBackgroundColor: '#155eef',
      crosshairMarkerBorderColor: '#ffffff',
      priceLineVisible: false,
      priceFormat: { type: 'percent', precision: 2, minMove: 0.01 },
    });
    series.setData(chartData);
    series.createPriceLine({
      price: 0,
      color: '#9aa5b3',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
    });
    const closeSeries = chart.addSeries(LineSeries, {
      priceScaleId: 'right',
      color: '#c55a11',
      lineWidth: 2,
      priceLineVisible: false,
      crosshairMarkerBackgroundColor: '#c55a11',
      crosshairMarkerBorderColor: '#ffffff',
      priceFormat: { type: 'percent', precision: 2, minMove: 0.01 },
    });
    closeSeries.setData(closeData);

    const fitRange = () => {
      if (range === 'ALL' || points.length === 1) {
        chart.timeScale().setVisibleLogicalRange({ from: -1, to: points.length });
      } else {
        const lastDate = points.at(-1)!.date;
        const requestedStart = subtractRange(lastDate, range);
        const firstDate = points[0].date;
        chart.timeScale().setVisibleRange({
          from: (requestedStart > firstDate ? requestedStart : firstDate) as Time,
          to: lastDate as Time,
        });
      }
    };
    fitRange();
    const resizeObserver = new ResizeObserver(fitRange);
    resizeObserver.observe(containerRef.current);

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      if (!param.time) {
        setHoveredDate(null);
        return;
      }
      const data = param.seriesData.get(series) as AreaData<Time> | undefined;
      const close = param.seriesData.get(closeSeries);
      setHoveredDate(data || close ? timeToDate(param.time) : null);
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);
    return () => {
      resizeObserver.disconnect();
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
    };
  }, [chartData, closeData, points, range]);

  if (points.length === 0) {
    return <section className="panel asset-chart-empty"><strong>아직 자산 기록이 없습니다</strong></section>;
  }

  const displayed = (hoveredDate ? pointsByDate.get(hoveredDate) : null) ?? comparison.at(-1)!;

  return (
    <section className="panel asset-chart-panel">
      <div className="asset-chart-toolbar">
        <div className="asset-chart-value" aria-live="polite">
          <span>{displayed.date} <span className="asset-chart-baseline">기준 {points[0].date} · 0%</span></span>
          <div className="asset-chart-legend">
            <div className="asset-chart-metric asset-chart-metric-account">
              <span>계좌 평가액</span>
              <strong>{usd(displayed.accountValue)}</strong>
              <span className="asset-chart-change">{signedPercent(displayed.accountChangePercent)}</span>
            </div>
            <div className="asset-chart-metric asset-chart-metric-close">
              <span>{symbol} 종가</span>
              <strong>{displayed.marketClosePrice === null ? '—' : usd(displayed.marketClosePrice)}</strong>
              <span className="asset-chart-change">{signedPercent(displayed.marketChangePercent)}</span>
            </div>
          </div>
        </div>
        <div className="chart-ranges asset-chart-ranges" aria-label="자산차트 기간">
          {(['3M', '6M', '1Y', 'ALL'] as RangeKey[]).map((option) => (
            <button
              className={range === option ? 'active' : ''}
              key={option}
              aria-pressed={range === option}
              onClick={() => { setHoveredDate(null); setRange(option); }}
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
      </div>
      <div className="asset-value-chart" ref={containerRef} aria-label={`첫 거래일 ${points[0].date}을 0%로 맞춘 계좌 평가액(파란색)과 ${symbol} 종가(주황색)의 등락률 비교 차트`} />
    </section>
  );
}
