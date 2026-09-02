import { notFound } from 'next/navigation';
import { cancelLatestExecution } from '@/app/actions';
import { ExecutionEntryForm } from '@/components/ExecutionEntryForm';
import { compact, usd } from '@/components/Format';
import { SetupNotice } from '@/components/SetupNotice';
import { StrategyTabs } from '@/components/StrategyTabs';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { koreaDate } from '@/lib/date';
import type { Execution, MarketCandle, Strategy } from '@/lib/types';
import { toNumber, toStrategyState } from '@/lib/types';
import {
  calculateNormalPlan,
  calculateReversePlan,
  inferExecutionDefaultsFromClose,
  modeLabel,
} from '@/lib/trading';

export default async function NewExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const { id } = await params;
  const supabase = createSupabaseServerClient();
  const { data: strategy } = await supabase!.from('strategies').select('*').eq('id', id).single<Strategy>();
  if (!strategy) notFound();

  const [latestExecutionResult, recentCandlesResult] = await Promise.all([
    supabase!
      .from('executions')
      .select('*')
      .eq('strategy_id', id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle<Execution>(),
    supabase!
      .from('market_candles')
      .select('*')
      .eq('symbol', strategy.symbol)
      .order('trade_date', { ascending: false })
      .limit(5)
      .returns<MarketCandle[]>(),
  ]);
  const latestExecution = latestExecutionResult.data;
  const recentCandles = recentCandlesResult.data ?? [];
  const latestCandle = recentCandles[0];

  const state = toStrategyState(strategy);
  const latestClose = latestCandle ? toNumber(latestCandle.close_price) : undefined;
  const recentCloses = recentCandles.map((candle) => toNumber(candle.close_price));
  const plan = state.mode === 'normal'
    ? calculateNormalPlan(state, latestClose)
    : calculateReversePlan(state, recentCloses, latestClose);
  const executionDefaults = inferExecutionDefaultsFromClose(plan, latestClose);
  const pairedFinalSell = plan.kind === 'normal'
    ? plan.sellOrders.find((order) => order.orderType === 'LIMIT')
    : undefined;
  const pairedDefaults = state.mode === 'normal' && state.positionQty > 0 && pairedFinalSell
    ? {
        sellQuantity: pairedFinalSell.quantity,
        sellPrice: pairedFinalSell.price ?? undefined,
        buyQuantity: executionDefaults?.side === 'buy' ? executionDefaults.quantity : undefined,
        buyPrice: latestClose,
        tEffect: executionDefaults?.tEffect === 'buy_half'
          ? 'limit_sell_then_half_buy' as const
          : 'limit_sell_then_full_buy' as const,
      }
    : undefined;

  return (
    <div className="stack page-stack">
      <section className="hero compact-hero">
        <span className="eyebrow">RECORD EXECUTION</span>
        <h1>{strategy.name}</h1>
      </section>

      <StrategyTabs strategyId={id} active="execution" />

      <section className="panel">
        <div className="section-head">
          <div><span className="eyebrow">EXECUTION</span><h2>체결 입력</h2></div>
          <span className="required-note">모두 필수</span>
        </div>
        <ExecutionEntryForm
          strategyId={id}
          executedAt={koreaDate(-1)}
          currentCash={state.cashBalance}
          currentPosition={state.positionQty}
          currentT={state.tValue}
          splitCount={state.splitCount}
          currentMode={state.mode}
          latestClose={latestClose}
          singleDefaults={{
            side: executionDefaults?.side ?? 'buy',
            orderType: executionDefaults?.orderType ?? 'MANUAL',
            quantity: executionDefaults?.quantity,
            tEffect: executionDefaults?.tEffect ?? 'none',
          }}
          pairedDefaults={pairedDefaults}
        />
      </section>

      <section className="panel summary-panel">
        <div className="section-head">
          <div><span className="eyebrow">BEFORE</span><h2>체결 전 상태</h2></div>
          <span className="subtle-label">{modeLabel(state.mode)}</span>
        </div>
        <div className="metric-grid">
          <div className="stat"><span>T</span><strong>{compact(state.tValue)}</strong></div>
          <div className="stat"><span>현금</span><strong>{usd(state.cashBalance)}</strong></div>
          <div className="stat"><span>수량</span><strong>{state.positionQty}주</strong></div>
          <div className="stat"><span>평단</span><strong>{usd(state.avgPrice)}</strong></div>
        </div>
      </section>

      <details className="panel disclosure">
        <summary>
          <span>
            <strong>최근 체결 취소</strong>
            <small>{latestExecution ? '최근 입력 1건만 취소할 수 있습니다' : '취소할 체결 기록이 없습니다'}</small>
          </span>
          <span aria-hidden="true">＋</span>
        </summary>
        <div className="disclosure-body">
          {latestExecution ? (
            <div className="record-delete-row execution-cancel-row">
              <div>
                <strong>{latestExecution.executed_at} · {latestExecution.side === 'buy' ? '매수' : '매도'} {latestExecution.quantity}주</strong>
                <p>평균 체결가 {usd(latestExecution.avg_execution_price)} · 취소하면 체결 직전의 현금·수량·평단·T값으로 복원됩니다.</p>
              </div>
              <form action={cancelLatestExecution}>
                <input name="strategy_id" type="hidden" value={id} />
                <input name="execution_id" type="hidden" value={latestExecution.id} />
                <button
                  className="danger"
                  data-confirm={`${latestExecution.executed_at} ${latestExecution.side === 'buy' ? '매수' : '매도'} ${latestExecution.quantity}주 체결을 취소하고 직전 상태로 되돌릴까요?`}
                  type="submit"
                >최근 체결 취소</button>
              </form>
            </div>
          ) : <p className="muted empty-copy">취소할 체결 기록이 없습니다.</p>}
        </div>
      </details>
    </div>
  );
}
