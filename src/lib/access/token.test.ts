import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_MAX_AGE, createAccessToken, passwordMatches, safeReturnPath, verifyAccessToken } from './token';

const password = 'test-password-only-123456789';
const audience = 'friend.example.com';
const now = 1_800_000_000_000;

test('session persists, expires and is invalidated by password rotation', () => {
  const token = createAccessToken(password, audience, now);
  assert.equal(verifyAccessToken(token, password, audience, now + 86400000), true);
  assert.equal(verifyAccessToken(token, password, audience, now + ACCESS_MAX_AGE * 1000), false);
  assert.equal(verifyAccessToken(token, 'changed-password', audience, now), false);
  assert.equal(verifyAccessToken(token, password, 'owner.example.com', now), false);
  assert.equal(verifyAccessToken(token, '', audience, now), false);
});

test('rejects tampered, malformed and missing sessions', () => {
  const token = createAccessToken(password, audience, now);
  for (const invalid of [undefined, '', 'x', token + '.extra', 'x' + token, token.slice(0, -2), 'x'.repeat(2000)]) {
    assert.equal(verifyAccessToken(invalid, password, audience, now), false);
  }
  const [payload, sig] = token.split('.');
  const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), exp: 9999999999 })).toString('base64url');
  assert.equal(verifyAccessToken(`${changed}.${sig}`, password, audience, now), false);
});

test('password comparison preserves whitespace and rejects wrong values', () => {
  assert.equal(passwordMatches(password, password), true);
  assert.equal(passwordMatches(password + ' ', password), false);
  assert.equal(passwordMatches('', password), false);
  assert.equal(passwordMatches('', ''), false);
});

test('return destinations cannot leave the app or loop through login', () => {
  for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', '/login', '/api/access/login', '/a/../login', '/\n/evil.test']) {
    assert.equal(safeReturnPath(value), '/');
  }
  assert.equal(safeReturnPath('/strategies/abc/plan?date=2026-09-25'), '/strategies/abc/plan?date=2026-09-25');
});
