#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_SYMBOLS = new Set(['TQQQ', 'SOXL']);
const VALID_SPLITS = new Set([20, 40]);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log('Usage: npm run backtest:run -- SYMBOL SPLIT_COUNT PRINCIPAL START_DATE END_DATE [--compound|--simple] [--csv path]');
  console.log('Example: npm run backtest:run -- TQQQ 40 20000 2020-01-01 2024-12-31');
}

function parseDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new Error(`${label} must be YYYY-MM-DD`);
  return value;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

function roundPrice(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function roundT(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000000000) / 10000000000;
}

function floorShares(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function money(value) {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function percent(value) {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%`;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift()?.split(',') ?? [];
  return lines.map((line) => {
    const columns = line.split(',');
    return Object.fromEntries(headers.map((header, index) => [header, columns[index]]));
  });
}

async function loadPrices(csvPath, startDate, endDate) {
  const text = await readFile(csvPath, 'utf8');
  const seen = new Set();
  const rows = parseCsv(text)
    .map((row) => ({
      date: row.date,
      open: toNumber(row.open),
      high: toNumber(row.high),
      low: toNumber(row.low),
      close: toNumber(row.close),
      adjClose: toNumber(row.adj_close),
      volume: toNumber(row.volume),
    }))
    .filter((row) => row.date >= startDate && row.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const row of rows) {
    if (seen.has(row.date)) throw new Error(`Duplicate price date: ${row.date}`);
    seen.add(row.date);
    if (!row.open || !row.high || !row.low || !row.close) throw new Error(`Invalid OHLC row: ${row.date}`);
  }

  if (rows.length < 6) throw new Error('Need at least 6 trading days for a useful backtest');
  return rows;
}

function calculateStarPercent(symbol, splitCount, tValue) {
  if (symbol === 'TQQQ' && splitCount === 20) return (15 - 1.5 * tValue) / 100;
  if (symbol === 'TQQQ' && splitCount === 40) return (15 - 0.75 * tValue) / 100;
  if (splitCount === 20) return (20 - 2 * tValue) / 100;
  return (20 - tValue) / 100;
}

function applyTEffect(tValue, effect, splitCount) {
  switch (effect) {
    case 'buy_full':
      return roundT(tValue + 1);
    case 'buy_half':
      return roundT(tValue + 0.5);
    case 'quarter_sell':
      return roundT(tValue * 0.75);
    case 'reverse_sell':
      return roundT(splitCount === 20 ? tValue * 0.9 : tValue * 0.95);
    case 'reverse_buy':
      return roundT(tValue + (splitCount - tValue) * 0.25);
    default:
      return roundT(tValue);
  }
}

function canFillAtPrice(day, price) {
  return price > 0 && day.low <= price && price <= day.high;
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function createInitialState({ symbol, splitCount, principal, compoundingType }, day, roundNumber) {
  const oneUnitBudget = roundMoney(principal / splitCount);
  const quantity = floorShares(oneUnitBudget / day.close);
  if (quantity <= 0) throw new Error('Principal is too small to buy the first share');
  const amount = roundMoney(quantity * day.close);

  return {
    symbol,
    splitCount,
    principal,
    compoundingType,
    cashBalance: roundMoney(principal - amount),
    positionQty: quantity,
    avgPrice: day.close,
    tValue: 1,
    mode: 'normal',
    reverseFirstSellDone: false,
    roundNumber,
    roundStartedAt: day.date,
    costBasis: amount,
  };
}

function recordExecution(executions, day, order) {
  executions.push({
    date: day.date,
    side: order.side,
    orderType: order.orderType,
    label: order.label,
    price: roundPrice(order.price),
    quantity: order.quantity,
    amount: roundMoney(order.price * order.quantity),
    tEffect: order.tEffect,
  });
}

function buy(state, executions, day, label, price, budget, tEffect) {
  if (!canFillAtPrice(day, price)) return false;
  const spendable = Math.min(budget, state.cashBalance);
  const quantity = floorShares(spendable / price);
  if (quantity <= 0) return false;

  const amount = roundMoney(quantity * price);
  const previousQty = state.positionQty;
  const previousCost = state.avgPrice * previousQty;
  state.cashBalance = roundMoney(state.cashBalance - amount);
  state.positionQty += quantity;
  state.avgPrice = roundPrice((previousCost + amount) / state.positionQty);
  state.costBasis = roundMoney(state.costBasis + amount);
  state.tValue = applyTEffect(state.tValue, tEffect, state.splitCount);
  recordExecution(executions, day, { side: 'buy', orderType: 'LOC', label, price, quantity, tEffect });
  return true;
}

function sell(state, executions, day, label, orderType, price, quantity, tEffect) {
  const sellQty = Math.min(quantity, state.positionQty);
  if (sellQty <= 0) return false;
  if (orderType === 'LIMIT' && day.high < price) return false;
  if (orderType === 'LOC' && !canFillAtPrice(day, price)) return false;

  const amount = roundMoney(sellQty * price);
  state.cashBalance = roundMoney(state.cashBalance + amount);
  state.positionQty -= sellQty;
  state.tValue = applyTEffect(state.tValue, tEffect, state.splitCount);
  if (state.positionQty === 0) state.avgPrice = 0;
  recordExecution(executions, day, { side: 'sell', orderType, label, price, quantity: sellQty, tEffect });
  return true;
}

function completeRound(state, rounds, executions, day) {
  const roundExecutions = executions.filter((execution) => execution.roundNumber === state.roundNumber || execution.roundNumber === undefined);
  for (const execution of roundExecutions) execution.roundNumber = state.roundNumber;

  const profitAmount = roundMoney(state.cashBalance - state.principal);
  const profitRate = state.principal > 0 ? (profitAmount / state.principal) * 100 : 0;
  rounds.push({
    roundNumber: state.roundNumber,
    startedAt: state.roundStartedAt,
    endedAt: day.date,
    startedPrincipal: state.principal,
    endingCashBalance: state.cashBalance,
    profitAmount,
    profitRate,
    executionCount: roundExecutions.length,
  });

  const nextPrincipal = state.compoundingType === 'compound' ? state.cashBalance : state.principal;
  state.principal = nextPrincipal;
  state.cashBalance = roundMoney(state.cashBalance);
  state.positionQty = 0;
  state.avgPrice = 0;
  state.tValue = 0;
  state.mode = 'normal';
  state.reverseFirstSellDone = false;
  state.roundNumber += 1;
  state.roundStartedAt = null;
  state.costBasis = 0;
}

function startNextRoundIfNeeded(state, executions, day) {
  if (state.positionQty !== 0 || state.tValue !== 0) return;
  const oneUnitBudget = roundMoney(state.principal / state.splitCount);
  const spendable = Math.min(oneUnitBudget, state.cashBalance);
  const quantity = floorShares(spendable / day.close);
  if (quantity <= 0) return;

  const amount = roundMoney(quantity * day.close);
  state.cashBalance = roundMoney(state.cashBalance - amount);
  state.positionQty = quantity;
  state.avgPrice = day.close;
  state.tValue = 1;
  state.mode = 'normal';
  state.roundStartedAt = day.date;
  state.costBasis = amount;
  recordExecution(executions, day, { side: 'buy', orderType: 'MOC', label: '새 라운드 첫 매수', price: day.close, quantity, tEffect: 'buy_full' });
}

function processNormalDay(state, executions, rounds, day) {
  if (state.tValue > state.splitCount - 1) {
    state.mode = 'reverse';
    state.reverseFirstSellDone = false;
    return;
  }

  const starPercent = calculateStarPercent(state.symbol, state.splitCount, state.tValue);
  const avgPriceForPlan = state.avgPrice;
  const starPrice = roundPrice(avgPriceForPlan * (1 + starPercent));
  const buyPrice = roundPrice(starPrice - 0.01);
  const targetSellPrice = roundPrice(avgPriceForPlan * (state.symbol === 'TQQQ' ? 1.15 : 1.2));
  const oneUnitBudget = roundMoney(state.cashBalance / Math.max(state.splitCount - state.tValue, 1));

  sell(state, executions, day, '쿼터매도', 'LOC', starPrice, floorShares(state.positionQty / 4), 'quarter_sell');
  const finalQty = state.positionQty;
  const finalSold = sell(state, executions, day, '최종 지정가 매도', 'LIMIT', targetSellPrice, finalQty, 'none');
  if (finalSold && state.positionQty === 0) {
    completeRound(state, rounds, executions, day);
    return;
  }

  if (state.tValue < state.splitCount / 2) {
    const halfBudget = roundMoney(oneUnitBudget / 2);
    buy(state, executions, day, '전반전 별지점 매수', buyPrice, halfBudget, 'buy_half');
    buy(state, executions, day, '전반전 평단 매수', roundPrice(avgPriceForPlan), halfBudget, 'buy_half');
  } else {
    buy(state, executions, day, '후반전 별지점 매수', buyPrice, oneUnitBudget, 'buy_full');
  }
}

function processReverseDay(state, executions, day, previousCloses) {
  const sellQty = floorShares(state.positionQty / (state.splitCount === 20 ? 10 : 20));
  if (!state.reverseFirstSellDone) {
    sell(state, executions, day, '리버스모드 첫날 매도', 'MOC', day.close, sellQty, 'reverse_sell');
    state.reverseFirstSellDone = true;
    return;
  }

  const referencePrice = average(previousCloses.slice(-5));
  if (!referencePrice) return;

  if (day.close > referencePrice) {
    sell(state, executions, day, '리버스모드 매도', 'MOC', day.close, sellQty, 'reverse_sell');
  } else if (day.close < referencePrice) {
    const budget = roundMoney(state.cashBalance * 0.25);
    const quantity = floorShares(budget / day.close);
    if (quantity > 0) {
      const amount = roundMoney(quantity * day.close);
      const previousCost = state.avgPrice * state.positionQty;
      state.cashBalance = roundMoney(state.cashBalance - amount);
      state.positionQty += quantity;
      state.avgPrice = roundPrice((previousCost + amount) / state.positionQty);
      state.costBasis = roundMoney(state.costBasis + amount);
      state.tValue = applyTEffect(state.tValue, 'reverse_buy', state.splitCount);
      recordExecution(executions, day, { side: 'buy', orderType: 'MOC', label: '리버스모드 매수', price: day.close, quantity, tEffect: 'reverse_buy' });
    }
  }

  const returnLine = state.symbol === 'TQQQ' ? state.avgPrice * 0.85 : state.avgPrice * 0.8;
  if (day.close > returnLine) {
    state.mode = 'normal';
    state.reverseFirstSellDone = false;
  }
}

function calculateMdd(equityCurve) {
  let peak = equityCurve[0]?.equity ?? 0;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    const drawdown = peak > 0 ? ((point.equity - peak) / peak) * 100 : 0;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
  }
  return maxDrawdown;
}

function simulate(config, prices) {
  const executions = [];
  const rounds = [];
  const equityCurve = [];
  const state = createInitialState(config, prices[0], 1);
  recordExecution(executions, prices[0], { side: 'buy', orderType: 'MOC', label: '초기 첫 매수', price: prices[0].close, quantity: state.positionQty, tEffect: 'buy_full' });

  for (let index = 1; index < prices.length; index += 1) {
    const day = prices[index];
    const previousCloses = prices.slice(Math.max(0, index - 5), index).map((price) => price.close);

    startNextRoundIfNeeded(state, executions, day);
    if (state.positionQty > 0) {
      if (state.mode === 'normal') processNormalDay(state, executions, rounds, day);
      else processReverseDay(state, executions, day, previousCloses);
    }

    equityCurve.push({ date: day.date, equity: roundMoney(state.cashBalance + state.positionQty * day.close) });
  }

  const lastPrice = prices.at(-1);
  const endingEquity = roundMoney(state.cashBalance + state.positionQty * lastPrice.close);
  const profitAmount = roundMoney(endingEquity - config.principal);
  const profitRate = config.principal > 0 ? (profitAmount / config.principal) * 100 : 0;

  return {
    config,
    period: { start: prices[0].date, end: lastPrice.date, tradingDays: prices.length },
    summary: {
      endingEquity,
      profitAmount,
      profitRate,
      maxDrawdown: calculateMdd(equityCurve),
      completedRounds: rounds.length,
      executionCount: executions.length,
      openPositionQty: state.positionQty,
      cashBalance: state.cashBalance,
    },
    rounds,
    executions,
  };
}

function parseArgs(args) {
  if (args.includes('--help') || args.length < 5) {
    usage();
    process.exit(args.includes('--help') ? 0 : 1);
  }

  const [rawSymbol, rawSplitCount, rawPrincipal, rawStartDate, rawEndDate] = args;
  const symbol = rawSymbol.toUpperCase();
  const splitCount = Number(rawSplitCount);
  const principal = Number(rawPrincipal);
  const startDate = parseDate(rawStartDate, 'START_DATE');
  const endDate = parseDate(rawEndDate, 'END_DATE');
  const csvIndex = args.indexOf('--csv');

  if (!VALID_SYMBOLS.has(symbol)) throw new Error('Only TQQQ and SOXL are supported');
  if (!VALID_SPLITS.has(splitCount)) throw new Error('SPLIT_COUNT must be 20 or 40');
  if (!Number.isFinite(principal) || principal <= 0) throw new Error('PRINCIPAL must be a positive number');

  return {
    symbol,
    splitCount,
    principal,
    startDate,
    endDate,
    compoundingType: args.includes('--simple') ? 'simple' : 'compound',
    csvPath: csvIndex >= 0 && args[csvIndex + 1]
      ? path.resolve(args[csvIndex + 1])
      : path.join(__dirname, 'data', `${symbol}.csv`),
  };
}

function printResult(result) {
  console.log('\nBacktest Summary');
  console.log('================');
  console.log(`Symbol: ${result.config.symbol} ${result.config.splitCount} split (${result.config.compoundingType})`);
  console.log(`Period: ${result.period.start} ~ ${result.period.end} (${result.period.tradingDays} trading days)`);
  console.log(`Ending equity: ${money(result.summary.endingEquity)}`);
  console.log(`Profit: ${money(result.summary.profitAmount)} (${percent(result.summary.profitRate)})`);
  console.log(`MDD: ${percent(result.summary.maxDrawdown)}`);
  console.log(`Completed rounds: ${result.summary.completedRounds}`);
  console.log(`Executions: ${result.summary.executionCount}`);
  console.log(`Open position: ${result.summary.openPositionQty} shares, cash ${money(result.summary.cashBalance)}`);

  if (result.rounds.length > 0) {
    console.log('\nCompleted Rounds');
    console.table(result.rounds.map((round) => ({
      round: round.roundNumber,
      start: round.startedAt,
      end: round.endedAt,
      principal: money(round.startedPrincipal),
      endingCash: money(round.endingCashBalance),
      profit: money(round.profitAmount),
      return: percent(round.profitRate),
      executions: round.executionCount,
    })));
  }
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const prices = await loadPrices(config.csvPath, config.startDate, config.endDate);
  const result = simulate(config, prices);
  printResult(result);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
