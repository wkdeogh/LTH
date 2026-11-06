import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { STRATEGY_ID } from '@/lib/strategyConfig';
import * as calendar from '../calendar';
import * as meritz from '../meritz';
import * as repricing from '../repricing-policy';
import { pollRead } from '../polling';
import { strategyGuide } from '../policy';

// Execute the actual server modules against an in-memory Data API and a fake
// brokerage. No environment file, production DB, network or real timer is used.
type Row = Record<string, any>;
export function harness() {
  let now = Date.parse('2026-11-06T13:00:00Z');
  const tables: Record<string, Row[]> = {
    strategies: [{ id: STRATEGY_ID, name: '테스트', symbol: 'SOXL', split_count: 20, principal: 10000,
      cash_balance: 5000, position_qty: 100, avg_price: 50, t_value: 10, mode: 'normal', version: 1,
      reverse_started_at: null, reverse_first_sell_done: false, compounding_type: 'compound',
      is_archived: false, started_at: '2026-10-01', created_at: '', updated_at: '' }],
    meritz_links: [{ strategy_id: STRATEGY_ID, account_key: 'account', symbol: 'SOXL', auto_enabled: true,
      active_from: '2026-11-01', sync_from: '2026-11-01' }],
  };
  const history: Row[] = [], notices: Row[] = [], writes: Row[] = [], rpcCalls: Row[] = [], requests: string[] = [];
  const faults = { lock: false, reviewSave: false, acceptedSave: false, cancelNumber: 0, candles: false, notificationMs: 0 };
  let cancelCalls = 0, acceptedSaves = 0, refreshes = 0;
  const clone = <T>(value: T): T => structuredClone(value);
  const strategy = () => tables.strategies[0];
  const time = { clock: () => now, wait: async (ms: number) => { now += ms; } };
  function from(table: string) {
    const filters: ((row: Row) => boolean)[] = [];
    let action = 'select', body: Row | undefined, one = false;
    const q: any = {
      select: () => q, returns: () => q, order: () => q, limit: () => q,
      eq: (key: string, value: unknown) => { filters.push(r => r[key] === value); return q; },
      is: (key: string, value: unknown) => { filters.push(r => (r[key] ?? null) === value); return q; },
      in: (key: string, values: unknown[]) => { filters.push(r => values.includes(r[key])); return q; },
      lt: (key: string, value: string) => { filters.push(r => r[key] < value); return q; },
      gt: (key: string, value: string) => { filters.push(r => r[key] > value); return q; },
      gte: (key: string, value: string) => { filters.push(r => r[key] >= value); return q; },
      single: () => { one = true; return q; }, maybeSingle: () => { one = true; return q; },
      update: (value: Row) => { action = 'update'; body = value; return q; },
      insert: (value: Row) => { action = 'insert'; body = value; return q; },
      upsert: (value: Row) => { action = 'upsert'; body = value; return q; },
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve().then(() => {
          const rows = tables[table] ??= [];
          let selected = rows.filter(r => filters.every(f => f(r)));
          if (table === 'meritz_orders' && action === 'update' && body?.status === 'accepted'
            && faults.acceptedSave && acceptedSaves++ === 0) return { data: null, error: { message: '저장 실패' } };
          if (table === 'meritz_reprices' && action === 'update' && body?.status === 'review' && faults.reviewSave) return { data: null, error: { message: '저장 실패' } };
          if (action === 'insert' || action === 'upsert') {
            let existing = action === 'upsert' ? rows.find(r => body?.id ? r.id === body.id
              : r.strategy_id === body?.strategy_id && r.session_date === body?.session_date) : undefined;
            if (!existing) { existing = { id: `row-${rows.length}`, ...(table === 'meritz_days' ? { status: 'pending' } : {}), ...clone(body) }; rows.push(existing); }
            selected = [existing];
          }
          if (action === 'update') for (const row of selected) Object.assign(row, clone(body));
          if (action !== 'select') writes.push({ table, action, body: clone(body), rows: clone(selected) });
          return { data: clone(one ? selected[0] ?? null : selected), error: null };
        }).then(resolve, reject);
      },
    };
    return q;
  }
  const db = { from, async rpc(name: string, args: Row) {
    rpcCalls.push({ name, args: clone(args) });
    const day = (tables.meritz_days ?? []).find(d => d.id === args.p_day);
    if (name === 'commit_meritz_day') {
      Object.assign(strategy(), args.p_final); strategy().version++;
      if (args.p_final.broker_cash) { strategy().principal = strategy().cash_balance = args.p_final.broker_cash.amount; }
      (tables.executions ??= []).push(...args.p_executions.map((e: Row) => ({ ...e, strategy_id: STRATEGY_ID })));
      Object.assign(day!, { status: 'applied', broker_fills: clone(args.p_fills) });
    } else if (name === 'match_meritz_day') Object.assign(day!, { status: 'matched' });
    else throw Error(`Unexpected RPC: ${name}`);
    return { data: {}, error: null };
  } };
  const client = {
    clean: (value: unknown) => String(value), lastPageCount: 1, lastPageSize: 100,
    remainingMs: () => 240000, estimatedRequestMs: () => 1100,
    assertTimeRemaining: (_required = 0) => {},
    assertMarketOpen: async () => {}, currentPrice: async () => 50,
    async rows(path: string, params: Row = {}) {
      requests.push(path);
      if (path.endsWith('/history')) return clone(history.filter(row => String(row.oder_date) >= params.oder_sta_date && String(row.oder_date) <= params.oder_fin_date));
      if (path.endsWith('/detail')) return clone(history.filter(row => String(row.oder_no) === params.oder_no).map(row => ({ ...row, cntg_no: '1', cntg_ymdh: row.oder_exec_ymdh })));
      if (path.endsWith('/today')) return clone(history.flatMap(row => row.cancelled ? [
        { ...row, odqt: row.oder_dqty, cntg_qty: 0, cncl_cnfr_qty: 0, rctf_cnfr_qty: 0, ncnt_qty: 0, oder_able_qty: 0 },
        { ...row, odqt: row.oder_dqty, oder_no: Number(row.oder_no) + 1000, orgl_oder_no: row.oder_no,
          oder_rctf_cncl_cls_code: '2', rctf_cncl_cls_code: '3', cntg_qty: 0, cncl_cnfr_qty: Number(row.oder_dqty), rctf_cnfr_qty: 0, ncnt_qty: 0, oder_able_qty: 0 },
      ] : [{ ...row, odqt: row.oder_dqty, cntg_qty: Number(row.cntg_dqty), cncl_cnfr_qty: 0, rctf_cnfr_qty: 0, ncnt_qty: Number(row.oder_dqty), oder_able_qty: Number(row.oder_dqty) }]));
      if (path.endsWith('/holdings')) return [{ iscd: 'SOXL.AX', rmnd_clcd: '1', rmnd_dqty: strategy().position_qty, seln_able_dqty: strategy().position_qty }];
      if (path.endsWith('/estimate')) return [{ crcd: 'USD', oder_crnc_oder_able_camt: strategy().cash_balance }];
      throw Error(`Unexpected brokerage read: ${path}`);
    },
    async call(path: string, _params: Row, body: Row) {
      requests.push(path);
      if (path.endsWith('/cancel')) {
        cancelCalls++;
        if (cancelCalls === faults.cancelNumber) return { rsp_cd: '0002', data: { warn_cls_code: '0' } };
        history.find(r => String(r.oder_no) === String(body.orgl_oder_no))!.cancelled = true;
        return { rsp_cd: '0001', data: { warn_cls_code: '0', oder_no: Number(body.orgl_oder_no) + 1000 } };
      }
      return { rsp_cd: '0001', data: { warn_cls_code: '0', oder_no: 2000 + requests.length } };
    },
  };
  const req = createRequire(process.cwd() + '/src/lib/broker/service.ts');
  const cache = new Map<string, any>();
  class FakeDate extends Date {
    constructor(value?: string | number) { super(value ?? now); }
    static now() { return now; }
  }
  function load(name: string): any {
    if (cache.has(name)) return cache.get(name);
    const module = { exports: {} }; cache.set(name, module.exports);
    const overrides: Record<string, unknown> = {
      'server-only': {}, './meritz': { ...meritz, brokerConfigured: () => true, accountKey: () => 'account' },
      '@/lib/supabase/server': { createSupabaseServerClient: () => db },
      '@/lib/marketData/references': { loadStrategyReferences: async () => [{ price: 50 }] },
      './calendar': { ...calendar,
        nyTime: (date = new Date(now)) => calendar.nyTime(date),
        openingWindow: (date = new Date(now), watchdog = false) => calendar.openingWindow(date, watchdog),
        initialOrderSession: () => calendar.initialOrderSession(new Date(now)),
        manualOrderSession: () => calendar.manualOrderSession(new Date(now)),
        regularSession: () => calendar.regularSession(new Date(now)),
      },
      './notifications': { pushConfigured: () => false, deliverNotifications: async () => {},
        notify: async (key: string, id: string, title: string, body: string, tone: string) => {
          now += faults.notificationMs; notices.push({ key, id, title, body, tone });
        } },
      './cash': { readStrategyCash: async () => 12000, syncStrategyCash: async () => clone(strategy()) },
      '@/lib/marketData/candles': { syncMarketData: async (_symbol: string, options: Row) => {
        if (!options.deferTransitions) throw Error('Unexpected mode transition');
        refreshes++; if (faults.candles) throw Error('Yahoo 일시 장애');
        for (const day of tables.meritz_days ?? []) (tables.market_candles ??= []).push({ symbol: 'SOXL', trade_date: day.session_date, close_price: 49 });
      } },
      './polling': { pollRead: (read: any, ready: any, options: Row) => pollRead(read, ready, { ...time, ...options }) },
      './repricing-policy': { ...repricing, cancelThenReplace: (targets: any, deps: any) => repricing.cancelThenReplace(targets, { ...deps, polling: { ...deps.polling, ...time } }) },
    };
    const code = ts.transpileModule(readFileSync(`src/lib/broker/${name}.ts`, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const wrapper = runInNewContext(`(function(exports,require,module){${code}\n})`, {
      Date: FakeDate, process: { env: {} }, crypto: globalThis.crypto, Buffer, console, Error,
    });
    wrapper(module.exports, (id: string) => {
      if (id === './store') return { ...load('store'), withBrokerLock: async (fn: any) => {
        if (faults.lock) throw Error('다른 메리츠 작업이 진행 중입니다.'); return fn(client, 'account');
      } };
      if (id === './watchdog') return load('watchdog');
      if (id === './service') return load('service');
      return Object.hasOwn(overrides, id) ? overrides[id] : req(id);
    }, module);
    return module.exports;
  }
  const addDay = (date: string, status = 'pending'): Row => {
    const day = { id: `day-${date}`, strategy_id: STRATEGY_ID, session_date: date, status,
      baseline: clone(strategy()), guide: strategyGuide(strategy() as any, 50) };
    (tables.meritz_days ??= []).push(day); return day;
  };
  return { tables, history, notices, writes, rpcCalls, requests, faults, client, time, strategy, addDay,
    setNow: (value: string) => { now = Date.parse(value); }, refreshes: () => refreshes,
    service: () => load('service') as typeof import('../service'),
    watchdog: () => load('watchdog') as typeof import('../watchdog'),
    reprice: () => load('repricing') as typeof import('../repricing'),
  };
}
