'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Execution, SplitCount, Strategy, TEffect } from '@/lib/types';
import { toNumber, toStrategyState } from '@/lib/types';
import { applyTEffect } from '@/lib/trading';

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

export async function createStrategy(formData: FormData) {
  const supabase = supabaseOrThrow();
  const principal = numberValue(formData, 'principal');
  const cashBalance = numberValue(formData, 'cash_balance', principal);

  const { data, error } = await supabase
    .from('strategies')
    .insert({
      name: stringValue(formData, 'name', '새 전략'),
      symbol: stringValue(formData, 'symbol', 'TQQQ'),
      split_count: intValue(formData, 'split_count', 40),
      principal,
      cash_balance: cashBalance,
      position_qty: intValue(formData, 'position_qty'),
      avg_price: numberValue(formData, 'avg_price'),
      t_value: numberValue(formData, 't_value'),
      mode: stringValue(formData, 'mode', 'normal'),
      compounding_type: stringValue(formData, 'compounding_type', 'compound'),
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

  const { error } = await supabase
    .from('strategies')
    .update({
      name: stringValue(formData, 'name'),
      symbol: stringValue(formData, 'symbol'),
      split_count: intValue(formData, 'split_count') as SplitCount,
      principal: numberValue(formData, 'principal'),
      cash_balance: numberValue(formData, 'cash_balance'),
      position_qty: intValue(formData, 'position_qty'),
      avg_price: numberValue(formData, 'avg_price'),
      t_value: numberValue(formData, 't_value'),
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
  const finalT = stringValue(formData, 'final_t_value') ? numberValue(formData, 'final_t_value') : computedT;
  const finalMode = stringValue(formData, 'final_mode', state.mode);
  const finalCashBalance = numberValue(formData, 'final_cash_balance');
  const finalPositionQty = intValue(formData, 'final_position_qty');
  const finalAvgPrice = numberValue(formData, 'final_avg_price');
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

  const quantity = intValue(formData, 'quantity');
  const avgExecutionPrice = numberValue(formData, 'avg_execution_price');

  const { error: executionError } = await supabase.from('executions').insert({
    strategy_id: strategyId,
    executed_at: executedAt,
    side,
    order_type: stringValue(formData, 'order_type'),
    quantity,
    avg_execution_price: avgExecutionPrice,
    total_amount: quantity * avgExecutionPrice,
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
    const totalBuyAmount = buyExecutions.reduce((sum, execution) => sum + toNumber(execution.total_amount), 0);
    const totalSellAmount = sellExecutions.reduce((sum, execution) => sum + toNumber(execution.total_amount), 0);
    const startedPrincipal = state.principal;
    const profitAmount = finalCashBalance - startedPrincipal;
    const profitRate = startedPrincipal > 0 ? (profitAmount / startedPrincipal) * 100 : 0;

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
