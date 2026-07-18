import Link from 'next/link';
import { createStrategy } from '@/app/actions';

export default function NewStrategyPage() {
  return (
    <div className="stack page-stack narrow-page">
      <section className="hero compact-hero">
        <span className="eyebrow">NEW STRATEGY</span>
        <h1>새 전략 만들기</h1>
        <p>처음 시작한다면 네 가지만 정하면 됩니다. 진행 중인 전략도 이어서 등록할 수 있습니다.</p>
      </section>

      <form className="panel form create-form" action={createStrategy}>
        <div className="form-section">
          <div className="form-section-number">1</div>
          <div className="form-section-content">
            <h2>기본 정보</h2>
            <div className="form-grid">
              <label>전략명<input name="name" defaultValue="TQQQ 40분할" required /></label>
              <label>종목<select name="symbol" defaultValue="TQQQ"><option>TQQQ</option><option>SOXL</option><option>RAM</option></select></label>
              <label>분할 수<select name="split_count" defaultValue="40"><option value="20">20분할 · 공격적</option><option value="40">40분할 · 방어적</option></select></label>
              <label>운용 방식<select name="compounding_type" defaultValue="compound"><option value="compound">복리 · 수익 포함</option><option value="simple">단리 · 원금 유지</option></select></label>
            </div>
          </div>
        </div>

        <div className="form-section">
          <div className="form-section-number">2</div>
          <div className="form-section-content">
            <h2>시작 원금</h2>
            <label>원금($)<input name="principal" type="number" min="0.0001" step="0.0001" inputMode="decimal" defaultValue="20000" required /></label>
            <p className="helper-copy">새로 시작하는 전략의 현금은 원금과 같은 금액으로 자동 설정됩니다.</p>
          </div>
        </div>

        <details className="nested-disclosure">
          <summary>
            <span><strong>진행 중인 전략 이어서 등록</strong><small>이미 보유한 수량과 T값이 있을 때</small></span>
            <span aria-hidden="true">＋</span>
          </summary>
          <div className="form-grid disclosure-body">
            <label>현재 현금($)<input name="cash_balance" type="number" min="0" step="0.0001" inputMode="decimal" placeholder="비우면 원금과 동일" /></label>
            <label>보유수량<input name="position_qty" type="number" min="0" inputMode="numeric" defaultValue="0" /></label>
            <label>평단($)<input name="avg_price" type="number" min="0" step="0.0001" inputMode="decimal" defaultValue="0" /></label>
            <label>T값<input name="t_value" type="number" min="0" step="0.0000000001" inputMode="decimal" defaultValue="0" /></label>
            <label>현재 모드<select name="mode" defaultValue="normal"><option value="normal">일반모드</option><option value="reverse">리버스모드</option></select></label>
          </div>
        </details>

        <div className="sticky-form-actions">
          <Link className="button ghost" href="/">취소</Link>
          <button type="submit" className="primary">전략 만들기</button>
        </div>
      </form>
    </div>
  );
}
