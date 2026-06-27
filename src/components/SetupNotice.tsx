export function SetupNotice() {
  return (
    <section className="panel">
      <h2>Supabase 설정 필요</h2>
      <p className="muted">아직 DB 환경변수가 설정되지 않았습니다. 아래 순서대로 진행하세요.</p>
      <ol>
        <li>Supabase 프로젝트를 생성합니다.</li>
        <li>
          Supabase SQL Editor에서 <code>supabase/schema.sql</code> 내용을 실행합니다.
        </li>
        <li>
          <code>.env.example</code>을 참고해 <code>.env.local</code>을 만듭니다.
        </li>
        <li>
          <code>SUPABASE_URL</code>과 <code>SUPABASE_SERVICE_ROLE_KEY</code>를 입력합니다.
        </li>
        <li>
          개발 서버를 다시 실행합니다: <code>npm run dev</code>
        </li>
      </ol>
    </section>
  );
}
