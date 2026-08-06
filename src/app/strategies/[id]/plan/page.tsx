import { notFound } from 'next/navigation';
import { AutoNormalTransition } from '@/components/AutoNormalTransition';
import { AutoReverseTransition } from '@/components/AutoReverseTransition';
import { compact, usd } from '@/components/Format';
import { SetupNotice } from '@/components/SetupNotice';
import { StrategyTabs } from '@/components/StrategyTabs';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { DailyPrice, MarketCandle, Strategy } from '@/lib/types';
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
import type { OrderGuide } from '@/lib/trading';

function OrderTable({ title, orders }: { title: string; orders: OrderGuide[] }) {
  const mainOrders = orders.filter((order) => !order.isSupplemental);
  const supplementalOrders = orders.filter((order) => order.isSupplemental);

  return (
    <section className="panel">
      <h2>{title}</h2>
      {orders.length > 0 ? (
        <div className="order-list">
          {mainOrders.map((order, index) => (
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
          {supplementalOrders.length > 0 && (
            <article className="supplemental-orders">
              <div className="supplemental-orders-head">
                <div>
                  <strong>하락 보완 1주 매수</strong>
                  <p>종가가 내려갈수록 1회 매수금을 채우는 LOC 주문입니다.</p>
                </div>
                <span className="pill">LOC · {supplementalOrders.length}건</span>
              </div>
              <div className="supplemental-order-list" aria-label="하락 보완 LOC 주문 목록">
                {supplementalOrders.map((order, index) => (
                  <div className="supplemental-order-row" key={`${order.label}-${index}`}>
                    <span>{index + 1}</span>
                    <div><small>LOC 가격</small><strong>{order.price ? usd(order.price) : '-'}</strong></div>
                    <b>{order.quantity}주</b>
                  </div>
                ))}
              </div>
            </article>
          )}
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

  const [priceResult, candleResult] = await Promise.all([
    supabase!
      .from('daily_prices')
      .select('*')
      .eq('strategy_id', id)
      .order('trade_date', { ascending: false })
      .limit(7)
      .returns<DailyPrice[]>(),
    supabase!
      .from('market_candles')
      .select('*')
      .eq('symbol', strategy.symbol)
      .order('trade_date', { ascending: false })
      .limit(7)
      .returns<MarketCandle[]>(),
  ]);

  const state = toStrategyState(strategy);
  const references = buildMarketReferenceHistory(priceResult.data ?? [], candleResult.data ?? []);
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
      </section>

      <StrategyTabs strategyId={id} active="plan" />

      <OrderTable title="오늘 매수 가이드" orders={plan.buyOrders} />
      <OrderTable title="오늘 매도 가이드" orders={plan.sellOrders} />

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
          {plan.returnToNormal && <AutoNormalTransition strategyId={id} />}
        </section>
      )}

      {plan.warnings.length > 0 && <section className="warning"><strong>확인 필요</strong><ul>{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section>}

      {'phase' in plan && plan.phase === 'reverse_required' && (
        <AutoReverseTransition strategyId={id} />
      )}

      <section className="panel">
        <h2>계산 근거</h2>
        <ul>{plan.formulas.map((formula) => <li key={formula}>{formula}</li>)}</ul>
      </section>
    </div>
  );
}
