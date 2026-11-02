import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { ACCESS_COOKIE, createAccessToken } from '../src/lib/access/token.ts';

// All broker requests and every other POST are intercepted. This check cannot
// submit a real order, toggle live automation, or mutate strategy records.
const origin = process.env.LTH_TEST_ORIGIN || 'http://127.0.0.1:3000';
const output = new URL('../.codex/broker-verification/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
try {
  for (const width of [390, 320, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    if (process.env.LTH_TEST_PASSWORD) await context.addCookies([{ name: ACCESS_COOKIE,
      value: createAccessToken(process.env.LTH_TEST_PASSWORD, new URL(origin).host), url: origin, httpOnly: true, sameSite: 'Lax' }]);
    let enabled = false, mode = 'success', confirmCount = 0, previewCount = 0;
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) return route.continue();
      if (url.pathname === '/api/notifications') return route.fulfill({ json: { notifications: [], publicKey: null } });
      if (url.pathname === '/api/broker') {
        if (req.method() === 'GET') return route.fulfill({ json: { configured: true, enabled, syncEnabled: true, ordersReady: true, activeFrom: '2026-11-03' } });
        const body = req.postDataJSON();
        if (body.action === 'toggle') { enabled = body.enabled; return route.fulfill({ json: { enabled, activeFrom: '2026-11-03', message: '2026-11-03 미국 거래일부터 자동매매가 적용됩니다.' } }); }
        if (body.action === 'preview') {
          previewCount++;
          return route.fulfill({ json: { runId: `fixture-${previewCount}`, token: 'fixture', symbol: 'SOXL', currentPrice: 80,
            orders: [{ key: 'buy:LOC:96', side: 'buy', orderType: 'LOC', price: 96, quantity: 65 },
              ...Array.from({ length: 22 }, (_, i) => ({ key: `supp-${i}`, side: 'buy', orderType: 'LOC', price: 95.45 - i, quantity: 1 }))],
            skipped: [{ label: '쿼터매도', reason: '현재가 +20% 이상 매도 제외' }] } });
        }
        if (body.action === 'confirm') {
          confirmCount++;
          if (mode === 'failure') return route.fulfill({ status: 400, json: { error: '증거금 부족: 주문을 접수하지 못했습니다.' } });
          return route.fulfill({ json: { ok: true, message: '23건의 주문이 정상 접수됐습니다. 체결은 장 마감 후 확인합니다.' } });
        }
        throw new Error(`Unexpected broker action: ${body.action}`);
      }
      if (req.method() !== 'GET' && req.method() !== 'HEAD') return route.abort('blockedbyclient');
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: 'networkidle' });
    const hrefs = await page.locator('a[href^="/strategies/"]').evaluateAll(nodes => nodes.map(n => n.getAttribute('href')));
    const detail = hrefs.find(h => /^\/strategies\/[0-9a-f-]{36}$/.test(h));
    assert.ok(detail, '검증할 전략이 필요합니다.');
    await page.goto(origin + detail, { waitUntil: 'networkidle' });
    const toggle = page.getByRole('switch', { name: '자동매매' });
    await toggle.waitFor({ state: 'visible' });
    const navigation = await page.getByRole('navigation', { name: '전략 메뉴' }).boundingBox();
    const panel = await page.locator('.broker-control').boundingBox();
    const summary = await page.locator('.strategy-detail-summary').boundingBox();
    assert.ok(panel.y >= navigation.y + navigation.height && panel.y + panel.height <= summary.y);
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await toggle.click();
    await page.getByText('2026-11-03 미국 거래일부터 자동매매가 적용됩니다.').waitFor();
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: new URL(`status-${width}.png`, output).pathname });
    await page.goto(origin + detail + '/plan', { waitUntil: 'networkidle' });
    const api = page.getByRole('button', { name: 'API 주문', exact: true });
    await api.click();
    await page.getByRole('dialog').waitFor();
    assert.ok(await page.getByText('SOXL API 주문 확인').isVisible());
    assert.equal(confirmCount, 0);
    await page.getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(confirmCount, 0);
    await api.click(); await page.getByRole('dialog').waitFor();
    assert.equal(await page.locator('.broker-order-line').count(), 23);
    await page.screenshot({ path: new URL(`dialog-${width}.png`, output).pathname });
    mode = 'failure';
    await page.getByRole('button', { name: '주문 전송', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '증거금 부족' }).waitFor();
    assert.equal(confirmCount, 1);
    await page.getByRole('button', { name: '취소', exact: true }).click();
    mode = 'success';
    await api.click(); await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: '주문 전송', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '정상 접수' }).waitFor();
    assert.equal(confirmCount, 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    results.push({ width, togglePlacement: 'pass', lateActivation: 'pass', confirmationRequired: 'pass',
      errorDisplay: 'pass', successDisplay: 'pass', overflow: false, realOrderRequests: 0 });
    await context.close();
  }
  await writeFile(new URL('results.json', output), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
