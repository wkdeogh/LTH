'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { after } from 'next/server';
import { syncMarketData } from '@/lib/marketData/candles';
import { withNotice } from '@/lib/notices';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { koreaDate, executionDateError } from '@/lib/date';
import { loadStrategyReferences } from '@/lib/marketData/references';
import { mutationErrorMessage, type MutationFeedback } from '@/lib/mutationFeedback';
import type { NoticeKey } from '@/lib/notices';
import type { Execution, SplitCount, Strategy, SymbolCode, TEffect, TradeMode } from '@/lib/types';
import { toNumber, toStrategyState } from '@/lib/types';
import {
  applyTEffect,
  calculatePairedExecutionState,
  calculateRoundPerformance,
  shouldAutoEnterReverseMode,
  shouldAutoReturnToNormalMode,
} from '@/lib/trading';
import { roundMoney } from '@/lib/trading/rounding';

function supabaseOrThrow() {
  const supabase = createSupabaseServerClient();
  if (!supabase) throw new Error('Supabase environment variables are missing.');
  return supabase;
}

function stringValue(formData: FormData, key: string, fallback = '') {
  const value = formData.get(key);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function numberValue(formData: FormData, key: string, fallback = 0) {
  const value = stringValue(formData, key);
  if (!value) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function intValue(formData: FormData, key: string, fallback = 0) {
  return Math.trunc(numberValue(formData, key, fallback));
}

function symbolValue(value: string): SymbolCode {
  if (value !== 'TQQQ' && value !== 'SOXL') {
    throw new Error('지원하는 종목은 TQQQ와 SOXL입니다.');
  }
  return value;
}

function internalReturnPath(formData: FormData) {
  const path = stringValue(formData, 'return_to', '/rounds');
  return path.startsWith('/') && !path.startsWith('//') ? path : '/rounds';
}

export async function createStrategy(formData: FormData) {
  const supabase = supabaseOrThrow();
  const principal = numberValue(formData, 'principal');
  const cashBalance = numberValue(formData, 'cash_balance', principal);
  const positionQty = intValue(formData, 'position_qty');
  const avgPrice = numberValue(formData, 'avg_price');
  const tValue = numberValue(formData, 't_value');

  if (principal <= 0) throw new Error('원금은 0보다 커야 합니다.');
  if (cashBalance < 0 || positionQty < 0 || avgPrice < 0 || tValue < 0) {
    throw new Error('현금, 보유수량, 평단, T값은 음수일 수 없습니다.');
  }
  if (positionQty > 0 && avgPrice <= 0) throw new Error('보유수량이 있으면 평단을 입력해야 합니다.');

  const { data: lastStrategy, error: sortError } = await supabase
    .from('strategies')
    .select('sort_order')
    .eq('is_archived', false)
    .order('sort_order', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();

  if (sortError) throw sortError;

  const { data, error } = await supabase
    .from('strategies')
    .insert({
      name: stringValue(formData, 'name', '새 전략'),
      symbol: symbolValue(stringValue(formData, 'symbol', 'TQQQ')),
      split_count: intValue(formData, 'split_count', 40),
      principal,
      cash_balance: cashBalance,
      position_qty: positionQty,
      avg_price: avgPrice,
      t_value: tValue,
      mode: stringValue(formData, 'mode', 'normal'),
      compounding_type: stringValue(formData, 'compounding_type', 'compound'),
      sort_order: (lastStrategy?.sort_order ?? -1) + 1,
    })
    .select('id')
    .single();

  if (error) throw error;

  revalidatePath('/');
  redirect(withNotice(`/strategies/${data.id}`, 'strategy-created'));
}

export async function updateStrategy(formData: FormData) {
  const supabase = supabaseOrThrow();
  const id = stringValue(formData, 'id');
  const principal = numberValue(formData, 'principal');
  const cashBalance = numberValue(formData, 'cash_balance');
  const positionQty = intValue(formData, 'position_qty');
  const avgPrice = numberValue(formData, 'avg_price');
  const tValue = numberValue(formData, 't_value');

  if (principal <= 0) throw new Error('원금은 0보다 커야 합니다.');
  if (cashBalance < 0 || positionQty < 0 || avgPrice < 0 || tValue < 0) {
    throw new Error('현금, 보유수량, 평단, T값은 음수일 수 없습니다.');
  }
  if (positionQty > 0 && avgPrice <= 0) throw new Error('보유수량이 있으면 평단을 입력해야 합니다.');

  const { error } = await supabase.rpc('correct_strategy_state', {
    p_strategy_id: id,
    p_expected_version: stringValue(formData, 'expected_version'),
    p_date: stringValue(formData, 'effective_date'),
    p_reason: stringValue(formData, 'reason'),
    p_state: {
      name: stringValue(formData, 'name'), symbol: symbolValue(stringValue(formData, 'symbol')),
      split_count: intValue(formData, 'split_count') as SplitCount,
      principal, cash_balance: cashBalance, position_qty: positionQty, avg_price: avgPrice, t_value: tValue,
      mode: stringValue(formData, 'mode'),
    },
  });
  if (error) throw error;

  revalidatePath('/');
  revalidatePath(`/strategies/${id}`);
  revalidatePath(`/strategies/${id}/rounds`);
  revalidatePath(`/strategies/${id}/plan`);
  redirect(withNotice(`/strategies/${id}`, 'strategy-updated'));
}

export async function setMainStrategy(formData: FormData) {
  const supabase = supabaseOrThrow();
  const id = stringValue(formData, 'id');
  const { error } = await supabase.rpc('set_main_strategy', { target_id: id });
  if (error?.message === 'STRATEGY_NOT_ACTIVE') {
    redirect(withNotice('/', 'main-strategy-unavailable'));
  }
  if (error) throw error;

  revalidatePath('/', 'layout');
  redirect(withNotice('/', 'main-strategy-updated'));
}

export async function deleteStrategy(formData: FormData) {
  const supabase = supabaseOrThrow();
  const id = stringValue(formData, 'id');

  const { data, error } = await supabase.from('strategies')
    .update({ is_archived: true })
    .eq('id', id)
    .eq('is_main', false)
    .eq('is_archived', false)
    .select('id');
  if (error?.message === 'MAIN_STRATEGY_PROTECTED' || (!error && !data?.length)) {
    redirect(withNotice(`/strategies/${id}`, 'main-strategy-protected'));
  }
  if (error) throw error;

  revalidatePath('/');
  redirect(withNotice('/', 'strategy-deleted'));
}

export async function addDailyPrice(formData: FormData) {
  const supabase = supabaseOrThrow();
  const strategyId = stringValue(formData, 'strategy_id');
  const tradeDate = stringValue(formData, 'trade_date', new Date().toISOString().slice(0, 10));
  const closePrice = numberValue(formData, 'close_price');

  if (closePrice <= 0) throw new Error('종가는 0보다 커야 합니다.');

  const { error } = await supabase.from('daily_prices').upsert({
    strategy_id: strategyId,
    trade_date: tradeDate,
    close_price: closePrice,
  });

  if (error) throw error;

  revalidatePath(`/strategies/${strategyId}`);
  revalidatePath(`/strategies/${strategyId}/plan`);
  redirect(withNotice(`/strategies/${strategyId}`, 'price-saved'));
}

export async function refreshMarketChart(formData: FormData) {
  const supabase = supabaseOrThrow();
  const strategyId = stringValue(formData, 'strategy_id');
  if (!strategyId) throw new Error('차트를 갱신할 전략을 찾을 수 없습니다.');

  const { data: strategy, error } = await supabase
    .from('strategies')
    .select('symbol')
    .eq('id', strategyId)
    .single<{ symbol: string }>();
  if (error) throw error;

  await syncMarketData(symbolValue(strategy.symbol));
  revalidatePath(`/strategies/${strategyId}`);
  redirect(withNotice(`/strategies/${strategyId}#market-chart`, 'chart-refreshed'));
}

export async function switchToReverse(formData: FormData) {
  const supabase = supabaseOrThrow();
  const id = stringValue(formData, 'id');
  const automatic = stringValue(formData, 'automatic') === '1';

  const { error } = await supabase
    .from('strategies')
    .update({
      mode: 'reverse',
      reverse_started_at: koreaDate(),
      reverse_first_sell_done: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;

  revalidatePath(`/strategies/${id}`);
  redirect(withNotice(`/strategies/${id}/plan`, automatic ? 'reverse-auto-started' : 'reverse-started'));
}

export async function switchToNormal(formData: FormData) {
  const supabase = supabaseOrThrow();
  const id = stringValue(formData, 'id');
  const automatic = stringValue(formData, 'automatic') === '1';

  const { error } = await supabase
    .from('strategies')
    .update({
      mode: 'normal',
      reverse_started_at: null,
      reverse_first_sell_done: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;

  revalidatePath(`/strategies/${id}`);
  redirect(withNotice(`/strategies/${id}/plan`, automatic ? 'normal-auto-restored' : 'normal-restored'));
}

export async function saveTradePlan(formData: FormData) {
  const supabase = supabaseOrThrow();
  const strategyId = stringValue(formData, 'strategy_id');
  const guidance = JSON.parse(stringValue(formData, 'guidance', '{}'));

  const { error } = await supabase.from('trade_plans').upsert({
    strategy_id: strategyId,
    plan_date: stringValue(formData, 'plan_date', new Date().toISOString().slice(0, 10)),
    mode: stringValue(formData, 'mode'),
    phase: stringValue(formData, 'phase') || null,
    t_value: numberValue(formData, 't_value'),
    avg_price: numberValue(formData, 'avg_price'),
    cash_balance: numberValue(formData, 'cash_balance'),
    position_qty: intValue(formData, 'position_qty'),
    star_percent: stringValue(formData, 'star_percent') ? numberValue(formData, 'star_percent') : null,
    star_price: stringValue(formData, 'star_price') ? numberValue(formData, 'star_price') : null,
    one_unit_budget: stringValue(formData, 'one_unit_budget') ? numberValue(formData, 'one_unit_budget') : null,
    reverse_reference_price: stringValue(formData, 'reverse_reference_price') ? numberValue(formData, 'reverse_reference_price') : null,
    guidance,
  });

  if (error) throw error;

  revalidatePath(`/strategies/${strategyId}`);
  revalidatePath(`/strategies/${strategyId}/plan`);
}

async function prepareExecution(formData: FormData) {
  const supabase = supabaseOrThrow();
  const strategyId = stringValue(formData, 'strategy_id');
  const requestId = stringValue(formData, 'request_id');
  const expectedVersion = stringValue(formData, 'expected_version');
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !/^\d+$/.test(expectedVersion)) throw new Error('화면을 새로고침한 후 다시 입력해 주세요.');
  const input = Object.fromEntries([...formData.entries()].filter(([key]) => !key.startsWith('$ACTION_')).sort(([a], [b]) => a.localeCompare(b)));
  const { data: saved, error: savedError } = await supabase.from('strategy_write_requests').select('strategy_id,input,result,cancelled').eq('id', requestId).maybeSingle();
  if (savedError) throw savedError;
  if (saved) {
    if (saved.cancelled) throw new Error('REQUEST_CANCELLED');
    const normalized = Object.fromEntries(Object.entries(saved.input).sort(([a], [b]) => a.localeCompare(b)));
    if (saved.strategy_id !== strategyId || JSON.stringify(normalized) !== JSON.stringify(input)) throw new Error('REQUEST_CONFLICT');
    redirect(withNotice(saved.result.path, saved.result.notice));
  }
  const executedAt = stringValue(formData, 'executed_at');
  const [lastExecution, lastCorrection] = await Promise.all([
    supabase.from('executions').select('executed_at').eq('strategy_id', strategyId).order('executed_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('strategy_adjustments').select('effective_date').eq('strategy_id', strategyId).eq('kind', 'correction').order('effective_date', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (lastExecution.error) throw lastExecution.error;
  if (lastCorrection.error) throw lastCorrection.error;
  const earliest = [lastExecution.data?.executed_at, lastCorrection.data?.effective_date].filter(Boolean).sort().at(-1) ?? null;
  const dateError = executionDateError(executedAt, earliest);
  if (dateError) throw new Error(dateError);
  return { supabase, strategyId, requestId, expectedVersion, input, executedAt };
}

async function commitExecution(context: Awaited<ReturnType<typeof prepareExecution>>, executions: unknown[], snapshots: unknown[], finalState: unknown, round: unknown, result: { path: string; notice: NoticeKey }) {
  const { error } = await context.supabase.rpc('commit_strategy_execution', {
    p_strategy_id: context.strategyId, p_request_id: context.requestId, p_expected_version: context.expectedVersion,
    p_input: context.input, p_executions: executions, p_snapshots: snapshots, p_final: finalState, p_round: round, p_result: result,
  });
  if (error) throw error;
}

export async function submitExecution(_previous: MutationFeedback, formData: FormData): Promise<MutationFeedback> {
  try { await recordExecution(formData); return { error: null }; }
  catch (error) { unstable_rethrow(error); return { error: mutationErrorMessage(error) }; }
}

export async function submitPairedExecution(_previous: MutationFeedback, formData: FormData): Promise<MutationFeedback> {
  try { await recordPairedExecution(formData); return { error: null }; }
  catch (error) { unstable_rethrow(error); return { error: mutationErrorMessage(error) }; }
}

export async function submitStrategyCorrection(_previous: MutationFeedback, formData: FormData): Promise<MutationFeedback> {
  try { await updateStrategy(formData); return { error: null }; }
  catch (error) { unstable_rethrow(error); return { error: mutationErrorMessage(error) }; }
}

export async function recordExecution(formData: FormData) {
  const context = await prepareExecution(formData);
  const { supabase, strategyId, executedAt } = context;
  const side = stringValue(formData, 'side');
  if (side !== 'buy' && side !== 'sell') throw new Error('매수·매도 구분을 확인해 주세요.');
  const { data: strategy, error: strategyError } = await supabase
    .from('strategies')
    .select('*')
    .eq('id', strategyId)
    .eq('is_archived', false)
    .single<Strategy>();

  if (strategyError) throw strategyError;

  if (String(strategy.version) !== context.expectedVersion) throw new Error('STALE_STRATEGY');
  const state = toStrategyState(strategy);
  const effect = stringValue(formData, 't_effect', 'none') as TEffect;
  const computedT = applyTEffect(state.tValue, effect, state.splitCount);
  const quantity = intValue(formData, 'quantity');
  const avgExecutionPrice = numberValue(formData, 'avg_execution_price');

  if (quantity <= 0) throw new Error('체결 수량은 1주 이상이어야 합니다.');
  if (avgExecutionPrice <= 0) throw new Error('평균 체결가는 0보다 커야 합니다.');
  if (side === 'sell' && quantity > state.positionQty) {
    throw new Error(`매도 수량(${quantity}주)이 현재 보유수량(${state.positionQty}주)을 초과합니다.`);
  }

  const totalAmount = roundMoney(quantity * avgExecutionPrice);
  if (side === 'buy' && totalAmount > state.cashBalance) {
    throw new Error(`매수금액(${totalAmount})이 현재 현금(${state.cashBalance})을 초과합니다.`);
  }
  const autoCashBalance = side === 'buy'
    ? roundMoney(state.cashBalance - totalAmount)
    : roundMoney(state.cashBalance + totalAmount);
  const autoPositionQty = side === 'buy'
    ? state.positionQty + quantity
    : Math.max(state.positionQty - quantity, 0);
  const autoAvgPrice = side === 'buy' && autoPositionQty > 0
    ? roundMoney((state.avgPrice * state.positionQty + totalAmount) / autoPositionQty)
    : autoPositionQty > 0
      ? state.avgPrice
      : 0;
  const useFinalState = formData.get('use_final_state') === 'on';
  const finalT = useFinalState && stringValue(formData, 'final_t_value') ? numberValue(formData, 'final_t_value') : computedT;
  const requestedFinalMode = (useFinalState ? stringValue(formData, 'final_mode', state.mode) : state.mode) as TradeMode;
  const finalCashBalance = autoCashBalance;
  const finalPositionQty = useFinalState && stringValue(formData, 'final_position_qty')
    ? intValue(formData, 'final_position_qty')
    : autoPositionQty;
  const finalAvgPrice = useFinalState && stringValue(formData, 'final_avg_price')
    ? numberValue(formData, 'final_avg_price')
    : autoAvgPrice;

  if (finalPositionQty < 0 || finalAvgPrice < 0 || finalT < 0) {
    throw new Error('체결 후 보유수량, 평단, T값은 음수일 수 없습니다.');
  }
  if (finalPositionQty > 0 && finalAvgPrice <= 0) {
    throw new Error('체결 후 보유수량이 있으면 평단은 0보다 커야 합니다.');
  }

  const isCompletedRound = side === 'sell' && state.positionQty > 0 && finalPositionQty === 0;
  const reverseFirstSellDone =
    state.mode === 'reverse' && effect === 'reverse_sell' ? true : state.reverseFirstSellDone;
  let latestClose: number | undefined;
  if (!isCompletedRound && state.mode === 'reverse') {
    const references = await loadStrategyReferences(supabase, strategyId, state.symbol);
    latestClose = references[0]?.price;
  }

  const autoReturnedToNormal = !isCompletedRound
    && requestedFinalMode === 'reverse'
    && shouldAutoReturnToNormalMode({
      mode: state.mode,
      symbol: state.symbol,
      avgPrice: finalAvgPrice,
    }, latestClose);
  const autoEnteredReverse = !isCompletedRound && shouldAutoEnterReverseMode({
    currentMode: state.mode,
    requestedMode: requestedFinalMode,
    nextTValue: finalT,
    splitCount: state.splitCount,
  });
  const finalMode: TradeMode = isCompletedRound
    ? 'normal'
    : autoReturnedToNormal
      ? 'normal'
      : autoEnteredReverse
        ? 'reverse'
        : requestedFinalMode;

  const nextPrincipal = isCompletedRound && strategy.compounding_type === 'compound' ? finalCashBalance : state.principal;

  const redirectPath = autoEnteredReverse || autoReturnedToNormal ? `/strategies/${strategyId}/plan` : `/strategies/${strategyId}`;
  const notice: NoticeKey = isCompletedRound ? 'round-completed' : autoReturnedToNormal ? 'normal-auto-restored' : autoEnteredReverse ? 'reverse-auto-started' : 'execution-saved';
  const roundPerformance = isCompletedRound ? calculateRoundPerformance(state.principal, finalCashBalance) : null;
  await commitExecution(context, [{
    id: crypto.randomUUID(), executed_at: executedAt, side, order_type: stringValue(formData, 'order_type'),
    quantity, avg_execution_price: avgExecutionPrice, total_amount: totalAmount, t_effect: effect, memo: stringValue(formData, 'memo') || null,
  }], [{
    cash_balance: state.cashBalance, position_qty: state.positionQty, avg_price: state.avgPrice, t_value: state.tValue,
    after_cash_balance: finalCashBalance, after_position_qty: finalPositionQty,
  }], {
    principal: nextPrincipal, cash_balance: finalCashBalance, position_qty: isCompletedRound ? 0 : finalPositionQty,
    avg_price: isCompletedRound ? 0 : finalAvgPrice, t_value: isCompletedRound ? 0 : finalT, mode: finalMode,
    reverse_first_sell_done: isCompletedRound ? false : finalMode === 'reverse' ? reverseFirstSellDone : false,
    reverse_started_at: isCompletedRound ? null : finalMode === 'reverse' ? state.reverseStartedAt ?? executedAt : null,
    started_at: isCompletedRound ? executedAt : strategy.started_at,
  }, roundPerformance ? { profit_amount: roundPerformance.profitAmount, profit_rate: roundPerformance.profitRate, ending_t_value: finalT } : null,
  { path: redirectPath, notice });

  after(async () => {
    try {
      await syncMarketData(state.symbol);
      revalidatePath(`/strategies/${strategyId}`);
    } catch (error) {
      console.error(`${state.symbol} OHLC 백그라운드 갱신 실패`, error);
    }
  });

  revalidatePath('/');
  revalidatePath(`/strategies/${strategyId}`);
  revalidatePath(`/strategies/${strategyId}/plan`);
  revalidatePath(`/strategies/${strategyId}/rounds`);
  redirect(withNotice(redirectPath, notice));
}

export async function recordPairedExecution(formData: FormData) {
  const context = await prepareExecution(formData);
  const { supabase, strategyId, executedAt } = context;
  const { data: strategy, error: strategyError } = await supabase
    .from('strategies')
    .select('*')
    .eq('id', strategyId)
    .eq('is_archived', false)
    .single<Strategy>();

  if (strategyError) throw strategyError;

  if (String(strategy.version) !== context.expectedVersion) throw new Error('STALE_STRATEGY');
  const state = toStrategyState(strategy);
  if (state.mode !== 'normal') {
    throw new Error('지정가매도 후 LOC 매수는 일반모드에서만 입력할 수 있습니다.');
  }

  const effect = stringValue(formData, 't_effect') as TEffect;
  if (effect !== 'limit_sell_then_full_buy' && effect !== 'limit_sell_then_half_buy') {
    throw new Error('지정가매도 후 LOC 매수의 T 반영 방식을 확인해 주세요.');
  }

  const sellQuantity = intValue(formData, 'sell_quantity');
  const sellPrice = numberValue(formData, 'sell_avg_execution_price');
  const buyQuantity = intValue(formData, 'buy_quantity');
  const buyPrice = numberValue(formData, 'buy_avg_execution_price');

  if (sellQuantity <= 0 || buyQuantity <= 0) {
    throw new Error('매도·매수 체결 수량은 각각 1주 이상이어야 합니다.');
  }
  if (sellPrice <= 0 || buyPrice <= 0) {
    throw new Error('매도·매수 평균 체결가는 각각 0보다 커야 합니다.');
  }
  if (sellQuantity > state.positionQty) {
    throw new Error(`매도 수량(${sellQuantity}주)이 현재 보유수량(${state.positionQty}주)을 초과합니다.`);
  }

  const pairedState = calculatePairedExecutionState({
    state,
    sellQuantity,
    sellPrice,
    buyQuantity,
    buyPrice,
    effect,
  });

  if (pairedState.buyAmount > pairedState.cashAfterSell) {
    throw new Error(`매수금액(${pairedState.buyAmount})이 매도대금 반영 후 현금(${pairedState.cashAfterSell})을 초과합니다.`);
  }

  const autoEnteredReverse = shouldAutoEnterReverseMode({
    currentMode: state.mode,
    requestedMode: state.mode,
    nextTValue: pairedState.finalT,
    splitCount: state.splitCount,
  });
  const finalMode: TradeMode = autoEnteredReverse ? 'reverse' : state.mode;
  const memo = stringValue(formData, 'memo') || null;
  await commitExecution(context, [
    { id: crypto.randomUUID(), executed_at: executedAt, side: 'sell', order_type: 'LIMIT', quantity: sellQuantity, avg_execution_price: sellPrice, total_amount: pairedState.sellAmount, t_effect: 'none', memo },
    { id: crypto.randomUUID(), executed_at: executedAt, side: 'buy', order_type: 'LOC', quantity: buyQuantity, avg_execution_price: buyPrice, total_amount: pairedState.buyAmount, t_effect: effect, memo },
  ], [
    { cash_balance: state.cashBalance, position_qty: state.positionQty, avg_price: state.avgPrice, t_value: state.tValue, after_cash_balance: pairedState.cashAfterSell, after_position_qty: pairedState.positionAfterSell },
    { cash_balance: pairedState.cashAfterSell, position_qty: pairedState.positionAfterSell, avg_price: pairedState.positionAfterSell > 0 ? state.avgPrice : 0, t_value: state.tValue, after_cash_balance: pairedState.finalCashBalance, after_position_qty: pairedState.finalPositionQty },
  ], {
    principal: state.principal, cash_balance: pairedState.finalCashBalance, position_qty: pairedState.finalPositionQty,
    avg_price: pairedState.finalAvgPrice, t_value: pairedState.finalT, mode: finalMode,
    reverse_first_sell_done: false, reverse_started_at: finalMode === 'reverse' ? state.reverseStartedAt ?? executedAt : null,
    started_at: strategy.started_at,
  }, null, { path: autoEnteredReverse ? `/strategies/${strategyId}/plan` : `/strategies/${strategyId}`, notice: autoEnteredReverse ? 'reverse-auto-started' : 'paired-execution-saved' });

  after(async () => {
    try {
      await syncMarketData(state.symbol);
      revalidatePath(`/strategies/${strategyId}`);
    } catch (error) {
      console.error(`${state.symbol} OHLC 백그라운드 갱신 실패`, error);
    }
  });

  revalidatePath('/');
  revalidatePath(`/strategies/${strategyId}`);
  revalidatePath(`/strategies/${strategyId}/plan`);
  revalidatePath(`/strategies/${strategyId}/rounds`);
  redirect(withNotice(
    autoEnteredReverse ? `/strategies/${strategyId}/plan` : `/strategies/${strategyId}`,
    autoEnteredReverse ? 'reverse-auto-started' : 'paired-execution-saved',
  ));
}

export async function cancelLatestExecution(formData: FormData) {
  const supabase = supabaseOrThrow();
  const strategyId = stringValue(formData, 'strategy_id');
  const executionId = stringValue(formData, 'execution_id');
  if (!strategyId || !executionId) throw new Error('취소할 체결을 찾을 수 없습니다.');

  const { error } = await supabase.rpc('cancel_latest_execution', {
    p_strategy_id: strategyId,
    p_execution_id: executionId,
  });
  if (error) throw new Error(`체결 취소 실패: ${error.message}`);

  revalidatePath('/');
  revalidatePath('/rounds');
  revalidatePath(`/strategies/${strategyId}`);
  revalidatePath(`/strategies/${strategyId}/plan`);
  revalidatePath(`/strategies/${strategyId}/executions/new`);
  revalidatePath(`/strategies/${strategyId}/rounds`);
  redirect(withNotice(`/strategies/${strategyId}/executions/new`, 'execution-cancelled'));
}

export async function updateCompletedRound(formData: FormData) {
  const supabase = supabaseOrThrow();
  const id = stringValue(formData, 'id');
  const strategyId = stringValue(formData, 'strategy_id');
  const startedAt = stringValue(formData, 'started_at');
  const endedAt = stringValue(formData, 'ended_at');
  const startedPrincipal = numberValue(formData, 'started_principal');
  const endingCashBalance = numberValue(formData, 'ending_cash_balance');
  const totalBuyAmount = numberValue(formData, 'total_buy_amount');
  const totalSellAmount = numberValue(formData, 'total_sell_amount');
  const endingTValue = numberValue(formData, 'ending_t_value');

  if (!id || !strategyId) throw new Error('수정할 완료 기록을 찾을 수 없습니다.');
  if (!startedAt || !endedAt || startedAt > endedAt) {
    throw new Error('종료일은 시작일과 같거나 이후여야 합니다.');
  }
  if (totalBuyAmount < 0 || totalSellAmount < 0 || endingTValue < 0) {
    throw new Error('매수·매도 합계와 종료 T값은 음수일 수 없습니다.');
  }

  const { profitAmount, profitRate } = calculateRoundPerformance(startedPrincipal, endingCashBalance);
  const { error } = await supabase
    .from('completed_rounds')
    .update({
      started_at: startedAt,
      ended_at: endedAt,
      started_principal: roundMoney(startedPrincipal),
      ending_cash_balance: roundMoney(endingCashBalance),
      profit_amount: profitAmount,
      profit_rate: profitRate,
      total_buy_amount: roundMoney(totalBuyAmount),
      total_sell_amount: roundMoney(totalSellAmount),
      ending_t_value: endingTValue,
    })
    .eq('id', id)
    .eq('strategy_id', strategyId);

  if (error) throw error;

  revalidatePath('/');
  revalidatePath('/rounds');
  revalidatePath(`/strategies/${strategyId}/rounds`);
  redirect(withNotice(internalReturnPath(formData), 'round-updated'));
}

export async function deleteCompletedRound(formData: FormData) {
  const supabase = supabaseOrThrow();
  const id = stringValue(formData, 'id');
  const strategyId = stringValue(formData, 'strategy_id');

  if (!id || !strategyId) throw new Error('삭제할 완료 기록을 찾을 수 없습니다.');

  const { error: executionError } = await supabase
    .from('executions')
    .delete()
    .eq('round_id', id)
    .eq('strategy_id', strategyId);

  if (executionError) throw executionError;

  const { error: roundError } = await supabase
    .from('completed_rounds')
    .delete()
    .eq('id', id)
    .eq('strategy_id', strategyId);

  if (roundError) throw roundError;

  revalidatePath('/');
  revalidatePath('/rounds');
  revalidatePath(`/strategies/${strategyId}/rounds`);
  redirect(withNotice(internalReturnPath(formData), 'round-deleted'));
}
