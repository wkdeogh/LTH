import { notFound } from 'next/navigation';
import { switchToNormal, switchToReverse } from '@/app/actions';
import { compact, usd } from '@/components/Format';
import { SetupNotice } from '@/components/SetupNotice';
import { StrategyTabs } from '@/components/StrategyTabs';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { DailyPrice, Execution, Strategy } from '@/lib/types';
import { toStrategyState } from '@/lib/types';
import {
  buildMarketReferenceHistory,
  calculateNormalPlan,
  calculatePositionPerformance,
  calculateReferenceAverage,
  calculateReversePlan,
  modeLabel,
  phaseLabel,
  referenceSourceLabel,
} from '@/lib/trading';

function OrderTable({ title, orders }: { title: string; orders: Array<{ label: string; orderType: string; price: number | null; quantity: number; amount?: number; note: string }> }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {orders.length > 0 ? (
        <div className="order-list">
          {orders.map((order, index) => (
            <article className="order-card" key={`${order.label}-${index}`}>
              <div className="order-card-head">
                <strong>{order.label}</strong>
                <span className="pill">{order.orderType}</span>
              </div>
              <div className="order-fields">
                <div><span>가격</span><strong>{order.price ? usd(order.price) : '-'}</strong></div>
                <div><span>수량</span><strong>{order.quantity}주</strong></div>
                <div><span>금액</span><strong>{order.amount ? usd(order.amount) : '-'}</strong></div>
              </div>
              <p>{order.note}</p>
            </article>
          ))}
        </div>
      ) : <p className="muted">해당 주문 없음</p>}
    </section>
  );
}

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const { id } = await params;
  const supabase = createSupabaseServerClient();

  const { data: strategy } = await supabase!.from('strategies').select('*').eq('id', id).single<Strategy>();
  if (!strategy) notFound();

  const [priceResult, executionResult] = await Promise.all([
    supabase!
      .from('daily_prices')
      .select('*')
      .eq('strategy_id', id)
      .order('trade_date', { ascending: false })
      .limit(7)
      .returns<DailyPrice[]>(),
    supabase!
      .from('executions')
      .select('*')
      .eq('strategy_id', id)
      .order('executed_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20)
      .returns<Execution[]>(),
  ]);

  const state = toStrategyState(strategy);
  const references = buildMarketReferenceHistory(priceResult.data ?? [], executionResult.data ?? []);
  const recentCloses = references.slice(0, 5).map((reference) => reference.price);
  const recentAverage = calculateReferenceAverage(references);
  const currentReference = references[0];
  const performance = calculatePositionPerformance(state.positionQty, state.avgPrice, currentReference?.price);
  const plan = state.mode === 'normal'
    ? calculateNormalPlan(state, currentReference?.price)
    : calculateReversePlan(state, recentCloses, currentReference?.price);

  return (
    <div className="stack page-stack">
      <section className="hero compact-hero">
        <span className="eyebrow">TODAY&apos;S ORDER</span>
        <h1>{strategy.name}</h1>
        <p>저장된 현재 상태를 기준으로 주문 수량과 가격을 계산했습니다.</p>
      </section>

      <StrategyTabs strategyId={id} active="plan" />

      <section className="panel summary-panel">
        <div className="section-head">
          <div><span className="eyebrow">CALCULATION BASE</span><h2>계산 기준</h2></div>
          <span className="subtle-label">{modeLabel(state.mode)}</span>
        </div>
        <div className="metric-grid">
          <div className="stat"><span>모드</span><strong>{modeLabel(state.mode)}</strong></div>
          <div className="stat"><span>T값</span><strong>{compact(state.tValue)}</strong></div>
          <div className="stat"><span>현금</span><strong>{usd(state.cashBalance)}</strong></div>
          <div className="stat"><span>보유수량</span><strong>{state.positionQty}주</strong></div>
          <div className="stat"><span>평단</span><strong>{usd(state.avgPrice)}</strong></div>
          <div className="stat"><span>현재 기준가</span><strong>{currentReference ? usd(currentReference.price) : '-'}</strong><small>{referenceSourceLabel(currentReference?.source)}</small></div>
          <div className="stat"><span>최근 기준가 5일 평균</span><strong>{recentAverage === null ? '-' : usd(recentAverage)}</strong><small>{recentCloses.length}/5개 기준</small></div>
          <div className="stat"><span>현재 수익률</span><strong className={performance.profitRate !== null && performance.profitRate < 0 ? 'profit-negative' : 'profit-positive'}>{performance.profitRate === null ? '-' : `${performance.profitRate >= 0 ? '+' : ''}${compact(performance.profitRate, 2)}%`}</strong></div>
          {state.mode === 'reverse' && (
            <div className="stat"><span>5일 기준가 데이터</span><strong>{recentCloses.length}/5개</strong></div>
          )}
        </div>
      </section>

      {'phase' in plan && (
        <section className="panel">
          <h2>일반모드 결과</h2>
          <div className="stat-grid">
            <div className="stat"><span>구간</span><strong>{phaseLabel(plan.phase)}</strong></div>
            <div className="stat"><span>1회 매수금</span><strong>{usd(plan.oneUnitBudget)}</strong></div>
            <div className="stat"><span>별%</span><strong>{plan.starPercent === null ? '-' : `${compact(plan.starPercent * 100)}%`}</strong></div>
            <div className="stat"><span>별지점</span><strong>{plan.starPrice ? usd(plan.starPrice) : '-'}</strong></div>
          </div>
        </section>
      )}

      {'isFirstDay' in plan && (
        <section className="panel">
          <h2>리버스모드 결과</h2>
          <div className="stat-grid">
            <div className="stat"><span>첫날 여부</span><strong>{plan.isFirstDay ? '첫날' : '둘째 날 이후'}</strong></div>
            <div className="stat"><span>5일 평균</span><strong>{plan.referencePrice ? usd(plan.referencePrice) : '-'}</strong></div>
            <div className="stat"><span>매수금</span><strong>{usd(plan.buyBudget)}</strong></div>
            <div className="stat"><span>현재 기준가</span><strong>{currentReference ? usd(currentReference.price) : '-'}</strong></div>
            <div className="stat"><span>복귀 조건</span><strong>{plan.returnToNormal ? '충족' : '미충족'}</strong></div>
          </div>
          {plan.returnToNormal && <form action={switchToNormal} style={{ marginTop: 12 }}><input type="hidden" name="id" value={id} /><button type="submit">일반모드로 복귀 저장</button></form>}
        </section>
      )}

      {plan.warnings.length > 0 && <section className="warning"><strong>확인 필요</strong><ul>{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section>}

      <OrderTable title="오늘 매수 가이드" orders={plan.buyOrders} />
      <OrderTable title="오늘 매도 가이드" orders={plan.sellOrders} />

      {'phase' in plan && plan.phase === 'reverse_required' && (
        <section className="panel">
          <h2>리버스모드 전환</h2>
          <p className="muted">T값이 기준을 초과했습니다. 다음 계산부터 리버스모드로 진행하려면 전환을 저장하세요.</p>
          <form action={switchToReverse}><input type="hidden" name="id" value={id} /><button type="submit">리버스모드 전환 저장</button></form>
        </section>
      )}

      <section className="panel">
        <h2>계산 근거</h2>
        <ul>{plan.formulas.map((formula) => <li key={formula}>{formula}</li>)}</ul>
      </section>
    </div>
  );
}
