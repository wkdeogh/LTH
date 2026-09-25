import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, ACCESS_MAX_AGE, createAccessToken, passwordMatches, safeReturnPath } from '@/lib/access/token';

// Best-effort per-instance throttling; production-wide limits belong in Vercel Firewall.
const attempts = new Map<string, { count: number; expires: number }>();
const WINDOW = 10 * 60 * 1000;

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return new Response('Forbidden', { status: 403 });
  }
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.redirect(new URL('/', request.url), 303);
  const now = Date.now();
  for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const attempt = attempts.get(ip) ?? { count: 0, expires: now + WINDOW };
  if (attempt.count >= 10 || attempts.size >= 10000 && !attempts.has(ip)) {
    return new Response('잠시 후 다시 시도해 주세요.', { status: 429, headers: { 'Retry-After': '600', 'Cache-Control': 'no-store' } });
  }
  attempts.set(ip, { ...attempt, count: attempt.count + 1 });
  const form = await request.formData();
  const input = form.get('password');
  const returnPath = safeReturnPath(String(form.get('next') ?? '/'));
  if (typeof input !== 'string' || input.length > 1024 || !passwordMatches(input, password)) {
    const url = new URL('/login', request.url);
    url.searchParams.set('error', 'password');
    url.searchParams.set('next', returnPath);
    const response = NextResponse.redirect(url, 303);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  attempts.delete(ip);
  const response = NextResponse.redirect(new URL(returnPath, request.url), 303);
  response.headers.set('Cache-Control', 'no-store');
  response.cookies.set(ACCESS_COOKIE, createAccessToken(password, request.headers.get('host') ?? ''), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
    path: '/', maxAge: ACCESS_MAX_AGE,
  });
  return response;
}
