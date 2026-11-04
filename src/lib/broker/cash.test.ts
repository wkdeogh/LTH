import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { MeritzClient } from './meritz';
import { calculateBrokerWithdrawal } from '@/lib/trading/brokerCash';
import { toStrategyState, type Strategy } from '@/lib/types';
import { buildBrokerCommit, type BrokerFill } from './reconciliation';
import { strategyGuide } from './policy';

const id = '30f945f0-c589-48ab-8136-424abaf5986e';
const migration = 'supabase/migrations/20261104230234_meritz_cash_reconciliation.sql';
async function fixture(run: (db: PGlite) => Promise<void>) {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(readFileSync('supabase/schema.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/20261102135702_meritz_trading.sql', 'utf8'));
    await db.exec(readFileSync(migration, 'utf8'));
    await db.query("insert into strategies(id,name,symbol,split_count,principal,cash_balance,position_qty,avg_price,t_value,started_at) values($1,'현금 테스트','SOXL',20,10000,5000,100,50,10,'2026-10-01')", [id]);
    await db.query("insert into meritz_links(strategy_id,account_key,symbol,sync_from) values($1,'account','SOXL','2026-11-02')", [id]);
    await run(db);
  } finally { await db.close(); }
}
async function strategy(db: PGlite) { return (await db.query<Strategy>('select * from strategies where id=$1', [id])).rows[0]; }
const syncSql = "select sync_meritz_cash($1,'account',$2,$3,'2026-11-02','meritz_withdrawal')";

test('현금 -5% 경계와 누적 감소: 현재 주가 없이 기존 T의 투입 단위를 보존한다', () => {
  const state = { principal: 10000, cashBalance: 5000, positionQty: 100, avgPrice: 50, tValue: 10, splitCount: 20 } as ReturnType<typeof toStrategyState>;
  assert.equal(calculateBrokerWithdrawal(state, 4750.0001), null);
  const r = calculateBrokerWithdrawal(state, 4750)!;
  assert.equal(r.principal, 9750); assert.equal(r.tValue, 10.2564102564);
  assert.equal(calculateBrokerWithdrawal(state, 4800), null);
  assert.equal(calculateBrokerWithdrawal(state, 4700)!.amount, -300);
  assert.equal(calculateBrokerWithdrawal({ ...state, cashBalance: 0 }, 0), null);
  assert.equal(calculateBrokerWithdrawal(state, 5100), null);
  assert.equal(calculateBrokerWithdrawal({ ...state, tValue: 7.5, avgPrice: 150 }, 4000)!.tValue, 8.3333333333);
  assert.throws(() => calculateBrokerWithdrawal({ ...state, principal: 100 }, 0), /원금/);
});

test('예수금 API는 미결제 반영 추정 USD 현금을 사용하고 누락·음수·중복은 거절한다', async () => {
  const balance = async (data: unknown, rsp_cd = '5766') => {
    const client = new MeritzClient({ key: 'key', secret: 'secret', wait: async () => {},
      fetcher: (async input => new Response(JSON.stringify(String(input).includes('/oauth2/')
        ? { access_token: 'token' } : { rsp_cd, data }))) as typeof fetch });
    return client.cashBalance();
  };
  assert.equal(await balance([{ crcd: 'USD', frcr_amt: '5000', estm_frcr_amt: '11205' }]), 11205);
  for (const data of [[], [{ crcd: 'KRW', estm_frcr_amt: '1' }], [{ crcd: 'USD' }],
    [{ crcd: 'USD', estm_frcr_amt: '' }], [{ crcd: 'USD', estm_frcr_amt: '-1' }],
    [{ crcd: 'USD', estm_frcr_amt: 'NaN' }], [{ crcd: 'USD', estm_frcr_amt: 0 }, { crcd: 'USD', estm_frcr_amt: 0 }]]) {
    await assert.rejects(balance(data), /USD/);
  }
  assert.equal(await balance([{ crcd: 'USD', estm_frcr_amt: '0' }]), 0);
  await assert.rejects(balance([{ crcd: 'USD', estm_frcr_amt: '1' }], '5762'), /완료/);
});

test('DB: 인출 T 재산정·재시도·오래된 버전·공개 역할 차단', async () => fixture(async db => {
  let s = await strategy(db);
  await db.query(syncSql, [id, s.version, 4750.0001]);
  assert.equal((await strategy(db)).version, s.version);
  await db.query(syncSql, [id, s.version, 4750]);
  let after = await strategy(db);
  assert.equal(Number(after.principal), 9750); assert.equal(Number(after.cash_balance), 4750);
  assert.equal(Number(after.t_value), 10.2564102564); assert.equal(after.position_qty, 100);
  assert.equal(Number(after.avg_price), 50);
  assert.equal(calculateBrokerWithdrawal(toStrategyState(s), 4750)!.tValue, Number(after.t_value));
  await assert.rejects(db.query(syncSql, [id, s.version, 4500]), /STALE_STRATEGY/);
  await db.query(syncSql, [id, after.version, 4750]);
  assert.equal(Number((await db.query<{ n: string }>('select count(*) n from strategy_cash_flows')).rows[0].n), 1);
  await db.exec('set role anon');
  await assert.rejects(db.query(syncSql, [id, after.version, 4000]), /permission denied/);
  await db.exec('reset role');

}));

test('DB: 라운드 매매손익과 현금 증가를 분리하고 예약 입금을 이중 반영하지 않는다', async () => fixture(async db => {
  let s = await strategy(db);
  const flow = crypto.randomUUID();
  await db.query("select record_strategy_cash_flow($1,$2,$3,'2026-11-02',200,'next_round',null,'예약 입금')", [id, flow, s.version]);
  s = await strategy(db);
  const day = crypto.randomUUID();
  const guide = strategyGuide(s, 60);
  await db.query("insert into meritz_days(id,strategy_id,session_date,baseline,guide) values($1,$2,'2026-11-02',$3,$4)", [day, id, JSON.stringify(s), JSON.stringify(guide)]);
  const fill: BrokerFill = { orderDate: '20261103', orderNo: '123', fillNo: '1', symbol: 'SOXL', side: 'sell',
    orderType: 'LIMIT', quantity: 100, orderQuantity: 100, amount: 6000, price: 60, limitPrice: 60, time: '2026-11-03 05:00:00' };
  const payload = buildBrokerCommit(s, guide, [fill], '2026-11-02', 60);
  const final = { ...payload.final, broker_cash: { amount: 11205, date: '2026-11-02' } };
  const args = [day, 'account', s.version, JSON.stringify([fill]), JSON.stringify(payload.executions), JSON.stringify(payload.snapshots), JSON.stringify(final), JSON.stringify(payload.round)];
  const commit = 'select commit_meritz_day($1,$2,$3,$4,$5,$6,$7,$8)';
  await db.query(commit, args);
  await db.query(commit, args);
  const after = await strategy(db);
  assert.equal(Number(after.principal), 11205); assert.equal(Number(after.cash_balance), 11205);
  assert.equal(after.position_qty, 0); assert.equal(Number(after.t_value), 0);
  const round = (await db.query<{ ending_cash_balance: string; profit_amount: string }>('select * from completed_rounds')).rows[0];
  assert.equal(Number(round.ending_cash_balance), 11000); assert.equal(Number(round.profit_amount), 1000);
  const flows = (await db.query<{ amount: string; status: string; source: string }>('select * from strategy_cash_flows order by created_at')).rows;
  assert.equal(flows.length, 2); assert.equal(flows[0].status, 'applied');
  assert.equal(Number(flows[1].amount), 5); assert.equal(flows[1].source, 'meritz_round');
  assert.equal(Number((await db.query<{ n: string }>('select count(*) n from executions')).rows[0].n), 1);
}));

test('DB: 잘못된 종료 현금이면 체결·라운드·이력 모두 롤백된다', async () => fixture(async db => {
  const s = await strategy(db), day = crypto.randomUUID(), guide = strategyGuide(s, 60);
  await db.query("insert into meritz_days(id,strategy_id,session_date,baseline,guide) values($1,$2,'2026-11-02',$3,$4)", [day, id, JSON.stringify(s), JSON.stringify(guide)]);
  const fill: BrokerFill = { orderDate: '20261103', orderNo: '123', fillNo: '1', symbol: 'SOXL', side: 'sell',
    orderType: 'LIMIT', quantity: 100, orderQuantity: 100, amount: 6000, price: 60, limitPrice: 60, time: '2026-11-03 05:00:00' };
  const payload = buildBrokerCommit(s, guide, [fill], '2026-11-02', 60);
  await assert.rejects(db.query('select commit_meritz_day($1,$2,$3,$4,$5,$6,$7,$8)', [day, 'account', s.version,
    JSON.stringify([fill]), JSON.stringify(payload.executions), JSON.stringify(payload.snapshots),
    JSON.stringify({ ...payload.final, broker_cash: { amount: -1, date: '2026-11-02' } }), JSON.stringify(payload.round)]), /INVALID_BROKER_CASH/);
  assert.equal((await strategy(db)).version, s.version);
  for (const table of ['executions', 'completed_rounds', 'meritz_fill_claims', 'strategy_cash_flows']) {
    assert.equal(Number((await db.query<{ n: string }>('select count(*) n from ' + table)).rows[0].n), 0);
  }
}));

test('DB: 인출로 리버스 경계를 넘으면 새 모드를 적용하고, 이후 인출에도 평단·첫 매도를 보존한다', async () => fixture(async db => {
  await db.query('update strategies set t_value=19 where id=$1', [id]);
  let s = await strategy(db);
  await db.query(syncSql, [id, s.version, 4750]);
  s = await strategy(db);
  assert.equal(s.mode, 'reverse'); assert.equal(s.reverse_first_sell_done, false);
  assert.equal(new Date(s.reverse_started_at!).toISOString().slice(0, 10), '2026-11-02');
  await db.query('update strategies set reverse_first_sell_done=true where id=$1', [id]);
  s = await strategy(db);
  await db.query(syncSql, [id, s.version, 4500]);
  const after = await strategy(db);
  assert.equal(after.mode, 'reverse'); assert.equal(after.reverse_first_sell_done, true);
  assert.equal(Number(after.avg_price), 50); assert.equal(after.position_qty, 100);
}));

test('DB: 직접 입력한 전량매도를 대조할 때 현금 감소만 별도 기록하고 중복 대조하지 않는다', async () => fixture(async db => {
  let s = await strategy(db);
  const day = crypto.randomUUID(), guide = strategyGuide(s, 60);
  await db.query("insert into meritz_days(id,strategy_id,session_date,baseline,guide) values($1,$2,'2026-11-02',$3,$4)", [day, id, JSON.stringify(s), JSON.stringify(guide)]);
  const fill: BrokerFill = { orderDate: '20261103', orderNo: '123', fillNo: '1', symbol: 'SOXL', side: 'sell',
    orderType: 'LIMIT', quantity: 100, orderQuantity: 100, amount: 6000, price: 60, limitPrice: 60, time: '2026-11-03 05:00:00' };
  const payload = buildBrokerCommit(s, guide, [fill], '2026-11-02', 60);
  await db.query("select commit_strategy_execution($1,$2,$3,'{}',$4,$5,$6,$7,'{}')", [id, crypto.randomUUID(), s.version,
    JSON.stringify(payload.executions), JSON.stringify(payload.snapshots), JSON.stringify(payload.final), JSON.stringify(payload.round)]);
  s = await strategy(db);
  const match = 'select match_meritz_day($1,$2,$3,$4,$5)';
  const args = [day, 'account', s.version, JSON.stringify([fill]), 10998.5];
  await db.query(match, args);
  assert.equal(Number((await strategy(db)).principal), 10998.5);
  const flow = (await db.query<{ source: string; amount: string }>('select * from strategy_cash_flows')).rows[0];
  assert.equal(flow.source, 'meritz_round'); assert.equal(Number(flow.amount), -1.5);
  const after = await strategy(db);
  await db.query(match, [day, 'account', after.version, JSON.stringify([fill]), 10998.5]);
  assert.equal((await strategy(db)).version, after.version);
  assert.equal(Number((await db.query<{ n: string }>('select count(*) n from completed_rounds')).rows[0].n), 1);
  assert.equal(Number((await db.query<{ n: string }>('select count(*) n from strategy_cash_flows')).rows[0].n), 1);
}));
