'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import type { Execution, MarketCandle } from '@/lib/types';
import { toNumber } from '@/lib/types';

type RangeKey = '3M' | '6M' | '1Y' | '2Y' | '3Y';

type HoverData = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  executions: Array<{ side: 'buy' | 'sell'; quantity: number; price: number }>;
};

function compactNumber(value: number) {
  return new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function subtractRange(dateText: string, range: RangeKey) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (range === '3M') date.setUTCMonth(date.getUTCMonth() - 3);
  if (range === '6M') date.setUTCMonth(date.getUTCMonth() - 6);
  if (range === '1Y') date.setUTCFullYear(date.getUTCFullYear() - 1);
  if (range === '2Y') date.setUTCFullYear(date.getUTCFullYear() - 2);
  if (range === '3Y') date.setUTCFullYear(date.getUTCFullYear() - 3);
  return date.toISOString().slice(0, 10);
}

export function SoxlChart({
  candles,
  executions,
  averagePrice,
  starPrice,
  fullSellPrice,
}: {
  candles: MarketCandle[];
  executions: Execution[];
  averagePrice: number;
  starPrice: number | null;
  fullSellPrice: number | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<RangeKey>('3M');
  const [hover, setHover] = useState<HoverData | null>(null);

  const chartData = useMemo(() => candles.map((candle) => ({
    time: candle.trade_date as Time,
    open: toNumber(candle.open_price),
    high: toNumber(candle.high_price),
    low: toNumber(candle.low_price),
    close: toNumber(candle.close_price),
  })), [candles]);

  const executionsByDate = useMemo(() => {
    const grouped = new Map<string, HoverData['executions']>();
    for (const execution of executions) {
      const list = grouped.get(execution.executed_at) ?? [];
      list.push({
        side: execution.side,
        quantity: execution.quantity,
        price: toNumber(execution.avg_execution_price),
      });
      grouped.set(execution.executed_at, list);
    }
    return grouped;
  }, [executions]);

  useEffect(() => {
    if (!containerRef.current || chartData.length === 0) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 420,
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

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#c33b4a',
      downColor: '#155eef',
      borderUpColor: '#c33b4a',
      borderDownColor: '#155eef',
      wickUpColor: '#c33b4a',
      wickDownColor: '#155eef',
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    series.setData(chartData);

    const candleDates = new Set(candles.map((candle) => candle.trade_date));
    const markers: SeriesMarker<Time>[] = executions
      .filter((execution) => candleDates.has(execution.executed_at))
      .sort((a, b) => a.executed_at.localeCompare(b.executed_at) || a.created_at.localeCompare(b.created_at))
      .map((execution) => ({
        time: execution.executed_at as Time,
        position: execution.side === 'buy' ? 'belowBar' : 'aboveBar',
        color: execution.side === 'buy' ? '#087a55' : '#be185d',
        shape: execution.side === 'buy' ? 'arrowUp' : 'arrowDown',
        size: 1,
      }));
    createSeriesMarkers(series, markers);

    if (averagePrice > 0) {
      series.createPriceLine({
        price: averagePrice,
        color: '#0f766e',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: '평균단가',
      });
    }
    if (starPrice && starPrice > 0) {
      series.createPriceLine({
        price: starPrice,
        color: '#8c5a00',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '별지점',
      });
    }
    if (fullSellPrice && fullSellPrice > 0) {
      series.createPriceLine({
        price: fullSellPrice,
        color: '#6538a6',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '전량매도',
      });
    }

    const showRange = () => {
      const lastDate = candles.at(-1)!.trade_date;
      const requestedStart = subtractRange(lastDate, range);
      const firstDate = candles[0].trade_date;
      chart.timeScale().setVisibleRange({
        from: (requestedStart > firstDate ? requestedStart : firstDate) as Time,
        to: lastDate as Time,
      });
    };

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      if (!param.time) {
        setHover(null);
        return;
      }
      const data = param.seriesData.get(series) as CandlestickData<Time> | undefined;
      if (!data || !('open' in data)) return;
      const date = typeof param.time === 'string'
        ? param.time
        : typeof param.time === 'number'
          ? new Date(param.time * 1000).toISOString().slice(0, 10)
          : `${param.time.year}-${String(param.time.month).padStart(2, '0')}-${String(param.time.day).padStart(2, '0')}`;
      const candle = candles.find((item) => item.trade_date === date);
      setHover({
        date,
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close,
        volume: candle ? toNumber(candle.volume) : 0,
        executions: executionsByDate.get(date) ?? [],
      });
    };

    showRange();
    chart.subscribeCrosshairMove(handleCrosshairMove);
    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
    };
  }, [averagePrice, candles, chartData, executions, executionsByDate, fullSellPrice, range, starPrice]);

  const latest = candles.at(-1);
  const displayed = hover ?? (latest ? {
    date: latest.trade_date,
    open: toNumber(latest.open_price),
    high: toNumber(latest.high_price),
    low: toNumber(latest.low_price),
    close: toNumber(latest.close_price),
    volume: toNumber(latest.volume),
    executions: executionsByDate.get(latest.trade_date) ?? [],
  } : null);

  if (candles.length === 0) {
    return (
      <div className="chart-empty">
        <strong>아직 SOXL 차트 데이터가 없습니다.</strong>
        <p>다음 체결을 저장하면 서버가 최근 3년 OHLC 데이터를 백그라운드에서 갱신합니다.</p>
      </div>
    );
  }

  return (
    <div className="soxl-chart-shell">
      <div className="chart-toolbar">
        <div className="chart-legend" aria-live="polite">
          {displayed && (
            <>
              <strong>{displayed.date}</strong>
              <span>시 {displayed.open.toFixed(2)}</span>
              <span>고 {displayed.high.toFixed(2)}</span>
              <span>저 {displayed.low.toFixed(2)}</span>
              <span>종 {displayed.close.toFixed(2)}</span>
              <span>거래량 {compactNumber(displayed.volume)}</span>
              {displayed.executions.map((execution, index) => (
                <span className={execution.side === 'buy' ? 'chart-buy' : 'chart-sell'} key={`${execution.side}-${index}`}>
                  {execution.side === 'buy' ? '매수' : '매도'} {execution.quantity}주 @ {execution.price.toFixed(2)}
                </span>
              ))}
            </>
          )}
        </div>
        <div className="chart-ranges" aria-label="차트 기간">
          {(['3M', '6M', '1Y', '2Y', '3Y'] as RangeKey[]).map((option) => (
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
      <div className="soxl-chart" ref={containerRef} aria-label="SOXL 일봉 캔들 차트" />
      <div className="chart-key">
        <span><i className="buy-dot" />매수 체결</span>
        <span><i className="sell-dot" />매도 체결</span>
        {averagePrice > 0 && <span><i className="average-price-line" />평균단가 {averagePrice.toFixed(2)}</span>}
        {starPrice && <span><i className="star-line" />별지점 {starPrice.toFixed(2)}</span>}
        {fullSellPrice && <span><i className="full-sell-line" />전량매도 {fullSellPrice.toFixed(2)}</span>}
      </div>
    </div>
  );
}
