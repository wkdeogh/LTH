import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_COOKIE, verifyAccessToken } from './token';

export async function hasAppAccess() {
  const password = process.env.APP_PASSWORD;
  if (!password) return true;
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  return verifyAccessToken(cookieStore.get(ACCESS_COOKIE)?.value, password, requestHeaders.get('host') ?? '');
}

export async function requireAppAccess() {
  if (!await hasAppAccess()) redirect('/login');
}
