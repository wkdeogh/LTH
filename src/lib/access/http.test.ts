import { test } from 'node:test';
import assert from 'node:assert/strict';

// Run against a separate server with empty Supabase env vars and test-only credentials.
const base = process.env.ACCESS_TEST_URL;
const password = process.env.ACCESS_TEST_PASSWORD;

test('HTTP access gate, persistent cookie, CSRF, cron and retry limit', { skip: !base || !password }, async () => {
  const request = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { redirect: 'manual', ...init });
  for (const path of ['/', '/rounds', '/strategies/example/plan', '/guide']) {
    const response = await request(path);
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get('location')!, base).pathname, '/login');
  }
  for (const path of ['/api/private-test', '/strategies/example/plan', '/login']) {
    const response = await request(path, { method: 'POST', headers: { 'next-action': 'test-action' } });
    assert.equal(response.status, 401);
  }
  assert.equal((await request('/api/private-test')).status, 401);
  assert.equal((await request('/api/cron/market-candles')).status, 401);
  for (const path of ['/api/cron/meritz-open', '/api/cron/meritz-reprice']) {
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, { headers: { authorization: 'Bearer invalid' } })).status, 401);
    if (process.env.ACCESS_TEST_CRON_SECRET) {
      const response = await request(path, { headers: { authorization: `Bearer ${process.env.ACCESS_TEST_CRON_SECRET}` } });
      assert.equal(response.status, 200);
      assert.match((await response.json()).skipped, /키 미설정/);
    }
  }
  const login = (value: string, origin = base!, next = '/guide') => request('/api/access/login', {
    method: 'POST', headers: { origin }, body: new URLSearchParams({ password: value, next }),
  });
  assert.equal((await login(password!, 'https://evil.example')).status, 403);
  const wrong = await login('wrong');
  assert.match(wrong.headers.get('location')!, /error=password/);
  assert.equal(wrong.headers.get('set-cookie'), null);
  const correct = await login(password!);
  assert.equal(correct.status, 303);
  assert.equal(new URL(correct.headers.get('location')!, base).pathname, '/guide');
  const setCookie = correct.headers.get('set-cookie')!;
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=lax/i);
  assert.match(setCookie, /Max-Age=31536000/i);
  assert.ok(!setCookie.includes(password!));
  const cookie = setCookie.split(';')[0];
  for (let i = 0; i < 2; i++) {
    assert.equal((await request('/guide', { headers: { cookie } })).status, 200);
  }
  assert.equal((await request('/guide', { headers: { cookie: cookie + 'tampered' } })).status, 307);
  const external = await login(password!, base!, '//evil.example');
  assert.equal(new URL(external.headers.get('location')!, base).origin, base);
  for (let i = 0; i < 10; i++) assert.equal((await login('wrong')).status, 303);
  assert.equal((await login('wrong')).status, 429);
});
