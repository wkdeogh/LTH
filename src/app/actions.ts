'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Execution, SplitCount, Strategy, TEffect } from '@/lib/types';
import { toNumber, toStrategyState } from '@/lib/types';
import { applyTEffect, calculateRoundPerformance } from '@/lib/trading';
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
      symbol: stringValue(formData, 'symbol', 'TQQQ'),
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
  redirect(`/strategies/${data.id}`);
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

  const { error } = await supabase
    .from('strategies')
    .update({
      name: stringValue(formData, 'name'),
      symbol: stringValue(formData, 'symbol'),
      split_count: intValue(formData, 'split_count') as SplitCount,
      principal,
      cash_balance: cashBalance,
      position_qty: positionQty,
      avg_price: avgPrice,
      t_value: tValue,
      mode: stringValue(formData, 'mode'),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;

  revalidatePath('/');
  revalidatePath(`/strategies/${id}`);
  redirect(`/strategies/${id}`);
}

export async function deleteStrategy(formData: FormData) {
  const supabase = supabaseOrThrow();
  const id = stringValue(formData, 'id');

  const { error } = await supabase.from('strategies').update({ is_archived: true }).eq('id', id);
  if (error) throw error;

  revalidatePath('/');
  redirect('/');
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
}

export async function switchToReverse(formData: FormData) {
  const supabase = supabaseOrThrow();
  const id = stringValue(formData, 'id');

  const { error } = await supabase
    .from('strategies')
    .update({
      mode: 'reverse',
      reverse_started_at: new Date().toISOString().slice(0, 10),
      reverse_first_sell_done: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;

  revalidatePath(`/strategies/${id}`);
  redirect(`/strategies/${id}/plan`);
}

export async function switchToNormal(formData: FormData) {
  const supabase = supabaseOrThrow();
  const id = stringValue(formData, 'id');

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
  redirect(`/strategies/${id}/plan`);
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

export async function recordExecution(formData: FormData) {
  const supabase = supabaseOrThrow();
  const strategyId = stringValue(formData, 'strategy_id');
  const executedAt = stringValue(formData, 'executed_at', new Date().toISOString().slice(0, 10));
  const side = stringValue(formData, 'side');
  const { data: strategy, error: strategyError } = await supabase
    .from('strategies')
    .select('*')
    .eq('id', strategyId)
    .single<Strategy>();

  if (strategyError) throw strategyError;

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
  const finalMode = useFinalState ? stringValue(formData, 'final_mode', state.mode) : state.mode;
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

  await supabase.from('strategy_snapshots').insert({
    strategy_id: strategyId,
    snapshot_date: new Date().toISOString().slice(0, 10),
    mode: state.mode,
    cash_balance: state.cashBalance,
    position_qty: state.positionQty,
    avg_price: state.avgPrice,
    t_value: state.tValue,
    note: '체결 입력 전 상태',
  });

  const { error: executionError } = await supabase.from('executions').insert({
    strategy_id: strategyId,
    executed_at: executedAt,
    side,
    order_type: stringValue(formData, 'order_type'),
    quantity,
    avg_execution_price: avgExecutionPrice,
    total_amount: totalAmount,
    t_effect: effect,
    memo: stringValue(formData, 'memo') || null,
  });

  if (executionError) throw executionError;

  if (isCompletedRound) {
    const roundStartedAt = strategy.started_at ?? executedAt;
    const { data: activeExecutions, error: activeExecutionsError } = await supabase
      .from('executions')
      .select('*')
      .eq('strategy_id', strategyId)
      .is('round_id', null)
      .gte('executed_at', roundStartedAt)
      .lte('executed_at', executedAt)
      .returns<Execution[]>();

    if (activeExecutionsError) throw activeExecutionsError;

    const executions = activeExecutions ?? [];
    const buyExecutions = executions.filter((execution) => execution.side === 'buy');
    const sellExecutions = executions.filter((execution) => execution.side === 'sell');
    const totalBuyAmount = roundMoney(buyExecutions.reduce((sum, execution) => sum + toNumber(execution.total_amount), 0));
    const totalSellAmount = roundMoney(sellExecutions.reduce((sum, execution) => sum + toNumber(execution.total_amount), 0));
    const startedPrincipal = state.principal;
    const { profitAmount, profitRate } = calculateRoundPerformance(startedPrincipal, finalCashBalance);

    const { data: lastRound, error: lastRoundError } = await supabase
      .from('completed_rounds')
      .select('round_number')
      .eq('strategy_id', strategyId)
      .order('round_number', { ascending: false })
      .limit(1)
      .maybeSingle<{ round_number: number }>();

    if (lastRoundError) throw lastRoundError;

    const { data: completedRound, error: completedRoundError } = await supabase
      .from('completed_rounds')
      .insert({
        strategy_id: strategyId,
        round_number: (lastRound?.round_number ?? 0) + 1,
        symbol: state.symbol,
        split_count: state.splitCount,
        started_at: roundStartedAt,
        ended_at: executedAt,
        started_principal: startedPrincipal,
        ending_cash_balance: finalCashBalance,
        profit_amount: profitAmount,
        profit_rate: profitRate,
        execution_count: executions.length,
        buy_count: buyExecutions.length,
        sell_count: sellExecutions.length,
        total_buy_amount: totalBuyAmount,
        total_sell_amount: totalSellAmount,
        ending_t_value: finalT,
      })
      .select('id')
      .single<{ id: string }>();

    if (completedRoundError) throw completedRoundError;

    const executionIds = executions.map((execution) => execution.id);
    if (executionIds.length > 0) {
      const { error: roundLinkError } = await supabase
        .from('executions')
        .update({ round_id: completedRound.id })
        .in('id', executionIds);

      if (roundLinkError) throw roundLinkError;
    }
  }

  const reverseFirstSellDone =
    state.mode === 'reverse' && effect === 'reverse_sell' ? true : state.reverseFirstSellDone;

  const nextPrincipal = isCompletedRound && strategy.compounding_type === 'compound' ? finalCashBalance : state.principal;

  const { error: updateError } = await supabase
    .from('strategies')
    .update({
      principal: nextPrincipal,
      cash_balance: finalCashBalance,
      position_qty: isCompletedRound ? 0 : finalPositionQty,
      avg_price: isCompletedRound ? 0 : finalAvgPrice,
      t_value: isCompletedRound ? 0 : finalT,
      mode: isCompletedRound ? 'normal' : finalMode,
      reverse_first_sell_done: isCompletedRound ? false : finalMode === 'reverse' ? reverseFirstSellDone : false,
      reverse_started_at: isCompletedRound ? null : finalMode === 'reverse' ? state.reverseStartedAt ?? new Date().toISOString().slice(0, 10) : null,
      started_at: isCompletedRound ? executedAt : strategy.started_at,
      updated_at: new Date().toISOString(),
    })
    .eq('id', strategyId);

  if (updateError) throw updateError;

  revalidatePath('/');
  revalidatePath(`/strategies/${strategyId}`);
  revalidatePath(`/strategies/${strategyId}/rounds`);
  redirect(`/strategies/${strategyId}`);
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
  redirect(internalReturnPath(formData));
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
  redirect(internalReturnPath(formData));
}
