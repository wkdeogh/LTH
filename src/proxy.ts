import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, verifyAccessToken } from '@/lib/access/token';

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // The cron endpoint performs its own CRON_SECRET verification.
  if (path === '/api/cron/market-candles') return NextResponse.next();
  const isLogin = path === '/login' || path === '/api/access/login';
  // Never allow a Server Action to bypass authentication through the login URL.
  if (isLogin && !request.headers.has('next-action')) return NextResponse.next();
  const password = process.env.APP_PASSWORD;
  if (!password || verifyAccessToken(request.cookies.get(ACCESS_COOKIE)?.value, password, request.headers.get('host') ?? '')) {
    return NextResponse.next();
  }
  if (path.startsWith('/api/') || request.method !== 'GET' && request.method !== 'HEAD') {
    return NextResponse.json({ error: '접속 비밀번호를 입력해 주세요.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const url = new URL('/login', request.url);
  url.searchParams.set('next', path + request.nextUrl.search);
  const response = NextResponse.redirect(url);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static/|_next/image|favicon.ico$|icon.png$|apple-icon.png$).*)'],
};
