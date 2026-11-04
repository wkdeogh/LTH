import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { activationDate, openingWindow, regularSession, isTradingDay, closeMinute } from './calendar';
import { processGuide, orderBody, validateFunding, judgeOrder, strategyGuide, matchGuideOrder } from './policy';
import { MeritzClient } from './meritz';
import { brokerSession, buildBrokerCommit, normalizeDetails, type BrokerFill } from './reconciliation';
import { buildDownsideBuyOrders, type NormalPlan, type OrderGuide } from '@/lib/trading/normalMode';
import type { Strategy } from '@/lib/types';
import { toStrategyState } from '@/lib/types';

const strategy: Strategy = { id: 'a3483fb0-bf14-45df-b3f4-8c92d9d4133d', name: '테스트', symbol: 'SOXL', split_count: 20,
  principal: 126000, cash_balance: 63000, position_qty: 100, avg_price: 120, t_value: 10,
  mode: 'normal', reverse_started_at: null, reverse_first_sell_done: false, compounding_type: 'compound',
  is_archived: false, version: 1, started_at: '2026-10-01', created_at: '', updated_at: '' };
function guideWith(orders: OrderGuide[]): NormalPlan {
  return { kind: 'normal', phase: 'second_half', oneUnitBudget: 6300, starPercent: 0, starPrice: 105.01,
    buyPrice: 105, targetSellPrice: 144, buyOrders: orders.filter(o => o.side === 'buy'),
    sellOrders: orders.filter(o => o.side === 'sell'), warnings: [], formulas: [] };
}
const base: OrderGuide = { label: '기본', side: 'buy', orderType: 'LOC', price: 105, quantity: 60, note: '', completesBuyUnit: true };

test('20% 매수 상한과 -10% 보완 하한: 예산 6300의 수량을 중복 없이 합친다', () => {
  const r = processGuide(guideWith([base, ...buildDownsideBuyOrders(6300, 60)]), 80);
  assert.equal(r.orders[0].price, 96); assert.equal(r.orders[0].quantity, 65);
  assert.equal(r.orders[0].sources.length, 6);
  assert.equal(r.orders.length, 23); assert.equal(r.skipped.length, 33);
  assert.equal(r.orders[1].price, 95.45); assert.equal(r.orders.at(-1)!.price, 72.41);
  assert.equal(r.orders.reduce((n, o) => n + o.quantity, 0), 87);
});
test('현재가81은 97.20 상한, 낮은 기본 매수는 올리지 않는다', () => {
  const r = processGuide(guideWith([base, { ...base, price: 60 }]), 81);
  assert.deepEqual(r.orders.map(o => o.price), [97.2, 60]);
});
test('경계: 매수 +20% 유지, 매도 +20% 제외, 보완 -10% 포함', () => {
  const r = processGuide(guideWith([
    { ...base, price: 96 }, { ...base, side: 'sell', price: 96 }, { ...base, side: 'sell', price: 95.99 },
    { ...base, price: 72, isSupplemental: true, quantity: 1 }, { ...base, price: 71.99, isSupplemental: true, quantity: 1 },
  ]), 80);
  assert.equal(r.skipped.length, 2);
  assert.ok(r.orders.some(o => o.side === 'buy' && o.price === 96));
  assert.ok(r.orders.some(o => o.price === 72));
  assert.ok(!r.orders.some(o => o.side === 'sell' && o.price === 96));
});
test('MOC는 가격 필터를 적용하지 않고 전반전·리버스 예산 의미를 보존한다', () => {
  const r = processGuide(guideWith([{ ...base, orderType: 'MOC', side: 'sell', price: null }]), 80);
  assert.equal(r.orders[0].orderType, 'MOC'); assert.equal(r.orders[0].price, null);
  assert.equal(orderBody('SOXL', r.orders[0]).oder_cls_code, '34');
  assert.equal(orderBody('SOXL', { ...r.orders[0], orderType: 'LOC', price: 96 }).oder_cond_cls_code, '7');
});
test('현금·매도 가능 수량이 부족하면 임의로 수량을 바꾸지 않는다', () => {
  const r = processGuide(guideWith([base]), 80);
  assert.throws(() => validateFunding(r.orders, toStrategyState(strategy), 100, 100), /현금/);
  assert.throws(() => validateFunding([{ ...r.orders[0], side: 'sell', quantity: 101 }], toStrategyState(strategy), 100000, 100), /수량/);
});
test('22시 이후 ON은 다음 거래일, 휴장·서머타임·조기마감 구분', () => {
  assert.equal(activationDate(new Date('2026-11-02T12:59:59Z')), '2026-11-02');
  assert.equal(activationDate(new Date('2026-11-02T13:00:00Z')), '2026-11-03');
  assert.equal(activationDate(new Date('2026-11-06T16:00:00Z')), '2026-11-09');
  assert.equal(openingWindow(new Date('2026-07-06T13:00:00Z')), true);
  assert.equal(openingWindow(new Date('2026-11-02T13:30:00Z')), false);
  assert.equal(isTradingDay('2026-11-26'), false);
  assert.equal(isTradingDay('2026-07-03'), false);
  assert.equal(closeMinute('2026-11-27'), 780);
  assert.equal(regularSession(new Date('2026-11-27T17:49:59Z')), true);
  assert.equal(regularSession(new Date('2026-11-27T17:50:00Z')), false);
});
test('접수 성공은 경고0·주문번호가 필요하며 접수와 체결을 구분한다', () => {
  assert.equal(judgeOrder({ rsp_cd: '0001', data: { warn_cls_code: '0', oder_no: 123 } }), 'accepted');
  for (const warning of ['1','2','3']) assert.equal(judgeOrder({ rsp_cd: '0001', data: { warn_cls_code: warning, oder_no: 123 } }), 'rejected');
  assert.equal(judgeOrder({ rsp_cd: '0001', data: { warn_cls_code: '0' } }), 'unknown');
});
test('인증·병렬 호출도 최소 1초 간격, 토큰은 재사용한다', async () => {
  let now = 0; const starts: number[] = [], paths: string[] = [];
  const c = new MeritzClient({ key: 'fixture-key', secret: 'fixture-secret', clock: () => now,
    wait: async ms => { now += ms; }, fetcher: async input => {
      starts.push(now); paths.push(String(input));
      return new Response(JSON.stringify(String(input).endsWith('/oauth2/token') ? { access_token: 'token' } : { rsp_cd: '0000', data: [] }));
    } });
  await Promise.all([c.call('/test1'), c.call('/test2'), c.call('/test3')]);
  assert.deepEqual(starts, [0,1000,2000,3000]);
  assert.equal(paths.filter(p => p.endsWith('/oauth2/token')).length, 1);
  assert.ok(!c.clean('fixture-secret token fixture-key').includes('fixture-'));
});
test('연속조회 키 공백과 5820 응답의 데이터를 보존한다', async () => {
  let page = 0; const paths: string[] = [];
  const c = new MeritzClient({ key: 'k', secret: 's', wait: async () => {}, fetcher: async url => {
    paths.push(String(url));
    if (String(url).endsWith('/oauth2/token')) return new Response(JSON.stringify({ access_token: 't' }));
    return new Response(JSON.stringify(page++ === 0 ? { rsp_cd: '5762', tr_cont_key: ' KEY  ', data: [{ x: 1 }] }
      : { rsp_cd: '5820', data: [{ x: 2 }] }));
  } });
  assert.equal((await c.rows('/test')).length, 2);
  assert.equal(new URL(paths.at(-1)!).searchParams.get('tr_cont_key'), ' KEY  ');
});
test('메리츠 한국시각을 미국 거래 세션으로 연결한다', () => {
  assert.equal(brokerSession({ oder_exec_ymdh: '2026-11-03 02:00:00' }), '2026-11-02');
  assert.equal(brokerSession({ oder_exec_ymdh: '2026-11-02 23:30:00' }), '2026-11-02');
});
const history = { oder_no: 10, oder_date: '20261102', oder_dqty: '2', cntg_dqty: '2', cntg_camt: '160' };
const detail = { ...history, cntg_no: 1, cntg_ymdh: '2026-11-03 06:00:00', iscd: 'SOXL.AX',
  seln_byov_clcd: '2', aspr_type_code: '5', ovrs_stck_oder_prc: '96' };
test('체결번호 기준 중복 제거·부분체결 및 불일치는 반영 보류', () => {
  assert.equal(normalizeDetails([detail, detail], history).length, 1);
  assert.throws(() => normalizeDetails([detail], { ...history, oder_dqty: '3' }), /부분체결/);
  assert.throws(() => normalizeDetails([{ ...detail, cntg_camt: '159' }], history), /합계/);
});
const fill: BrokerFill = { orderDate: '20261102', orderNo: '10', fillNo: '1', symbol: 'SOXL', side: 'buy', orderType: 'LOC',
  quantity: 65, amount: 5200, price: 80, limitPrice: 96, time: '2026-11-03 06:00:00', orderQuantity: 65 };
test('체결 단가로 현금·평단을 계산하며 보완매수 여러 건이어도 T는 한 번만 증가', () => {
  const r = buildBrokerCommit(strategy, guideWith([base]), [fill, { ...fill, orderNo: '11', fillNo: '2', quantity: 1, amount: 80 }], '2026-11-02', 80);
  assert.equal(r.executions.length, 1); assert.equal(r.executions[0].quantity, 66);
  assert.equal(r.final.position_qty, 166); assert.equal(r.final.cash_balance, 57720); assert.equal(r.final.t_value, 11);
});
test('지정가 매도 뒤 LOC 매수의 기존 T·평단 의미를 보존한다', () => {
  const r = buildBrokerCommit(strategy, guideWith([base]), [{ ...fill, side: 'sell', orderType: 'LIMIT', quantity: 75, amount: 11250,
    time: '2026-11-03 01:00:00' }, fill], '2026-11-02', 80);
  assert.equal(r.final.t_value, 3.5); assert.equal(r.final.position_qty, 90);
  assert.equal(r.final.avg_price, Math.round((25*120+5200)/90*10000)/10000);
});
test('전반전 수동 별지점 반회만 주문했다면 낮은 종가라도 T를 1회로 바꾸지 않는다', () => {
  const plan = { ...guideWith([{ ...base, price: 115, quantity: 30, completesBuyUnit: false },
    { ...base, price: 100, quantity: 33, completesBuyUnit: true }]), phase: 'first_half' as const };
  const match = matchGuideOrder(plan, 110, { side: 'buy', orderType: 'LOC', price: 115, quantity: 30 });
  assert.equal(match!.sources.some(s => s.completesBuyUnit), false);
  const r = buildBrokerCommit(strategy, plan, [{ ...fill, quantity: 30, amount: 2850, price: 95 }], '2026-11-02', 95,
    { buyCompletesUnit: false });
  assert.equal(r.final.t_value, 10.5);
});
test('리버스 체결 후 평단으로 복귀 판단하며 첫날 MOC 의미를 보존한다', () => {
  const s = { ...strategy, mode: 'reverse' as const, t_value: 20, reverse_started_at: '2026-10-30', reverse_first_sell_done: true };
  const p = strategyGuide(s, 80);
  const r = buildBrokerCommit(s, p, [fill], '2026-11-02', 90);
  assert.equal(r.final.mode, 'normal'); assert.equal(r.final.reverse_first_sell_done, false);
});

test('격리 DB: 권한·계좌 잠금·교차 작업 1초 간격·체결과 전략의 원자적 중복 방지', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(readFileSync('supabase/schema.sql','utf8'));
    await db.exec(readFileSync('supabase/migrations/20261102135702_meritz_trading.sql','utf8'));
    const owner = crypto.randomUUID(), other = crypto.randomUUID();
    assert.equal((await db.query<{ok:boolean}>(`select acquire_meritz_lock('account',$1) ok`,[owner])).rows[0].ok,true);
    assert.equal((await db.query<{ok:boolean}>(`select acquire_meritz_lock('account',$1) ok`,[other])).rows[0].ok,false);
    const slot1 = (await db.query<{slot:Date}>(`select reserve_meritz_call('account',$1) slot`,[owner])).rows[0].slot;
    await db.query(`select release_meritz_lock('account',$1)`,[owner]);
    assert.equal((await db.query<{ok:boolean}>(`select acquire_meritz_lock('account',$1) ok`,[other])).rows[0].ok,true);
    const slot2 = (await db.query<{slot:Date}>(`select reserve_meritz_call('account',$1) slot`,[other])).rows[0].slot;
    assert.ok(new Date(slot2).getTime()-new Date(slot1).getTime()>=1000);
    await db.exec('set role anon');
    await assert.rejects(db.exec('select * from meritz_links'),/permission denied/);
    await db.exec('reset role');
    await db.query(`insert into strategies(id,name,symbol,split_count,principal,cash_balance,position_qty,avg_price,t_value,started_at)
      values($1,'테스트','SOXL',20,126000,63000,100,120,10,'2026-10-01')`,[strategy.id]);
    const current = (await db.query<Strategy>('select * from strategies where id=$1',[strategy.id])).rows[0];
    const day = crypto.randomUUID();
    await db.query(`insert into meritz_links(strategy_id,account_key,symbol,sync_from) values($1,'account','SOXL','2026-11-02')`,[strategy.id]);
    await db.query(`insert into meritz_days(id,strategy_id,session_date,baseline,guide) values($1,$2,'2026-11-02',$3,$4)`,[day,strategy.id,JSON.stringify(current),JSON.stringify(guideWith([base]))]);
    const payload=buildBrokerCommit(current,guideWith([base]),[fill],'2026-11-02',80);
    const params=[day,'account',current.version,JSON.stringify([fill]),JSON.stringify(payload.executions),JSON.stringify(payload.snapshots),JSON.stringify(payload.final),null];
    const sql='select commit_meritz_day($1,$2,$3,$4,$5,$6,$7,$8)';
    await db.query(sql,params); await db.query(sql,params);
    assert.equal(Number((await db.query<{n:number}>('select count(*) n from executions')).rows[0].n),1);
    assert.equal(Number((await db.query<{n:number}>('select count(*) n from meritz_fill_claims')).rows[0].n),1);
    const after=(await db.query<Strategy>('select * from strategies where id=$1',[strategy.id])).rows[0];
    assert.equal(Number(after.position_qty),165); assert.equal(Number(after.t_value),11);
    await assert.rejects(db.query(sql,[...params.slice(0,3),JSON.stringify([{...fill,amount:5300}]),...params.slice(4)]),/BROKER_FILL_CHANGED/);
  } finally { await db.close(); }
});
