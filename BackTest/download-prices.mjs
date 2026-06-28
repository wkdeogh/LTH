#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_SYMBOLS = new Set(['TQQQ', 'SOXL']);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log('Usage: npm run backtest:download -- SYMBOL START_DATE END_DATE [--out path]');
  console.log('Example: npm run backtest:download -- TQQQ 2010-01-01 2026-06-28');
}

function parseDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid`);
  return date;
}

function toUnixSeconds(date) {
  return Math.floor(date.getTime() / 1000);
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '';
  return Number(value.toFixed(6));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.length < 3) {
    usage();
    process.exit(args.includes('--help') ? 0 : 1);
  }

  const [rawSymbol, startValue, endValue] = args;
  const symbol = rawSymbol.toUpperCase();
  if (!VALID_SYMBOLS.has(symbol)) throw new Error('Only TQQQ and SOXL are supported');

  const outIndex = args.indexOf('--out');
  const outputPath = outIndex >= 0 && args[outIndex + 1]
    ? path.resolve(args[outIndex + 1])
    : path.join(__dirname, 'data', `${symbol}.csv`);

  const startDate = parseDate(startValue, 'START_DATE');
  const endDate = parseDate(endValue, 'END_DATE');
  const period2 = new Date(endDate);
  period2.setUTCDate(period2.getUTCDate() + 1);

  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`);
  url.searchParams.set('period1', String(toUnixSeconds(startDate)));
  url.searchParams.set('period2', String(toUnixSeconds(period2)));
  url.searchParams.set('interval', '1d');
  url.searchParams.set('events', 'history|split|div');

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Yahoo request failed: ${response.status} ${response.statusText}`);

  const json = await response.json();
  const result = json.chart?.result?.[0];
  const error = json.chart?.error;
  if (error) throw new Error(`Yahoo error: ${error.description ?? error.code}`);
  if (!result?.timestamp?.length) throw new Error('Yahoo returned no price data');

  const quote = result.indicators?.quote?.[0];
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  if (!quote) throw new Error('Yahoo returned no OHLC data');

  const rows = [['date', 'open', 'high', 'low', 'close', 'adj_close', 'volume']];
  for (let index = 0; index < result.timestamp.length; index += 1) {
    const close = quote.close?.[index];
    const adjustedClose = adjClose[index] ?? close;
    if (!Number.isFinite(close) || !Number.isFinite(adjustedClose) || close <= 0) continue;

    const ratio = adjustedClose / close;
    const date = new Date(result.timestamp[index] * 1000).toISOString().slice(0, 10);
    rows.push([
      date,
      formatNumber(quote.open?.[index] * ratio),
      formatNumber(quote.high?.[index] * ratio),
      formatNumber(quote.low?.[index] * ratio),
      formatNumber(close * ratio),
      formatNumber(adjustedClose),
      Math.trunc(quote.volume?.[index] ?? 0),
    ]);
  }

  if (rows.length === 1) throw new Error('No valid rows after filtering Yahoo data');

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`, 'utf8');
  console.log(`Saved ${rows.length - 1} rows to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
