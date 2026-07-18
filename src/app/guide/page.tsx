import Link from 'next/link';

const starFormulas = [
  ['TQQQ · 20분할', '(15 − 1.5 × T)%'],
  ['TQQQ · 40분할', '(15 − 0.75 × T)%'],
  ['SOXL / RAM · 20분할', '(20 − 2 × T)%'],
  ['SOXL / RAM · 40분할', '(20 − T)%'],
];

export default function GuidePage() {
  return (
    <div className="stack page-stack guide-page">
      <section className="hero guide-hero">
        <span className="eyebrow">INFINITE BUYING V4.0</span>
        <h1>무한매수법<br />전략 가이드</h1>
        <p>주문 전에 다시 확인할 수 있도록 앱에서 사용하는 일반모드와 리버스모드 규칙을 순서대로 정리했습니다.</p>
        <div className="hero-actions">
          <Link className="button primary" href="/">내 전략 보기</Link>
          <a className="button ghost" href="#daily-check">오늘의 체크리스트</a>
        </div>
      </section>

      <nav className="guide-nav" aria-label="가이드 목차">
        <a href="#start">시작 설정</a>
        <a href="#normal">일반모드</a>
        <a href="#t-value">T값</a>
        <a href="#reverse">리버스모드</a>
        <a href="#daily-check">체크리스트</a>
      </nav>

      <section className="guide-intro-grid">
        <article><span>01</span><strong>원금 고정</strong><p>정한 원금과 남은 현금은 다른 투자에 사용하지 않습니다.</p></article>
        <article><span>02</span><strong>매일 주문</strong><p>일반모드 매수는 LOC, 쿼터매도는 LOC, 최종매도는 지정가입니다.</p></article>
        <article><span>03</span><strong>T 추적</strong><p>체결 종류에 따라 T값을 정확히 이어서 계산합니다.</p></article>
        <article><span>04</span><strong>소진 대응</strong><p>잔여 회차가 1회 미만이면 리버스모드로 전환합니다.</p></article>
      </section>

      <section className="guide-section" id="start">
        <div className="guide-section-head"><span>01</span><div><p>SETUP</p><h2>시작 설정</h2></div></div>
        <div className="guide-copy">
          <h3>종목과 원금</h3>
          <p>전략별 원금을 먼저 정하고, 매수 후 남은 현금도 해당 전략 전용으로 유지합니다. 여러 종목을 함께 운용한다면 각 전략의 원금을 독립적으로 관리합니다.</p>
          <div className="callout"><strong>앱 지원 범위</strong><p>TQQQ, SOXL, RAM과 20·40분할을 지원합니다. RAM의 계산식은 SOXL과 같습니다.</p></div>

          <h3>분할 수</h3>
          <div className="comparison-grid">
            <div><span>20분할</span><strong>공격적</strong><p>1회 매수금이 크고 소진까지의 기간이 짧습니다.</p></div>
            <div><span>40분할</span><strong>방어적</strong><p>1회 매수금이 작고 하락장 대응 여유가 큽니다.</p></div>
          </div>
          <p className="formula-line"><span>첫 1회 매수금</span><strong>원금 ÷ 분할 수</strong></p>
          <p>두 번째 매수부터는 실제 남은 현금과 T값을 반영합니다.</p>
          <p className="formula-line"><span>이후 1회 매수금</span><strong>현재 현금 ÷ (분할 수 − T)</strong></p>
        </div>
      </section>

      <section className="guide-section" id="normal">
        <div className="guide-section-head"><span>02</span><div><p>NORMAL MODE</p><h2>일반모드</h2></div></div>
        <div className="guide-copy">
          <h3>별지점 계산</h3>
          <p>별지점은 그날 매수와 쿼터매도를 가르는 기준입니다. 먼저 종목·분할 수·T값으로 별%를 구한 뒤 평단에 적용합니다.</p>
          <div className="formula-table">
            {starFormulas.map(([label, formula]) => <div key={label}><span>{label}</span><strong>{formula}</strong></div>)}
          </div>
          <p className="formula-line"><span>별지점</span><strong>평단 × (1 + 별%)</strong></p>
          <p className="formula-line"><span>매수점</span><strong>별지점 − $0.01</strong></p>

          <div className="example-box">
            <span>계산 예시</span>
            <p>SOXL 20분할, 평단 $38.30, T=8.6이라면 별%는 20 − 2×8.6 = 2.8%이고 별지점은 $38.30 × 1.028 = <strong>$39.37</strong>입니다. 매수점은 <strong>$39.36</strong>입니다.</p>
          </div>

          <h3>매수 규칙</h3>
          <div className="rule-list">
            <div><span>첫 매수</span><p>보유수량 0, T=0에서 시작합니다. 전일 종가 또는 참고가보다 약 10~15% 높은 가격으로 1회분 LOC 매수를 시도합니다.</p></div>
            <div><span>전반전</span><p>T가 분할 수의 절반보다 작을 때입니다. 1회 매수금의 절반은 별지점−$0.01, 나머지 절반은 평단에 LOC 매수합니다.</p></div>
            <div><span>후반전</span><p>T가 분할 수의 절반 이상일 때입니다. 1회 매수금 전부를 별지점−$0.01에 LOC 매수합니다.</p></div>
          </div>

          <h3>매도 규칙</h3>
          <div className="rule-list sell-rules">
            <div><span>쿼터매도</span><p>보유수량의 1/4을 별지점에 LOC 매도합니다. 수량은 소수점 이하를 버립니다.</p></div>
            <div><span>최종매도</span><p>나머지 수량을 TQQQ는 평단 +15%, SOXL/RAM은 평단 +20%에 지정가 매도합니다.</p></div>
          </div>
          <div className="warning-callout"><strong>후반전 쿼터매도는 손절일 수 있습니다.</strong><p>후반전에는 별%가 음수가 되므로 별지점이 평단보다 낮아집니다. 전략 규칙상 이 매도도 그대로 실행합니다.</p></div>
        </div>
      </section>

      <section className="guide-section" id="t-value">
        <div className="guide-section-head"><span>03</span><div><p>TURN VALUE</p><h2>T값 계산</h2></div></div>
        <div className="guide-copy">
          <p>T는 진행 회차를 나타냅니다. 소수 자릿수를 임의로 줄이지 않고 그대로 이어서 계산합니다.</p>
          <div className="t-rule-grid">
            <div><span>1회 매수</span><strong>T + 1</strong></div>
            <div><span>절반 매수</span><strong>T + 0.5</strong></div>
            <div><span>쿼터매도</span><strong>T × 0.75</strong></div>
            <div><span>지정가매도 후 1회 매수</span><strong>T × 0.25 + 1</strong></div>
            <div><span>지정가매도 후 절반 매수</span><strong>T × 0.25 + 0.5</strong></div>
          </div>
          <p>20분할은 T&gt;19, 40분할은 T&gt;39가 되면 남은 현금과 함께 리버스모드로 전환합니다.</p>
        </div>
      </section>

      <section className="guide-section" id="reverse">
        <div className="guide-section-head"><span>04</span><div><p>REVERSE MODE</p><h2>리버스모드</h2></div></div>
        <div className="guide-copy">
          <h3>첫날</h3>
          <p>첫날은 매수하지 않습니다. 보유수량을 20분할 전략은 10등분, 40분할 전략은 20등분해 소수점 이하를 버린 수량만큼 MOC 매도합니다.</p>
          <h3>둘째 날부터</h3>
          <p>최근 5거래일 종가 평균을 리버스 기준가로 사용합니다. 기준가 위에서는 일부 매도하고, 기준가 아래에서는 현재 현금의 1/4만큼 매수합니다.</p>
          <p className="helper-copy">앱에서는 직접 입력한 종가를 우선 사용하고, 종가가 없는 거래일은 LOC 체결가를 해당일 종가로 간주합니다.</p>
          <div className="t-rule-grid">
            <div><span>20분할 매도 후 T</span><strong>직전 T × 0.9</strong></div>
            <div><span>40분할 매도 후 T</span><strong>직전 T × 0.95</strong></div>
            <div><span>리버스 매수 후 T</span><strong>T + (분할 수 − T) × 0.25</strong></div>
            <div><span>리버스 매수금</span><strong>현재 현금 × 0.25</strong></div>
          </div>

          <h3>일반모드 복귀</h3>
          <p>종가가 평단 대비 TQQQ −15%, SOXL/RAM −20% 기준보다 위로 올라오면 일반모드로 복귀합니다. 리버스모드에서 계산한 T값은 그대로 이어서 사용합니다.</p>
          <div className="formula-table two-rows">
            <div><span>TQQQ</span><strong>종가 &gt; 평단 × 0.85</strong></div>
            <div><span>SOXL / RAM</span><strong>종가 &gt; 평단 × 0.80</strong></div>
          </div>
        </div>
      </section>

      <section className="guide-section" id="daily-check">
        <div className="guide-section-head"><span>05</span><div><p>DAILY ROUTINE</p><h2>오늘의 체크리스트</h2></div></div>
        <div className="guide-copy">
          <ol className="check-list">
            <li><span>1</span><div><strong>현재 상태 확인</strong><p>현금, 보유수량, 평단, T값과 모드가 증권사 기록과 같은지 확인합니다.</p></div></li>
            <li><span>2</span><div><strong>주문 계산 확인</strong><p>매수금, 별지점, 매수·매도 수량을 확인합니다.</p></div></li>
            <li><span>3</span><div><strong>증권사에 주문</strong><p>LOC·MOC·지정가 구분과 수량을 다시 확인한 뒤 주문합니다.</p></div></li>
            <li><span>4</span><div><strong>체결 입력</strong><p>실제 체결 수량과 평균 체결가, 해당 T 반영 방식을 저장합니다.</p></div></li>
            <li><span>5</span><div><strong>라운드 종료 확인</strong><p>매도 후 보유수량이 0이면 라운드가 종료되고 새 일반모드 라운드가 시작됩니다.</p></div></li>
          </ol>
        </div>
      </section>

      <section className="guide-disclaimer">
        <strong>사용 전 확인</strong>
        <p>이 앱은 개인용 주문 계산 가이드이며 투자 수익을 보장하지 않습니다. 실제 주문 전 증권사 화면의 수량·가격·체결 상태를 반드시 다시 확인하세요.</p>
        <Link className="button primary" href="/">전략 목록으로 돌아가기</Link>
      </section>
    </div>
  );
}
