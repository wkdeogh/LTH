import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { STRATEGY_ID, requireStrategyId } from '@/lib/strategyConfig';
import { buildBrokerCommit, type BrokerFill } from './reconciliation';
import { strategyGuide } from './policy';
import type { Strategy } from '@/lib/types';

test('고정 전략 ID는 기존 SOXL 20분할만 허용한다', () => {
  assert.equal(requireStrategyId(STRATEGY_ID), STRATEGY_ID);
  assert.throws(() => requireStrategyId(crypto.randomUUID()), /SOXL 20분할/);
});

test('DB 단일 전략 전환은 기존 상태·보관 이력을 보존하고 추가 생성·변경·삭제를 막는다', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(readFileSync('supabase/schema.sql', 'utf8'));
    await db.exec('alter table strategies add column sort_order integer not null default 0;');
    await db.exec(readFileSync('supabase/migrations/202609090001_main_strategy.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/20261102135702_meritz_trading.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/20261104230234_meritz_cash_reconciliation.sql', 'utf8'));
    const archived = crypto.randomUUID();
    await db.query("insert into strategies(id,name,symbol,split_count,principal,cash_balance,is_archived) values($1,'과거 TQQQ','TQQQ',40,1000,1000,true)", [archived]);
    await db.query("insert into strategies(id,name,symbol,split_count,principal,cash_balance,position_qty,avg_price,t_value,started_at) values($1,'SOXL 20분할','SOXL',20,10000,5000,100,50,10,'2026-10-01')", [STRATEGY_ID]);
    const load = async () => (await db.query<Strategy>('select * from strategies where id=$1', [STRATEGY_ID])).rows[0];
    const before = await load();
    await db.exec(readFileSync('supabase/migrations/20261104231407_single_soxl_strategy.sql', 'utf8'));
    const after = await load();
    for (const key of ['id','principal','cash_balance','position_qty','avg_price','t_value','mode','started_at','version'] as const) {
      assert.deepEqual(after[key], before[key], key);
    }
    assert.equal(Number((await db.query<{n:string}>('select count(*) n from strategies')).rows[0].n), 2);
    const columns = (await db.query<{column_name:string}>("select column_name from information_schema.columns where table_name='strategies'")).rows.map(r => r.column_name);
    assert.ok(!columns.includes('is_main')); assert.ok(!columns.includes('sort_order'));
    await db.exec('set role service_role');
    for (const sql of [
      "insert into strategies(name,symbol,split_count,principal,cash_balance) values('추가','SOXL',20,1000,1000)",
      "insert into strategies(name,symbol,split_count,principal,cash_balance,is_archived) values('추가','TQQQ',40,1000,1000,true)",
    ]) await assert.rejects(db.exec(sql), /STRATEGY_CREATION_DISABLED/);
    for (const assignment of ["symbol='TQQQ'", 'split_count=40', 'is_archived=true', 'id=gen_random_uuid()']) {
      await assert.rejects(db.query('update strategies set ' + assignment + ' where id=$1', [STRATEGY_ID]), /SOXL_20_STRATEGY_FIXED/);
    }
    await assert.rejects(db.query('update strategies set is_archived=false where id=$1', [archived]), /ARCHIVED_STRATEGY_READ_ONLY/);
    await assert.rejects(db.query('delete from strategies where id=$1', [STRATEGY_ID]), /STRATEGY_DELETE_DISABLED/);
    await assert.rejects(db.query('select set_main_strategy($1::uuid)', [archived]), /does not exist/);
    let current = await load();
    await db.query("select record_strategy_cash_flow($1,$2,$3,'2026-11-02',100,'immediate',50,'입금')", [STRATEGY_ID, crypto.randomUUID(), current.version]);
    current = await load();
    assert.equal(Number(current.cash_balance), 5100);
    await db.query("insert into meritz_links(strategy_id,account_key,symbol,sync_from) values($1,'account','SOXL','2026-11-02')", [STRATEGY_ID]);
    await db.query("select sync_meritz_cash($1,'account',$2,4700,'2026-11-02','meritz_withdrawal')", [STRATEGY_ID, current.version]);
    current = await load();
    assert.equal(Number(current.principal), 9700);
    const day = crypto.randomUUID(), guide = strategyGuide(current, 60);
    await db.query("insert into meritz_days(id,strategy_id,session_date,baseline,guide) values($1,$2,'2026-11-02',$3,$4)", [day, STRATEGY_ID, JSON.stringify(current), JSON.stringify(guide)]);
    const fill: BrokerFill = { orderDate: '20261103', orderNo: '123', fillNo: '1', symbol: 'SOXL', side: 'sell',
      orderType: 'LIMIT', quantity: 100, orderQuantity: 100, amount: 6000, price: 60, limitPrice: 60, time: '2026-11-03 05:00:00' };
    const payload = buildBrokerCommit(current, guide, [fill], '2026-11-02', 60);
    await db.query('select commit_meritz_day($1,$2,$3,$4,$5,$6,$7,$8)', [day, 'account', current.version,
      JSON.stringify([fill]), JSON.stringify(payload.executions), JSON.stringify(payload.snapshots),
      JSON.stringify({ ...payload.final, broker_cash: { amount: 10705, date: '2026-11-02' } }), JSON.stringify(payload.round)]);
    const completed = await load();
    assert.equal(Number(completed.principal), 10705); assert.equal(completed.position_qty, 0);
    assert.equal(Number((await db.query<{n:string}>('select count(*) n from completed_rounds')).rows[0].n), 1);
    await db.exec('reset role');
  } finally { await db.close(); }
});
