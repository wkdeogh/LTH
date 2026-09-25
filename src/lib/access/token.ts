import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ACCESS_COOKIE = 'lth_access';
export const ACCESS_MAX_AGE = 60 * 60 * 24 * 365;

export function passwordMatches(input: string, password: string) {
  const digest = (value: string) => createHmac('sha256', password).update(value).digest();
  return Boolean(password) && timingSafeEqual(digest(input), digest(password));
}

export function createAccessToken(password: string, audience: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(now / 1000) + ACCESS_MAX_AGE, audience, nonce: randomBytes(24).toString('hex'),
  })).toString('base64url');
  const signature = createHmac('sha256', password).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyAccessToken(token: string | undefined, password: string, audience: string, now = Date.now()) {
  if (!password || !token || token.length > 1024) return false;
  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) return false;
    const expected = createHmac('sha256', password).update(payload).digest('base64url');
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const nowSeconds = Math.floor(now / 1000);
    return data.audience === audience && Number.isSafeInteger(data.exp)
      && data.exp > nowSeconds && data.exp <= nowSeconds + ACCESS_MAX_AGE;
  } catch {
    return false;
  }
}

export function safeReturnPath(value: string | null | undefined) {
  if (typeof value !== 'string' || !value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/';
  const url = new URL(value, 'https://local.invalid');
  if (url.origin !== 'https://local.invalid' || url.pathname === '/login' || url.pathname.startsWith('/api/')) return '/';
  return url.pathname + url.search;
}
