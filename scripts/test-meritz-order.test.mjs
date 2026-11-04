import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOrder, classifyOrderResponse, runOrderTest } from './test-meritz-order.mjs';

const env = { MERITZ_APP_KEY: 'fixture-key', MERITZ_APP_SECRET: 'fixture-secret',
  MERITZ_MAC_ADDRESS: 'AABBCCDDEEFF', MERITZ_READ_ONLY: '0' };
const token = { access_token: 'fixture-token', expires_in: 43200 };
const accepted = { rsp_cd: '0001', data: { oder_no: 100000, warn_cls_code: '0' } };

async function scenario(responses, options = {}) {
  const calls = [], logs = [];
  const code = await runOrderTest({ send: true, env, emit: (line) => logs.push(line),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      assert.ok(responses.length, 'Unexpected additional request');
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return new Response(next.raw ?? JSON.stringify('body' in next ? next.body : next), {
        status: next.status ?? 200,
      });
    }, ...options });
  return { code, calls, output: logs.join('\n'), reports: logs.map((line) => JSON.parse(line)) };
}

test('default preview performs no requests and requires no credentials', async () => {
  const r = await scenario([], { send: false, env: {} });
  assert.equal(r.code, 0);
  assert.equal(r.calls.length, 0);
  assert.equal(r.reports[0].전송, false);
  assert.deepEqual(r.reports[0].body, {
    ovrs_stck_symb_iscd: 'SOXL', ovrs_exch_vndr_idno: '0066',
    oder_cls_code: '32', oder_cond_cls_code: '7', odqt: 1,
    ovrs_stck_oder_prc: '110.0000', warn_cnfr_yn: 'N',
  });
});

test('send requires explicit write mode before authentication', async () => {
  for (const readOnly of [undefined, '1', 'false', '']) {
    const r = await scenario([], { env: { ...env, MERITZ_READ_ONLY: readOnly } });
    assert.equal(r.code, 1);
    assert.equal(r.calls.length, 0);
  }
});

test('missing credentials stops before authentication', async () => {
  const r = await scenario([], { env: { MERITZ_READ_ONLY: '0' } });
  assert.equal(r.code, 1);
  assert.equal(r.calls.length, 0);
});

test('authentication and a single exact LOC request; secrets stay out of output', async () => {
  const r = await scenario([token, accepted]);
  assert.equal(r.code, 0);
  assert.equal(r.calls.length, 2);
  const [auth, order] = r.calls;
  assert.equal(auth.url, 'https://openapi.imeritz.com:9443/oauth2/token');
  assert.equal(auth.init.body.get('scope'), 'login');
  assert.equal(auth.init.body.get('client_id'), env.MERITZ_APP_KEY);
  assert.equal(auth.init.body.get('client_secret'), env.MERITZ_APP_SECRET);
  assert.equal(order.url, 'https://openapi.imeritz.com:9443/trading/v1/overseas/orders/buy');
  assert.equal(order.init.method, 'POST');
  assert.deepEqual(JSON.parse(order.init.body), buildOrder());
  assert.equal(order.init.headers.authorization, 'Bearer fixture-token');
  assert.equal(order.init.headers.mac_address, 'AABBCCDDEEFF');
  assert.equal(order.init.headers['content-type'], 'application/json');
  assert.equal(order.init.redirect, 'error');
  assert.equal(r.reports.at(-1).단계, '주문 접수 확인');
  assert.equal(r.reports.at(-1).체결여부, '미확인');
  for (const secret of [env.MERITZ_APP_KEY, env.MERITZ_APP_SECRET, token.access_token]) {
    assert.ok(!r.output.includes(secret));
  }
});

test('overseas warnings and holds are never treated as accepted or retried', async () => {
  for (const warning of ['1', '2', '3', '9']) {
    const r = await scenario([token, { rsp_cd: '0001',
      data: { oder_no: 100000, warn_cls_code: warning, warn_msg: '확인 필요' } }]);
    assert.equal(r.code, 1);
    assert.equal(r.calls.length, 2);
    assert.equal(r.reports.at(-1).단계, '경고·보류로 주문 미접수');
  }
});

test('success needs a warning code and positive order number', () => {
  for (const data of [undefined, {}, { oder_no: 100000 }, { warn_cls_code: '0' },
    { warn_cls_code: '0', oder_no: 0 }, { warn_cls_code: '0', oder_no: -1 }]) {
    assert.equal(classifyOrderResponse({ rsp_cd: '0001', data }).state, 'unknown');
  }
  assert.equal(classifyOrderResponse({ rsp_cd: '0001',
    data: { warn_cls_code: '0', oder_no: '100000' } }).state, 'accepted');
});

test('HTTP 200 business error is a rejection', async () => {
  const r = await scenario([token, { rsp_cd: '0760', rsp_sub_msg: '권한 없음' }]);
  assert.equal(r.code, 1);
  assert.equal(r.reports.at(-1).단계, '주문 거절');
});

test('token failure never sends the order and redacts credentials', async () => {
  const r = await scenario([{ status: 403, body: {
    rsp_cd: 'EGW00103', rsp_msg: 'fixture-key fixture-secret fixture-token', access_token: 'fixture-token',
  } }]);
  assert.equal(r.code, 1);
  assert.equal(r.calls.length, 1);
  for (const secret of [env.MERITZ_APP_KEY, env.MERITZ_APP_SECRET, token.access_token]) {
    assert.ok(!r.output.includes(secret));
  }
});

test('timeout after dispatch is uncertain and never retries', async () => {
  const error = new Error('fixture-secret');
  error.name = 'TimeoutError';
  const r = await scenario([token, error]);
  assert.equal(r.code, 3);
  assert.equal(r.calls.length, 2);
  assert.equal(r.reports.at(-1).단계, '주문 접수 여부 미확인');
  assert.equal(r.reports.at(-1).자동재전송, false);
});

test('invalid or incomplete order response remains uncertain', async () => {
  for (const response of [{ raw: '<html>gateway failure</html>', status: 502 },
    { body: null }, { body: [] }, { body: { rsp_cd: '0001' } }]) {
    const r = await scenario([token, response]);
    assert.equal(r.code, 3);
    assert.equal(r.calls.length, 2);
  }
});
