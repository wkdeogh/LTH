import type { MarketCandle } from '@/lib/types';
import { toNumber } from '@/lib/types';

type NumericCandle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function validNumber(value: number) {
  return Number.isFinite(value) && value > 0;
}

export function normalizeMarketCandles(candles: MarketCandle[]): NumericCandle[] {
  return candles
    .map((candle) => ({
      date: candle.trade_date,
      open: toNumber(candle.open_price),
      high: toNumber(candle.high_price),
      low: toNumber(candle.low_price),
      close: toNumber(candle.close_price),
      volume: Math.max(0, toNumber(candle.volume)),
    }))
    .filter((candle) => (
      validNumber(candle.open)
      && validNumber(candle.high)
      && validNumber(candle.low)
      && validNumber(candle.close)
      && candle.high >= candle.low
    ))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function average(values: number[]) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function latestSma(values: number[], period: number) {
  if (values.length < period) return null;
  return average(values.slice(-period));
}

function emaSeries(values: number[], period: number) {
  if (values.length === 0) return [];
  const multiplier = 2 / (period + 1);
  const result = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    result.push(values[index] * multiplier + result[index - 1] * (1 - multiplier));
  }
  return result;
}

function latestRsi(values: number[], period = 14) {
  if (values.length <= period) return null;
  const changes = values.slice(1).map((value, index) => value - values[index]);
  let averageGain = changes.slice(0, period).reduce((sum, change) => sum + Math.max(change, 0), 0) / period;
  let averageLoss = changes.slice(0, period).reduce((sum, change) => sum + Math.max(-change, 0), 0) / period;

  for (const change of changes.slice(period)) {
    averageGain = ((averageGain * (period - 1)) + Math.max(change, 0)) / period;
    averageLoss = ((averageLoss * (period - 1)) + Math.max(-change, 0)) / period;
  }

  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  return 100 - (100 / (1 + (averageGain / averageLoss)));
}

function latestAtr(candles: NumericCandle[], period = 14) {
  if (candles.length < period) return null;
  const trueRanges = candles.map((candle, index) => {
    const previousClose = index === 0 ? candle.close : candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const trueRange of trueRanges.slice(period)) {
    atr = ((atr * (period - 1)) + trueRange) / period;
  }
  return atr;
}

function latestBollinger(values: number[], period = 20, deviations = 2) {
  if (values.length < period) return null;
  const window = values.slice(-period);
  const middle = average(window)!;
  const variance = window.reduce((sum, value) => sum + ((value - middle) ** 2), 0) / period;
  const standardDeviation = Math.sqrt(variance);
  const upper = middle + deviations * standardDeviation;
  const lower = middle - deviations * standardDeviation;
  const width = middle === 0 ? 0 : ((upper - lower) / middle) * 100;
  const percentB = upper === lower ? 0.5 : (values.at(-1)! - lower) / (upper - lower);
  return { lower, middle, upper, width, percentB };
}

function latestStochastic(candles: NumericCandle[], period = 14) {
  if (candles.length < period) return null;
  const window = candles.slice(-period);
  const highest = Math.max(...window.map((candle) => candle.high));
  const lowest = Math.min(...window.map((candle) => candle.low));
  return highest === lowest ? 50 : ((window.at(-1)!.close - lowest) / (highest - lowest)) * 100;
}

function periodReturn(values: number[], period: number) {
  if (values.length <= period) return null;
  const previous = values.at(-(period + 1))!;
  return previous === 0 ? null : ((values.at(-1)! / previous) - 1) * 100;
}

function regressionSlopePercent(values: number[], period: number) {
  if (values.length < period) return null;
  const window = values.slice(-period).map(Math.log);
  const xMean = (period - 1) / 2;
  const yMean = average(window)!;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < period; index += 1) {
    numerator += (index - xMean) * (window[index] - yMean);
    denominator += (index - xMean) ** 2;
  }
  return (Math.exp(numerator / denominator) - 1) * 100;
}

function realizedVolatility(values: number[], period = 20) {
  if (values.length <= period) return null;
  const window = values.slice(-(period + 1));
  const returns = window.slice(1).map((value, index) => Math.log(value / window[index]));
  const mean = average(returns)!;
  const variance = returns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / Math.max(returns.length - 1, 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function obvChangePercent(candles: NumericCandle[], period = 20) {
  if (candles.length <= period) return null;
  const obv = [0];
  for (let index = 1; index < candles.length; index += 1) {
    const direction = Math.sign(candles[index].close - candles[index - 1].close);
    obv.push(obv[index - 1] + direction * candles[index].volume);
  }
  const previous = obv.at(-(period + 1))!;
  const current = obv.at(-1)!;
  const scale = candles.slice(-period).reduce((sum, candle) => sum + candle.volume, 0) || 1;
  return ((current - previous) / scale) * 100;
}

function nullableRound(value: number | null, digits = 4) {
  return value === null || !Number.isFinite(value) ? null : round(value, digits);
}

export function buildTechnicalSnapshot(candles: MarketCandle[]) {
  const normalized = normalizeMarketCandles(candles);
  if (normalized.length < 60) {
    throw new Error('AI 차트 분석에는 최소 60개 이상의 유효한 일봉이 필요합니다.');
  }

  const closes = normalized.map((candle) => candle.close);
  const volumes = normalized.map((candle) => candle.volume);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdSeries = closes.map((_, index) => ema12[index] - ema26[index]);
  const signalSeries = emaSeries(macdSeries, 9);
  const latestClose = closes.at(-1)!;
  const latestCandle = normalized.at(-1)!;
  const previousCandle = normalized.at(-2)!;
  const atr = latestAtr(normalized);
  const bollinger = latestBollinger(closes);
  const averageVolume20 = latestSma(volumes, 20);
  const range20 = normalized.slice(-20);
  const range60 = normalized.slice(-60);

  return {
    latest: {
      date: latestCandle.date,
      open: round(latestCandle.open),
      high: round(latestCandle.high),
      low: round(latestCandle.low),
      close: round(latestClose),
      volume: Math.round(latestCandle.volume),
      gapPercent: round(((latestCandle.open / previousCandle.close) - 1) * 100),
      bodyPercent: round(((latestCandle.close / latestCandle.open) - 1) * 100),
      rangePercent: round(((latestCandle.high - latestCandle.low) / latestCandle.close) * 100),
    },
    returnsPercent: {
      day1: nullableRound(periodReturn(closes, 1)),
      day5: nullableRound(periodReturn(closes, 5)),
      day20: nullableRound(periodReturn(closes, 20)),
      day60: nullableRound(periodReturn(closes, 60)),
    },
    movingAverages: {
      sma5: nullableRound(latestSma(closes, 5)),
      sma10: nullableRound(latestSma(closes, 10)),
      sma20: nullableRound(latestSma(closes, 20)),
      sma50: nullableRound(latestSma(closes, 50)),
      sma200: nullableRound(latestSma(closes, 200)),
      ema12: nullableRound(ema12.at(-1) ?? null),
      ema26: nullableRound(ema26.at(-1) ?? null),
    },
    momentum: {
      rsi14: nullableRound(latestRsi(closes)),
      stochasticK14: nullableRound(latestStochastic(normalized)),
      macd: nullableRound(macdSeries.at(-1) ?? null),
      macdSignal: nullableRound(signalSeries.at(-1) ?? null),
      macdHistogram: nullableRound(macdSeries.at(-1)! - signalSeries.at(-1)!),
    },
    volatility: {
      atr14: nullableRound(atr),
      atrPercent: atr === null ? null : round((atr / latestClose) * 100),
      realizedVolatility20AnnualizedPercent: nullableRound(realizedVolatility(closes)),
      bollinger20: bollinger === null ? null : {
        lower: round(bollinger.lower),
        middle: round(bollinger.middle),
        upper: round(bollinger.upper),
        widthPercent: round(bollinger.width),
        percentB: round(bollinger.percentB),
      },
    },
    trendSlopePercentPerDay: {
      day5: nullableRound(regressionSlopePercent(closes, 5)),
      day20: nullableRound(regressionSlopePercent(closes, 20)),
      day60: nullableRound(regressionSlopePercent(closes, 60)),
    },
    volume: {
      latestToAverage20Ratio: averageVolume20 && averageVolume20 > 0
        ? round(latestCandle.volume / averageVolume20)
        : null,
      obvChange20NormalizedPercent: nullableRound(obvChangePercent(normalized)),
    },
    levels: {
      low20: round(Math.min(...range20.map((candle) => candle.low))),
      high20: round(Math.max(...range20.map((candle) => candle.high))),
      low60: round(Math.min(...range60.map((candle) => candle.low))),
      high60: round(Math.max(...range60.map((candle) => candle.high))),
    },
  };
}

function easterSundayUtc(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addObservedHoliday(set: Set<string>, year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month, day));
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1);
  set.add(dateKey(date));
}

function nthWeekday(year: number, month: number, weekday: number, nth: number) {
  const date = new Date(Date.UTC(year, month, 1));
  date.setUTCDate(1 + ((7 + weekday - date.getUTCDay()) % 7) + (nth - 1) * 7);
  return date;
}

function lastWeekday(year: number, month: number, weekday: number) {
  const date = new Date(Date.UTC(year, month + 1, 0));
  date.setUTCDate(date.getUTCDate() - ((7 + date.getUTCDay() - weekday) % 7));
  return date;
}

function nyseHolidays(year: number) {
  const holidays = new Set<string>();
  addObservedHoliday(holidays, year, 0, 1);
  addObservedHoliday(holidays, year + 1, 0, 1);
  addObservedHoliday(holidays, year, 5, 19);
  addObservedHoliday(holidays, year, 6, 4);
  addObservedHoliday(holidays, year, 11, 25);
  holidays.add(dateKey(nthWeekday(year, 0, 1, 3)));
  holidays.add(dateKey(nthWeekday(year, 1, 1, 3)));
  holidays.add(dateKey(lastWeekday(year, 4, 1)));
  holidays.add(dateKey(nthWeekday(year, 8, 1, 1)));
  holidays.add(dateKey(nthWeekday(year, 10, 4, 4)));
  const goodFriday = easterSundayUtc(year);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  holidays.add(dateKey(goodFriday));
  return holidays;
}

export function nextNyseTradingDays(lastTradeDate: string, count = 5) {
  const cursor = new Date(`${lastTradeDate}T00:00:00Z`);
  const result: string[] = [];
  const holidaysByYear = new Map<number, Set<string>>();

  while (result.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const year = cursor.getUTCFullYear();
    const holidays = holidaysByYear.get(year) ?? nyseHolidays(year);
    holidaysByYear.set(year, holidays);
    const key = dateKey(cursor);
    if (!holidays.has(key)) result.push(key);
  }

  return result;
}
