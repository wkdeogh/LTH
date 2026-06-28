import { createStrategy } from '@/app/actions';

export default function NewStrategyPage() {
  return (
    <div className="stack">
      <section className="hero">
        <h1>전략 추가</h1>
      </section>

      <form className="panel form" action={createStrategy}>
        <div className="form-grid">
          <label>전략명<input name="name" defaultValue="TQQQ 40분할" required /></label>
          <label>종목<select name="symbol" defaultValue="TQQQ"><option>TQQQ</option><option>SOXL</option><option>RAM</option></select></label>
          <label>분할 수<select name="split_count" defaultValue="40"><option value="20">20</option><option value="40">40</option></select></label>
          <label>복리/단리<select name="compounding_type" defaultValue="compound"><option value="compound">복리</option><option value="simple">단리</option></select></label>
          <label>원금($)<input name="principal" type="number" step="0.0001" defaultValue="20000" required /></label>
          <label>현금($)<input name="cash_balance" type="number" step="0.0001" defaultValue="20000" required /></label>
          <label>보유수량<input name="position_qty" type="number" defaultValue="0" required /></label>
          <label>평단($)<input name="avg_price" type="number" step="0.0001" defaultValue="0" required /></label>
          <label>T값<input name="t_value" type="number" step="0.0000000001" defaultValue="0" required /></label>
          <label>모드<select name="mode" defaultValue="normal"><option value="normal">일반모드</option><option value="reverse">리버스모드</option></select></label>
        </div>
        <div className="actions">
          <button type="submit">저장</button>
        </div>
      </form>
    </div>
  );
}
