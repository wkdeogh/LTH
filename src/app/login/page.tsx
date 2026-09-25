import { redirect } from 'next/navigation';
import { hasAppAccess } from '@/lib/access/server';
import { safeReturnPath } from '@/lib/access/token';
import { getAppDisplayName } from '@/lib/env';

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const returnPath = safeReturnPath(params.next);
  if (await hasAppAccess()) redirect(returnPath);
  return (
    <section className="panel access-panel">
      <h1>HELLO {getAppDisplayName()}</h1>
      <form action="/api/access/login" method="post" className="access-form">
        <input type="hidden" name="next" value={returnPath} />
        <label htmlFor="app-password">접속 비밀번호</label>
        <input id="app-password" name="password" type="password" autoComplete="current-password" required maxLength={1024} autoFocus />
        {params.error === 'password' && <p className="danger-text" role="alert">비밀번호가 올바르지 않습니다.</p>}
        <button className="button primary" type="submit">접속하기</button>
      </form>
    </section>
  );
}
