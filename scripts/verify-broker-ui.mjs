import { chromium, expect } from '@playwright/test';
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
    let enabled = true, mode = 'success', confirmCount = 0, previewCount = 0, subscriptions = 0;
    let releaseStatus;
    let statusGate = new Promise(resolve => { releaseStatus = resolve; });
    const pauseStatus = () => { statusGate = new Promise(resolve => { releaseStatus = resolve; }); };
    const notifications = [{ id: 'fixture-notice', strategy_id: null, title: 'SOXL 주문 접수 완료', body: '오늘 주문이 정상 접수됐습니다.', tone: 'success', read_at: null, created_at: '2026-11-03T13:00:12.022Z' }];
    await context.addInitScript(() => {
      window.__pushPermission = 'denied';
      Object.defineProperty(window, 'Notification', { configurable: true, value: { requestPermission: async () => window.__pushPermission } });
      Object.defineProperty(window, 'PushManager', { configurable: true, value: function () {} });
      const subscription = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fixture', keys: { p256dh: 'fixture', auth: 'fixture' } }) };
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
        getRegistration: async () => undefined, ready: Promise.resolve(),
        register: async () => ({ pushManager: { getSubscription: async () => subscription } }),
      } });
    });
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) return route.continue();
      if (url.pathname === '/api/notifications') {
        if (req.method() === 'POST') {
          const body = req.postDataJSON();
          if (body.action === 'subscribe') subscriptions++;
          return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({ json: { notifications, publicKey: 'dGVzdA' } });
      }
      if (url.pathname === '/api/broker') {
        if (req.method() === 'GET') {
          const snapshot = enabled;
          await statusGate;
          return route.fulfill({ json: { configured: true, enabled: snapshot, syncEnabled: true, ordersReady: true, activeFrom: '2026-11-03', lastError: '과거에 확인한 오류 알림' } });
        }
        const body = req.postDataJSON();
        if (body.action === 'toggle') { enabled = body.enabled; return route.fulfill({ json: { enabled, activeFrom: '2026-11-03', message: '2026-11-03 미국 거래일부터 자동매매가 적용됩니다.' } }); }
        if (body.action === 'preview') {
          previewCount++;
          return route.fulfill({ json: { runId: `fixture-${previewCount}`, token: 'fixture', symbol: 'SOXL', currentPrice: 80,
            orders: mode === 'empty' ? [] : [{ key: 'buy:LOC:96', side: 'buy', orderType: 'LOC', price: 96, quantity: 65 },
              ...Array.from({ length: 22 }, (_, i) => ({ key: `supp-${i}`, side: 'buy', orderType: 'LOC', price: 95.45 - i, quantity: 1 }))],
            skipped: [{ label: '기본매수', reason: '주문가능 현금 부족 · 기본매수 제외' }] } });
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
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + detail, { waitUntil: 'domcontentloaded' });
    const toggle = page.getByRole('switch', { name: '자동매매' });
    await toggle.waitFor({ state: 'visible' });
    assert.equal(await page.getByText('과거에 확인한 오류 알림', {exact:true}).count(), 0);
    // The real saved ON value must be in the initial HTML, while client status
    // is deliberately withheld. Every subsequent write is a mock.
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    const navigation = await page.getByRole('navigation', { name: '전략 메뉴' }).boundingBox();
    const panel = await page.locator('.broker-control').boundingBox();
    const summary = await page.locator('.strategy-detail-summary').boundingBox();
    assert.ok(panel.y >= navigation.y + navigation.height && panel.y + panel.height <= summary.y);
    assert.ok(panel.height <= 68);
    assert.equal(await page.locator('.global-nav').count(), 0);
    assert.equal(await page.locator('.broker-control button').count(), 1);
    const bell = page.getByRole('button', { name: /^알림(,|$)/ });
    assert.equal(await bell.locator('svg').count(), 1);
    assert.equal((await bell.textContent()).includes('알림'), false);
    const header = await page.locator('.topbar').boundingBox();
    const bellBox = await bell.boundingBox();
    assert.ok(bellBox.y >= header.y && bellBox.y + bellBox.height <= header.y + header.height);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    const offHeight = (await page.locator('.broker-control').boundingBox()).height;
    assert.equal(offHeight, panel.height);
    releaseStatus();
    await page.waitForResponse(r => new URL(r.url()).pathname === '/api/broker' && r.request().method() === 'GET');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    assert.equal(await page.getByText('과거에 확인한 오류 알림', {exact:true}).count(), 0);
    const nav = page.getByRole('navigation', { name: '전략 메뉴' });
    await nav.locator('a[href$="/plan"]').click();
    await page.getByRole('button', { name: 'API 주문', exact: true }).waitFor();
    pauseStatus();
    await nav.locator('a').first().click();
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    releaseStatus();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    assert.equal((await page.locator('.broker-control').boundingBox()).height, offHeight);
    await page.getByText('2026-11-03 미국 거래일부터 자동매매가 적용됩니다.').waitFor();
    await nav.locator('a[href$="/plan"]').click();
    await page.getByRole('button', { name: 'API 주문', exact: true }).waitFor();
    pauseStatus();
    await nav.locator('a').first().click();
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    releaseStatus();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: new URL(`status-${width}.png`, output).pathname });
    await bell.click();
    const notices = page.getByRole('dialog', { name: '알림', exact: true });
    await notices.waitFor();
    await notices.getByText('푸시 알림', { exact: true }).waitFor();
    await notices.getByRole('button', {name:'SOXL 주문 접수 완료 상세 보기',exact:true}).waitFor();
    await notices.getByText('2026.11.03 22:00', { exact: true }).waitFor();
    await notices.getByRole('button', { name: 'SOXL 주문 접수 완료 상세 보기', exact: true }).click();
    const detailPanel = notices.getByRole('region', { name: '알림 상세' });
    await detailPanel.getByText('2026.11.03 22:00:12 · 한국시간', { exact: true }).waitFor();
    await detailPanel.getByText('처리 내용', { exact: true }).waitFor();
    await detailPanel.getByText('오늘 주문이 정상 접수됐습니다.', { exact: true }).waitFor();
    await page.screenshot({ path: new URL(`notification-detail-${width}.png`, output).pathname });
    await detailPanel.getByRole('button', { name: '‹ 알림 목록', exact: true }).click();
    await notices.getByRole('button', { name: '알림 받기', exact: true }).click();
    await notices.getByRole('alert').filter({ hasText: '기기 설정' }).waitFor();
    assert.equal(subscriptions, 0);
    await page.evaluate(() => { window.__pushPermission = 'granted'; });
    await notices.getByRole('button', { name: '알림 받기', exact: true }).click();
    await expect(notices.getByRole('button', { name: '연결됨', exact: true })).toBeDisabled();
    assert.equal(subscriptions, 1);
    const noticesBox = await notices.boundingBox();
    assert.ok(noticesBox.x >= 0 && noticesBox.x + noticesBox.width <= width);
    await page.screenshot({ path: new URL(`notifications-${width}.png`, output).pathname });
    await page.keyboard.press('Escape');
    await expect(bell).toHaveAttribute('aria-expanded', 'false');
    await page.goto(origin + detail + '/plan', { waitUntil: 'networkidle' });
    const api = page.getByRole('button', { name: 'API 주문', exact: true });
    await page.screenshot({ path: new URL(`plan-${width}.png`, output).pathname });
    const apiBox = await api.boundingBox();
    const orderPanel = await page.locator('.broker-order-panel').boundingBox();
    assert.equal(apiBox.width, orderPanel.width);
    const supplemental = page.locator('.supplemental-orders');
    if (await supplemental.count()) {
      const original = supplemental.getByRole('button', {name:'기존',exact:true});
      const grouped = supplemental.getByRole('button', {name:'묶음 (3%)',exact:true});
      await expect(grouped).toHaveAttribute('aria-pressed','true');
      await expect(original).toHaveAttribute('aria-pressed','false');
      await original.click();
      while (await supplemental.locator('.supplemental-more-button').count()) await supplemental.locator('.supplemental-more-button').click();
      const originalCount = await supplemental.locator('.supplemental-order-row').count();
      const originalQuantity = await supplemental.locator('.supplemental-order-row b').evaluateAll(nodes=>nodes.reduce((sum,node)=>sum+Number(node.textContent.replace('주','')),0));
      await grouped.click(); await expect(grouped).toHaveAttribute('aria-pressed','true');
      assert.ok(await supplemental.locator('.supplemental-order-row').count()<=5);
      await grouped.scrollIntoViewIfNeeded();
      await supplemental.screenshot({path:new URL(`supplemental-grouped-${width}.png`,output).pathname});
      while (await supplemental.locator('.supplemental-more-button').count()) await supplemental.locator('.supplemental-more-button').click();
      const groupedCount=await supplemental.locator('.supplemental-order-row').count();
      const groupedQuantity=await supplemental.locator('.supplemental-order-row b').evaluateAll(nodes=>nodes.reduce((sum,node)=>sum+Number(node.textContent.replace('주','')),0));
      assert.ok(groupedCount<=originalCount);assert.equal(groupedQuantity,originalQuantity);
      await expect(supplemental.locator('.pill')).toHaveText(`LOC · ${groupedCount}건`);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await original.click();await expect(original).toHaveAttribute('aria-pressed','true');
      await expect(supplemental.locator('.pill')).toHaveText(`LOC · ${originalCount}건`);
      assert.equal(await supplemental.locator('.supplemental-order-row').count(),Math.min(5,originalCount));
    }
    await api.click();
    await page.getByRole('dialog', { name: /API 주문 확인/ }).waitFor();
    assert.ok(await page.getByText('SOXL API 주문 확인').isVisible());
    assert.equal(confirmCount, 0);
    await page.getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(confirmCount, 0);
    await api.click(); await page.getByRole('dialog', { name: /API 주문 확인/ }).waitFor();
    assert.equal(await page.locator('.broker-order-line').count(), 23);
    await page.screenshot({ path: new URL(`dialog-${width}.png`, output).pathname });
    mode = 'failure';
    await page.getByRole('button', { name: '주문 전송', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '증거금 부족' }).waitFor();
    assert.equal(confirmCount, 1);
    await page.getByRole('button', { name: '취소', exact: true }).click();
    mode = 'success';
    await api.click(); await page.getByRole('dialog', { name: /API 주문 확인/ }).waitFor();
    await page.getByRole('button', { name: '주문 전송', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '정상 접수' }).waitFor();
    assert.equal(confirmCount, 2);
    mode = 'empty';
    await api.click(); await page.getByRole('dialog', { name: /API 주문 확인/ }).waitFor();
    await page.getByText('현금·가격 조건에 맞는 주문이 없습니다.', {exact:true}).waitFor();
    await expect(page.getByRole('button', {name:'주문 전송',exact:true})).toBeDisabled();
    await page.locator('.broker-skipped summary').click();
    await page.getByText('기본매수 · 주문가능 현금 부족 · 기본매수 제외',{exact:true}).waitFor();
    await page.screenshot({path:new URL(`empty-orders-${width}.png`,output).pathname});
    await page.getByRole('button',{name:'취소',exact:true}).click();
    assert.equal(confirmCount,2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    results.push({ width, supplementalViews:'pass', notificationTimestampAndDetail: 'pass', noRepeatedHistoricalToast: 'pass', savedStateFirstRender: 'pass', delayedStatusNavigation: 'pass', stableCardHeight: offHeight, bellInHeader: true, pushSettings: 'pass', fullWidthApiButton: true, togglePlacement: 'pass', lateActivation: 'pass', confirmationRequired: 'pass',
      errorDisplay: 'pass', successDisplay: 'pass', overflow: false, realOrderRequests: 0 });
    await context.close();
  }
  await writeFile(new URL('results.json', output), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
