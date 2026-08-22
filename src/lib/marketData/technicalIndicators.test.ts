import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTechnicalSnapshot, nextNyseTradingDays } from '@/lib/marketData/technicalIndicators';
import type { MarketCandle } from '@/lib/types';

function risingCandles(count: number): MarketCandle[] {
  const start = new Date('2026-01-02T00:00:00Z');
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    const close = 100 + index;
    return {
      symbol: 'TQQQ',
      trade_date: date.toISOString().slice(0, 10),
      open_price: close - 0.5,
      high_price: close + 1,
      low_price: close - 1,
      close_price: close,
      adjusted_close: close,
      volume: 1_000_000 + index * 1_000,
    };
  });
}

test('상승 일봉에서 기술지표 스냅샷을 결정론적으로 계산한다', () => {
  const snapshot = buildTechnicalSnapshot(risingCandles(220));

  assert.equal(snapshot.latest.close, 319);
  assert.equal(snapshot.movingAverages.sma5, 317);
  assert.equal(snapshot.movingAverages.sma20, 309.5);
  assert.equal(snapshot.momentum.rsi14, 100);
  assert.equal(snapshot.volatility.atr14, 2);
  assert.ok((snapshot.trendSlopePercentPerDay.day20 ?? 0) > 0);
  assert.ok((snapshot.volume.latestToAverage20Ratio ?? 0) > 1);
});

test('다음 NYSE 거래일에서 주말과 추수감사절을 제외한다', () => {
  assert.deepEqual(nextNyseTradingDays('2026-11-25'), [
    '2026-11-27',
    '2026-11-30',
    '2026-12-01',
    '2026-12-02',
    '2026-12-03',
  ]);
});

test('다음 NYSE 거래일에서 성금요일을 제외한다', () => {
  assert.deepEqual(nextNyseTradingDays('2027-03-25', 2), [
    '2027-03-29',
    '2027-03-30',
  ]);
});
