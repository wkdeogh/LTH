import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as trading from '@/lib/trading';
import * as types from '@/lib/types';
import { STRATEGY_ID, requireStrategyId } from '@/lib/strategyConfig';

// Run the actual server actions with an in-memory DB. Never read credentials,
// connect to production, or invoke the brokerage from these regressions.
function harness(overrides: Partial<types.Strategy> = {}) {
  const strategy: types.Strategy = {
    id: STRATEGY_ID, name: '테스트', symbol: 'SOXL', split_count: 20,
    principal: 20000, cash_balance: 1000, position_qty: 200, avg_price: 40,
    t_value: 19.7734375, mode: 'normal', reverse_started_at: null,
    reverse_first_sell_done: false, compounding_type: 'compound', is_archived: false,
    version: 1, started_at: '2026-11-01', created_at: '', updated_at: '', ...overrides,
  };
  const controls = { close: 34.01, pending: false, conflict: false };
  let writes = 0;
  const db = { from(table: string) {
    const filters: ((row: types.Strategy) => boolean)[] = [];
    let update: Partial<types.Strategy> | undefined;
    const query = {
      select: () => query, limit: () => query, in: () => query,
      eq: (key: keyof types.Strategy, value: unknown) => {
        filters.push(row => row[key] === value); return query;
      },
      update: (value: Partial<types.Strategy>) => { update = value; return query; },
      single: () => query, maybeSingle: () => query,
      then(resolve: (result: unknown) => unknown) {
        if (table === 'meritz_days') return Promise.resolve({ data: controls.pending ? [{ id: 'pending' }] : [], error: null }).then(resolve);
        assert.equal(table, 'strategies');
        if (update && controls.conflict) { strategy.version++; controls.conflict = false; }
        const matches = filters.every(filter => filter(strategy));
        if (update && matches) { Object.assign(strategy, update); strategy.version++; writes++; }
        return Promise.resolve({ data: matches ? structuredClone(strategy) : null, error: null }).then(resolve);
      },
    };
    return query;
  } };
  const code = ts.transpileModule(readFileSync('src/app/actions.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  const dependencies: Record<string, unknown> = {
    '@/lib/access/server': { requireAppAccess: async () => {} },
    '@/lib/supabase/server': { createSupabaseServerClient: () => db },
    '@/lib/marketData/references': { loadStrategyReferences: async () => [{ price: controls.close }] },
    '@/lib/date': { koreaDate: () => '2026-11-12' },
    '@/lib/notices': { withNotice: (path: string, notice: string) => `${path}?notice=${notice}` },
    '@/lib/types': types, '@/lib/trading': trading,
    '@/lib/strategyConfig': { STRATEGY_ID, requireStrategyId },
    'next/cache': { revalidatePath: () => {} },
    'next/navigation': { redirect: (path: string) => { throw Error(`redirect:${path}`); } },
  };
  const wrapper = runInNewContext(`(function(exports,require,module){${code}\n})`, { Date, Error });
  wrapper(module.exports, (id: string) => dependencies[id] ?? {}, module);
  const actions = module.exports as typeof import('./actions');
  async function transition(mode: 'normal' | 'reverse', automatic = true) {
    const form = new FormData();
    form.set('id', STRATEGY_ID);
    if (automatic) form.set('automatic', '1');
    await assert.rejects(mode === 'normal' ? actions.switchToNormal(form) : actions.switchToReverse(form), /^Error: redirect:/);
  }
  return { strategy, controls, transition, writes: () => writes };
}

test('실제 전환 액션: T=19.77에서 반복·이전 화면 요청에도 리버스 첫 매도 상태를 유지한다', async () => {
  const h = harness();
  await h.transition('reverse');
  for (let visit = 0; visit < 5; visit++) {
    await h.transition('normal');
    await h.transition('reverse');
  }
  assert.equal(h.strategy.mode, 'reverse');
  assert.equal(h.strategy.reverse_first_sell_done, false);
  assert.equal(h.strategy.t_value, 19.7734375);
  assert.equal(h.writes(), 1);
});

test('자동 전환은 최신 T·종가·첫 매도 완료를 다시 검사하고 수동 전환을 유지한다', async () => {
  const normal = harness({ t_value: 19 });
  await normal.transition('reverse');
  assert.equal(normal.writes(), 0);
  const reverse = harness({ mode: 'reverse', t_value: 17.8, reverse_first_sell_done: true });
  reverse.controls.close = 32;
  await reverse.transition('normal');
  assert.equal(reverse.writes(), 0);
  reverse.controls.close = 32.01;
  await reverse.transition('normal');
  assert.equal(reverse.strategy.mode, 'normal');
  assert.equal(reverse.writes(), 1);
  const manual = harness({ mode: 'reverse' });
  await manual.transition('normal', false);
  assert.equal(manual.strategy.mode, 'normal');
});

test('중복 리버스 요청은 첫 매도 완료 기록을 초기화하지 않는다', async () => {
  const h = harness({ mode: 'reverse', reverse_first_sell_done: true });
  await h.transition('reverse');
  assert.equal(h.strategy.reverse_first_sell_done, true);
  assert.equal(h.writes(), 0);
});

test('미처리 브로커 거래일과 동시 상태 변경이 있으면 모드 전환을 저장하지 않는다', async () => {
  const pending = harness({ mode: 'reverse', reverse_first_sell_done: true });
  pending.controls.pending = true;
  await pending.transition('normal');
  assert.equal(pending.writes(), 0);
  for (const mode of ['normal', 'reverse'] as const) {
    const h = harness({ mode: mode === 'normal' ? 'reverse' : 'normal', reverse_first_sell_done: true });
    h.controls.conflict = true;
    await h.transition(mode);
    assert.equal(h.writes(), 0);
  }
});
