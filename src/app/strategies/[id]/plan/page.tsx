import Link from 'next/link';
import { notFound } from 'next/navigation';
import { saveTradePlan, switchToNormal, switchToReverse } from '@/app/actions';
import { compact, usd } from '@/components/Format';
import { SetupNotice } from '@/components/SetupNotice';
import { hasSupabaseEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { DailyPrice, Strategy } from '@/lib/types';
import { toNumber, toStrategyState } from '@/lib/types';
import { calculateNormalPlan, calculateReversePlan, modeLabel, phaseLabel } from '@/lib/trading';

function OrderTable({ title, orders }: { title: string; orders: Array<{ label: string; orderType: string; price: number | null; quantity: number; amount?: number; note: string }> }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {orders.length > 0 ? (
        <table>
          <thead><tr><th>구분</th><th>방식</th><th>가격</th><th>수량</th><th>금액</th><th>메모</th></tr></thead>
          <tbody>
            {orders.map((order, index) => (
              <tr key={`${order.label}-${index}`}>
                <td>{order.label}</td>
                <td>{order.orderType}</td>
                <td>{order.price ? usd(order.price) : '-'}</td>
                <td>{order.quantity}주</td>
                <td>{order.amount ? usd(order.amount) : '-'}</td>
                <td>{order.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="muted">해당 주문 없음</p>}
    </section>
  );
}

export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  if (!hasSupabaseEnv()) return <SetupNotice />;

  const { id } = await params;
  const query = await searchParams;
  const referencePrice = query.reference ? Number(query.reference) : undefined;
  const supabase = createSupabaseServerClient();

  const { data: strategy } = await supabase!.from('strategies').select('*').eq('id', id).single<Strategy>();
  if (!strategy) notFound();

  const { data: prices } = await supabase!
    .from('daily_prices')
    .select('*')
    .eq('strategy_id', id)
    .order('trade_date', { ascending: false })
    .limit(5)
    .returns<DailyPrice[]>();

  const state = toStrategyState(strategy);
  const recentCloses = (prices ?? []).map((price) => toNumber(price.close_price));
  const latestSavedClose = recentCloses[0];
  const plan = state.mode === 'normal'
    ? calculateNormalPlan(state, referencePrice)
    : calculateReversePlan(state, recentCloses, latestSavedClose);

  const guidance = {
    plan,
    generatedAt: new Date().toISOString(),
    strategy: { id: state.id, name: state.name, symbol: state.symbol, splitCount: state.splitCount },
  };

  return (
    <div className="stack">
      <section className="hero">
        <h1>오늘 주문 계산</h1>
        <div className="actions">
          <Link className="button secondary" href={`/strategies/${id}`}>전략 상세</Link>
          <Link className="button secondary" href={`/strategies/${id}/executions/new`}>체결 입력</Link>
        </div>
      </section>

      <section className="panel">
        <h2>계산 기준</h2>
        <div className="stat-grid">
          <div className="stat"><span>모드</span><strong>{modeLabel(state.mode)}</strong></div>
          <div className="stat"><span>T값</span><strong>{compact(state.tValue)}</strong></div>
          <div className="stat"><span>현금</span><strong>{usd(state.cashBalance)}</strong></div>
          <div className="stat"><span>보유수량</span><strong>{state.positionQty}주</strong></div>
          <div className="stat"><span>평단</span><strong>{usd(state.avgPrice)}</strong></div>
          <div className="stat"><span>최근 종가</span><strong>{recentCloses.length}/5개</strong></div>
        </div>
      </section>

      <section className="panel">
        <h2>첫 매수 참고가</h2>
        <form className="form" action={`/strategies/${id}/plan`}>
          <div className="form-grid">
            <label>현재가 또는 전일종가($)<input name="reference" type="number" step="0.0001" defaultValue={referencePrice ?? ''} /></label>
          </div>
          <button type="submit">다시 계산</button>
        </form>
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
            <div className="stat"><span>최신 저장 종가</span><strong>{latestSavedClose ? usd(latestSavedClose) : '-'}</strong></div>
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

      <section className="panel">
        <h2>계산 결과 저장</h2>
        <p className="muted">오늘 생성한 주문 가이드를 히스토리에 저장합니다.</p>
        <form action={saveTradePlan}>
          <input type="hidden" name="strategy_id" value={id} />
          <input type="hidden" name="plan_date" value={new Date().toISOString().slice(0, 10)} />
          <input type="hidden" name="mode" value={state.mode} />
          <input type="hidden" name="phase" value={'phase' in plan ? plan.phase : ''} />
          <input type="hidden" name="t_value" value={state.tValue} />
          <input type="hidden" name="avg_price" value={state.avgPrice} />
          <input type="hidden" name="cash_balance" value={state.cashBalance} />
          <input type="hidden" name="position_qty" value={state.positionQty} />
          <input type="hidden" name="star_percent" value={'starPercent' in plan && plan.starPercent !== null ? plan.starPercent : ''} />
          <input type="hidden" name="star_price" value={'starPrice' in plan && plan.starPrice !== null ? plan.starPrice : ''} />
          <input type="hidden" name="one_unit_budget" value={'oneUnitBudget' in plan ? plan.oneUnitBudget : ''} />
          <input type="hidden" name="reverse_reference_price" value={'referencePrice' in plan && plan.referencePrice ? plan.referencePrice : ''} />
          <input type="hidden" name="guidance" value={JSON.stringify(guidance)} />
          <button type="submit">오늘 계산 저장</button>
        </form>
      </section>
    </div>
  );
}
