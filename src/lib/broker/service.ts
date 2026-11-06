import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Strategy } from '@/lib/types';
import { toStrategyState } from '@/lib/types';
import { brokerDb, captureDay, check, linkStrategy, loadStrategy, withBrokerLock, loadBrokerLink } from './store';
import { accountKey, brokerConfigured, BrokerRequestError, type BrokerRow, type MeritzClient } from './meritz';
import { closeMinute, initialOrderSession, isTradingDay, manualOrderSession, nyTime, openingWindow, regularSession, shiftDate } from './calendar';
import { judgeOrder, matchGuideOrder, orderBody, processGuide, validateOrderBounds, type GuidePlan, type ProcessedGuide } from './policy';
import { fitOrderFunding, fundingSummary, orderCash } from './funding';
import { notify, deliverNotifications, pushConfigured } from './notifications';
import { blocksSessionOrder, brokerSession, buildBrokerCommit, normalizeDetails, recordedFillsMatch, type BrokerFill } from './reconciliation';
import { matchesTrackedOrder, type TrackedOrder } from './repricing-policy';
import { shouldAutoReturnToNormalMode } from '@/lib/trading/reverseMode';
import { readStrategyCash, syncStrategyCash } from './cash';
import { syncMarketData } from '@/lib/marketData/candles';
import { reportBrokerFailure, runBrokerWatchdog } from './watchdog';

export type Snapshot = { strategy: Strategy; guide: GuidePlan; processed: ProcessedGuide };
export type Run = { id: string; strategy_id: string; account_key: string; session_date: string; source: 'manual' | 'auto';
  status: string; snapshot: Snapshot; expires_at: string; submission_price?: number | null; created_at?: string };
function tokenFor(run: Run) {
  return createHmac('sha256', process.env.MERITZ_APP_SECRET!).update(JSON.stringify({ id: run.id,
    expires: run.expires_at, snapshot: run.snapshot })).digest('hex');
}
function publicPreview(run: Run) {
  return { runId: run.id, token: tokenFor(run), expiresAt: run.expires_at, symbol: run.snapshot.strategy.symbol,
    currentPrice: run.snapshot.processed.currentPrice, orders: run.snapshot.processed.orders.map(({ sources, ...o }) => ({ ...o,
      labels: sources.map(s => s.label) })), skipped: run.snapshot.processed.skipped };
}
async function existingHistory(client: MeritzClient, date: string) {
  return client.rows('/trading/v1/overseas/orders/history', { oder_sta_date: date.replaceAll('-', ''),
    oder_fin_date: shiftDate(date, 1).replaceAll('-', ''), cntg_cls_code: '0', seln_byov_clcd: '0' });
}
function symbolOf(row: BrokerRow) { return String(row.ovrs_stck_symb_iscd ?? row.iscd ?? '').split('.')[0]; }

// A single read for the first render; linking and daily capture stay in the
// background status request so the switch never starts with a guessed OFF value.
export async function getBrokerDisplayStatus(id: string) {
  if (!brokerConfigured()) return { configured: false, enabled: false, syncEnabled: false, message: '메리츠 API 키를 설정해 주세요.' };
  const result = await brokerDb().from('meritz_links').select('auto_enabled,active_from,last_error,account_key').eq('strategy_id', id).maybeSingle();
  check(result.error);
  const ready = (process.env.NODE_ENV !== 'production' || Boolean(process.env.APP_PASSWORD))
    && (!result.data || result.data.account_key === accountKey());
  return { configured: true, enabled: result.data?.auto_enabled ?? false,
    activeFrom: result.data?.active_from, syncEnabled: Boolean(result.data),
    lastError: result.data?.last_error, ordersReady: ready };
}

export async function getBrokerStatus(id: string) {
  if (!brokerConfigured()) return { configured: false, enabled: false, syncEnabled: false, message: '메리츠 API 키를 설정해 주세요.' };
  if (process.env.NODE_ENV === 'production' && !process.env.APP_PASSWORD) return { configured: true, enabled: false,
    syncEnabled: false, ordersReady: false, message: '앱 접속 비밀번호(APP_PASSWORD)를 설정해 주세요.' };
  const strategy = await loadStrategy(id);
  const link = await linkStrategy(strategy);
  // Linking enables reconciliation independently of the automatic-order switch.
  if (isTradingDay(nyTime().date)) await captureDay(strategy);
  const runs = await brokerDb().from('meritz_runs').select('id,session_date,source,status,created_at')
    .eq('strategy_id', id).order('created_at', { ascending: false }).limit(4); check(runs.error);
  return { configured: true, enabled: link.auto_enabled, activeFrom: link.active_from,
    syncEnabled: true, lastSyncAt: link.last_sync_at, lastError: link.last_error,
    pushConfigured: pushConfigured(), publicPushKey: process.env.VAPID_PUBLIC_KEY ?? null, runs: runs.data ?? [],
    ordersReady: process.env.NODE_ENV !== 'production' || Boolean(process.env.APP_PASSWORD) };
}

async function prepareWithClient(id: string, source: 'manual' | 'auto', client: MeritzClient, account: string) {
  if (process.env.NODE_ENV === 'production' && !process.env.APP_PASSWORD) throw new Error('주문 기능을 사용하려면 앱 접속 비밀번호를 설정해 주세요.');
  if (!(source === 'auto' ? initialOrderSession() : manualOrderSession())) throw new Error('자동주문은 한국 22시, 수동 주문은 한국 22시부터 미국 정규장 마감 10분 전까지 가능합니다.');
  const db = brokerDb();
  let strategy = await loadStrategy(id);
  const link = await linkStrategy(strategy);
  const today = nyTime().date;
  await reconcileWithClient(client, account, { onlyRecorded: source !== 'auto', strategyId: id, beforeSession: today });
  strategy = await loadStrategy(id);
  const pending = await db.from('meritz_days').select('id').eq('strategy_id', id).lt('session_date', today).in('status', ['pending','review']).limit(1); check(pending.error);
  if (pending.data?.length) throw new Error('이전 거래일 체결 반영이 끝나지 않았습니다. 먼저 확인해 주세요.');
  if (source === 'auto' && (!link.auto_enabled || !link.active_from || link.active_from > today)) throw new Error('자동매매 적용 대상이 아닙니다.');
  const prior = await db.from('meritz_runs').select('*').eq('strategy_id', id).eq('session_date', today).maybeSingle<Run>(); check(prior.error);
  if (prior.data && !['prepared', 'expired'].includes(prior.data.status)) throw new Error('오늘의 API 주문은 이미 처리되었습니다. 주문내역을 확인해 주세요.');
  if (source === 'auto' && prior.data?.source === 'manual') throw new Error('오늘 수동 API 주문 미리보기가 있어 자동 주문을 보류했습니다.');
  await client.assertMarketOpen(source === 'auto' || !regularSession());
  const history = await existingHistory(client, today);
  if (history.some(row => blocksSessionOrder(row, strategy.symbol, today))) {
    throw new Error('메리츠에 당일 주문이 이미 있습니다. 중복 주문을 막기 위해 제출을 보류했습니다.');
  }
  const price = await client.currentPrice(strategy.symbol);
  strategy = await syncStrategyCash(client, account, strategy, price);
  const day = await captureDay(strategy, today, true);
  if (day.baseline.version !== strategy.version) throw new Error('당일 전략 상태가 변경됐습니다. 체결·입출금 내역을 확인해 주세요.');
  const guide = day.guide as GuidePlan;
  let processed = processGuide(guide, price);
  check((await db.from('meritz_days').update({ quote_price: price, quote_received_at: new Date().toISOString() }).eq('id', day.id).is('quote_price', null)).error);
  const cash = processed.orders.some(order => order.side === 'buy')
    ? orderCash(await client.rows('/trading/v1/overseas/orders/estimate', { intg_marg_iqry_yn: 'N' })) : 0;
  const holdings = await client.rows('/accounts/v1/me/overseas/holdings');
  const holding = holdings.filter(r => symbolOf(r) === strategy.symbol && String(r.rmnd_clcd) === '1');
  const held = holding.reduce((n, r) => n + Number(r.rmnd_dqty), 0);
  if (held !== strategy.position_qty) throw new Error('메리츠 보유수량과 LTH 보유수량이 다릅니다. 먼저 체결·상태를 확인해 주세요.');
  processed = fitOrderFunding(processed, toStrategyState(strategy), cash,
    holding.reduce((n, r) => n + Number(r.seln_able_dqty), 0));
  const snapshot: Snapshot = { strategy, guide, processed };
  const saved = await db.from('meritz_runs').upsert({ id: prior.data?.id ?? crypto.randomUUID(), strategy_id: id,
    account_key: account, session_date: today, source, status: 'prepared', snapshot,
    expires_at: new Date(Date.now() + 120000).toISOString() }, { onConflict: 'strategy_id,session_date' }).select('*').single<Run>(); check(saved.error);
  return saved.data!;
}

export async function prepareOrders(id: string) {
  return withBrokerLock(async (client, account) => publicPreview(await prepareWithClient(id, 'manual', client, account)));
}

async function submitWithClient(run: Run, client: MeritzClient, account: string, refreshedOnce = false): Promise<{ ok: boolean; status: string; accepted: number; total: number; message: string }> {
  const db = brokerDb();
  if (run.account_key !== account || run.status !== 'prepared' || new Date(run.expires_at).getTime() < Date.now()) throw new Error('주문 미리보기가 만료됐습니다. 다시 확인해 주세요.');
  if (!(run.source === 'auto' ? initialOrderSession() : manualOrderSession()) || nyTime().date !== run.session_date) throw new Error('주문 가능한 거래 시간이 아닙니다.');
  const strategy = await loadStrategy(run.strategy_id);
  if (strategy.version !== run.snapshot.strategy.version) throw new Error('전략 상태가 변경됐습니다. 다시 확인해 주세요.');
  await client.assertMarketOpen(run.source === 'auto' || !regularSession());
  let price = await client.currentPrice(strategy.symbol);
  const refreshed = await syncStrategyCash(client, account, strategy, price);
  if (refreshed.version !== strategy.version) {
    check((await db.from('meritz_runs').update({ status: 'expired' }).eq('id', run.id)).error);
    if (run.source === 'auto' && !refreshedOnce) return submitWithClient(await prepareWithClient(run.strategy_id, 'auto', client, account), client, account, true);
    throw new Error('계좌 현금 변동으로 원금과 T값을 갱신했습니다. 새 주문을 확인해 주세요.');
  }
  {
    // Manual confirmation may drop newly unaffordable legs, but never adds or
    // reprices an order beyond the user's approved preview.
    let processed = run.source === 'auto' ? processGuide(run.snapshot.guide, price) : run.snapshot.processed;
    const cash = processed.orders.some(order => order.side === 'buy')
      ? orderCash(await client.rows('/trading/v1/overseas/orders/estimate', { intg_marg_iqry_yn: 'N' })) : 0;
    const holdings = (await client.rows('/accounts/v1/me/overseas/holdings')).filter(r => symbolOf(r) === strategy.symbol && String(r.rmnd_clcd) === '1');
    if (holdings.reduce((n,r) => n + Number(r.rmnd_dqty),0) !== strategy.position_qty) throw new Error('제출 직전 계좌 보유수량이 변경됐습니다.');
    price = await client.currentPrice(strategy.symbol);
    if (run.source === 'auto') processed = processGuide(run.snapshot.guide, price);
    processed = fitOrderFunding(processed, toStrategyState(strategy), cash, holdings.reduce((n,r) => n + Number(r.seln_able_dqty),0));
    run = { ...run, snapshot: { ...run.snapshot, processed } };
  }
  const orders = run.snapshot.processed.orders;
  try { validateOrderBounds(orders, price); }
  catch (error) {
    const expired = await db.from('meritz_runs').update({ status: 'expired' }).eq('id', run.id); check(expired.error);
    throw error;
  }
  // A second history check covers orders placed in MTS while the dialog was open.
  const history = await existingHistory(client, run.session_date);
  if (history.some(row => blocksSessionOrder(row, strategy.symbol, run.session_date))) {
    throw new Error('당일 메리츠 주문이 확인되어 중복 주문을 보류했습니다.');
  }
  const changed = await db.from('meritz_runs').update({ status: 'submitting', submission_price: price, snapshot: run.snapshot }).eq('id', run.id).eq('status', 'prepared').select('id'); check(changed.error);
  if (changed.data?.length !== 1) throw new Error('이미 처리된 주문 요청입니다.');
  const { status, accepted, failure } = await submitOrderBatch(run, strategy, orders, client, account);
  const finished = await db.from('meritz_runs').update({ status }).eq('id', run.id); check(finished.error);
  const buys = orders.filter(o => o.side === 'buy');
  const message = (status === 'accepted' ? orders.length ? `${orders.length}건의 주문이 정상 접수됐습니다. 체결은 장 마감 후 확인합니다.` : '현금·가격 조건에 맞는 주문이 없어 주문을 보내지 않았습니다.'
    : `주문 ${accepted}건 접수, 나머지는 확인이 필요합니다. ${failure}`) + fundingSummary(run.snapshot.processed);
  let notificationWarning = '';
  try {
    await notify(`orders:${run.id}:${status}`, run.strategy_id,
      status === 'accepted' ? `${strategy.symbol} ${orders.length ? `${buys.length ? '매수 ' : ''}주문 접수 완료` : '주문 없음'}` : `${strategy.symbol} 주문 확인 필요`, message,
      status === 'accepted' ? orders.length ? 'success' : 'info' : 'warning');
    await deliverNotifications();
  } catch { notificationWarning = ' 알림 전송은 확인이 필요합니다.'; console.error('주문 결과 알림 저장·전송 실패', run.id); }
  return { ok: status === 'accepted', status, accepted, total: orders.length, message: message + notificationWarning };
}

export async function submitOrderBatch(run: Run, strategy: Strategy, orders: ProcessedGuide['orders'], client: MeritzClient, account: string, prefix = '',
  onAccepted?: (count: number) => void) {
  const db = brokerDb();
  let accepted = 0, rejected = false, unknown = false, failure = '';
  const sessionOpen = () => (prefix ? regularSession() : run.source === 'auto' ? initialOrderSession() : manualOrderSession())
    && nyTime().date === run.session_date;
  for (const order of orders) {
    if (!sessionOpen()) {
      rejected = true; failure = '주문 가능한 거래 시간이 지나 남은 주문을 보내지 않았습니다.'; break;
    }
    if ((prefix || run.source === 'auto') && (await loadStrategy(run.strategy_id)).version !== strategy.version) {
      rejected = true; failure = '전략 상태가 변경돼 남은 자동주문을 중지했습니다.'; break;
    }
    if (run.source === 'auto' || prefix) {
      const link = await db.from('meritz_links').select('auto_enabled,active_from').eq('strategy_id', run.strategy_id).single(); check(link.error);
      if (!link.data?.auto_enabled || !link.data.active_from || link.data.active_from > run.session_date) { rejected = true; failure = '자동매매가 꺼져 남은 주문을 중지했습니다.'; break; }
    }
    const body = orderBody(strategy.symbol, order);
    const saved = await db.from('meritz_orders').insert({ run_id: run.id, account_key: account,
      order_key: prefix + order.key, body, guide_order: order, status: 'submitting', attempted_at: new Date().toISOString() }).select('id').single(); check(saved.error);
    try {
      const response = await client.call(`/trading/v1/overseas/orders/${order.side}`, {}, body, true, () => {
        if (!sessionOpen()) throw new Error('주문 가능한 거래 시간이 지나 전송하지 않았습니다.');
      });
      const state = judgeOrder(response), data = response.data as BrokerRow | undefined;
      const safe = { rsp_cd: response.rsp_cd, rsp_msg: client.clean(response.rsp_msg),
        rsp_sub_msg: client.clean(response.rsp_sub_msg), warn_cls_code: data?.warn_cls_code, warn_msg: client.clean(data?.warn_msg) };
      if (state === 'accepted') { accepted++; onAccepted?.(accepted); }
      const persisted = await db.from('meritz_orders').update({ status: state, response: safe,
        broker_order_no: data?.oder_no ? String(data.oder_no) : null }).eq('id', saved.data!.id); check(persisted.error);
      if (state !== 'accepted') { unknown = state === 'unknown'; rejected = state === 'rejected';
        failure = `${safe.rsp_cd ?? ''} ${safe.rsp_msg} ${safe.rsp_sub_msg} ${safe.warn_msg}`.trim(); break; }
    } catch (error) {
      const notSent = error instanceof BrokerRequestError && !error.requestSent;
      unknown = !notSent; rejected = notSent; failure = client.clean((error as Error).message);
      const savedUnknown = await db.from('meritz_orders').update({ status: notSent ? 'rejected' : 'unknown',
        response: { error: failure, transmission: notSent ? 'not_sent' : 'uncertain' } }).eq('id', saved.data!.id);
      check(savedUnknown.error); break;
    }
  }
  const status = unknown ? 'unknown' : rejected ? accepted ? 'partial' : 'rejected' : 'accepted';
  return { status, accepted, failure };
}

export async function confirmOrders(id: string, confirmation: string) {
  return withBrokerLock(async (client, account) => {
    const r = await brokerDb().from('meritz_runs').select('*').eq('id', id).single<Run>(); check(r.error);
    if (!r.data) throw new Error('주문 미리보기를 찾을 수 없습니다.');
    const expected = tokenFor(r.data);
    if (!/^[0-9a-f]{64}$/.test(confirmation) || !timingSafeEqual(Buffer.from(expected), Buffer.from(confirmation))) throw new Error('주문 확인 정보가 다릅니다. 다시 확인해 주세요.');
    return submitWithClient(r.data, client, account);
  });
}

export async function runOpeningJob(watchdog = false) {
  if (!brokerConfigured()) return { skipped: '메리츠 키 미설정' };
  const time = nyTime();
  if (!openingWindow(new Date(), watchdog)) return { skipped: '22시 주문 시분이 아님' };
  if (watchdog) return runBrokerWatchdog('opening', time.date);
  return withBrokerLock(async (client, account) => {
    const link = await loadBrokerLink(account);
    if (!link) { await deliverNotifications(); return { outcomes: [] }; }
    const outcomes: Record<string, unknown>[] = [];
    const strategy = await loadStrategy(link.strategy_id);
    try {
      if (!watchdog) {
        const day = await captureDay(strategy, time.date, true);
        await client.assertMarketOpen(true);
        const price = await client.currentPrice(strategy.symbol);
        check((await brokerDb().from('meritz_days').update({ quote_price: price, quote_received_at: new Date().toISOString() }).eq('id', day.id).is('quote_price', null)).error);
      }
      if (!link.auto_enabled || !link.active_from || link.active_from > time.date) { await deliverNotifications(); return { outcomes }; }
      const existing = await brokerDb().from('meritz_runs').select('status').eq('strategy_id', strategy.id).eq('session_date', time.date).maybeSingle(); check(existing.error);
      if (existing.data) {
        outcomes.push({ strategy: strategy.id, status: existing.data.status }); await deliverNotifications(); return { outcomes };
      }
      const run = await prepareWithClient(strategy.id, 'auto', client, account);
      outcomes.push({ strategy: strategy.id, ...await submitWithClient(run, client, account) });
    } catch (error) {
      const message = client.clean((error as Error).message);
      await reportBrokerFailure(`opening:${strategy.id}:${time.date}`, `${strategy.symbol} 자동주문 확인 필요`, message, strategy.id);
      outcomes.push({ strategy: strategy.id, error: message });
    }
    await deliverNotifications(); return { outcomes };
  }).catch(async error => {
    await reportBrokerFailure(`opening:${time.date}:job-error`, 'SOXL 자동주문 확인 필요', error);
    throw error;
  });
}

function matchesManualGuide(history: BrokerRow, guide: GuidePlan, price: number) {
  const side = String(history.seln_byov_clcd) === '2' ? 'buy' : 'sell';
  const kind = ({ '2': 'LIMIT', '5': 'LOC', '7': 'MOC' } as Record<string, 'LIMIT' | 'LOC' | 'MOC'>)[String(history.aspr_type_code)];
  const qty = Number(history.oder_dqty ?? history.odqt), limit = Number(history.ovrs_stck_oder_prc);
  return matchGuideOrder(guide, price, { side, orderType: kind, quantity: qty, price: kind === 'MOC' ? null : limit });
}

export async function reconcileBroker() {
  if (!brokerConfigured()) return { skipped: '메리츠 키 미설정' };
  return withBrokerLock((client, account) => reconcileWithClient(client, account));
}
export async function verifyRecordedExecutions(strategyId: string) {
  if (!brokerConfigured()) throw new Error('메리츠 API 키가 설정되지 않았습니다.');
  return withBrokerLock((client, account) => reconcileWithClient(client, account, { onlyRecorded: true, strategyId }));
}
async function reconcileWithClient(client: MeritzClient, account: string, options: { onlyRecorded?: boolean; strategyId?: string; beforeSession?: string } = {}) {
  const db = brokerDb(), now = nyTime();
  const link = await loadBrokerLink(account);
  if (!link) return { results: [] };
  const results: Record<string, unknown>[] = [];
  if (options.strategyId && link.strategy_id !== options.strategyId) throw new Error('진행 중인 SOXL 전략만 대조할 수 있습니다.');
  let strategy = await loadStrategy(link.strategy_id);
  // Reconcile all unresolved captured sessions, even with automatic orders OFF.
  let query = db.from('meritz_days').select('*').eq('strategy_id', strategy.id).gte('session_date', link.sync_from)
    .in('status', ['pending', 'review']);
  if (options.beforeSession) query = query.lt('session_date', options.beforeSession);
  const days = await query.order('session_date').limit(7); check(days.error);
  let recoveredEarlierDay = false, refreshedCandles = false;
  const checkRoundBacklog = async (date: string) => {
    const later = await db.from('meritz_days').select('id').eq('strategy_id', strategy.id)
      .gt('session_date', date).lt('session_date', now.date).in('status', ['pending','review']).limit(1); check(later.error);
    if (later.data?.length) throw new Error('여러 미처리 거래일 사이에 라운드가 종료되어 현금 동기화 순서를 직접 확인해야 합니다.');
  };
  const closingPrice = async (date: string) => {
    const read = () => db.from('market_candles').select('close_price').eq('symbol', strategy.symbol).eq('trade_date', date).maybeSingle();
    let candle = await read(); check(candle.error);
    const valid = () => candle.data && Number.isFinite(Number(candle.data.close_price)) && Number(candle.data.close_price) > 0;
    if (!valid() && !options.onlyRecorded && !refreshedCandles) {
      refreshedCandles = true;
      await syncMarketData(strategy.symbol, { deferTransitions: true });
      candle = await read(); check(candle.error);
    }
    return valid() ? Number(candle.data!.close_price) : null;
  };
  for (const day of days.data ?? []) {
    if (day.session_date > now.date || day.session_date === now.date && now.minute < closeMinute(now.date) + 5) continue;
    let committed = false;
    try {
      strategy = await loadStrategy(link.strategy_id);
      let baseline = day.baseline as Strategy, guide = day.guide as GuidePlan;
      const local = await db.from('executions').select('side,order_type,quantity,total_amount').eq('strategy_id', strategy.id).eq('executed_at', day.session_date); check(local.error);
      if (options.onlyRecorded && !local.data?.length) break;
      const allHistory = (await existingHistory(client, day.session_date)).filter(r => symbolOf(r) === strategy.symbol && brokerSession(r) === day.session_date);
      if (allHistory.some(r => String(r.oder_rctf_cncl_cls_code) !== '0' && Number(r.cntg_dqty ?? r.cntg_qty) > 0)) {
        throw new Error('정정·취소 주문에 체결이 있어 원주문 연결과 T값 확인이 필요합니다.');
      }
      const history = allHistory.filter(r => String(r.oder_rctf_cncl_cls_code) === '0');
      const run = await db.from('meritz_runs').select('id,snapshot,status').eq('strategy_id', strategy.id).eq('session_date', day.session_date).maybeSingle(); check(run.error);
      const apiOrders = run.data ? await db.from('meritz_orders').select('*').eq('run_id', run.data.id) : { data: [], error: null }; check(apiOrders.error);
      // A blocked opening can capture an empty day with the preceding day's
      // stale baseline. Rebase only a proven untouched pending day after recovery.
      if (!options.onlyRecorded && recoveredEarlierDay && day.status === 'pending'
        && baseline.version !== strategy.version && !run.data && !local.data?.length && !allHistory.length) {
        const refreshed = await captureDay(strategy, day.session_date, true);
        baseline = refreshed.baseline as Strategy; guide = refreshed.guide as GuidePlan;
      }
      // Recover only an unambiguous, exact request match; never blindly resend.
      for (const order of apiOrders.data ?? []) {
        if (!['unknown', 'submitting'].includes(order.status)) continue;
        const matches = history.filter(r => matchesTrackedOrder(order as TrackedOrder, r, true));
        if (matches.length !== 1) throw new Error('접수 여부가 불명확한 주문을 확인해 주세요. 자동 재주문하지 않았습니다.');
        const brokerStatus = String(matches[0].ovrs_stck_oder_stat_cls_code);
        if (!['0','1','2','3','4'].includes(brokerStatus)) throw new Error('메리츠 주문 상태를 확인하지 못했습니다.');
        order.broker_order_no = String(matches[0].oder_no);
        const recovered = await db.from('meritz_orders').update({ broker_order_no: order.broker_order_no,
          broker_order_date: String(matches[0].oder_date), status: ['1','2','4'].includes(brokerStatus) ? 'rejected' : 'accepted' }).eq('id', order.id); check(recovered.error);
      }
      for (const order of apiOrders.data ?? []) {
        if (!order.broker_order_no || order.broker_order_date || order.status === 'rejected') continue;
        const matches = history.filter(r => matchesTrackedOrder(order as TrackedOrder, r));
        if (matches.length !== 1) throw new Error('주문번호의 거래일 연결을 확인하지 못했습니다.');
        order.broker_order_date = String(matches[0].oder_date);
        check((await db.from('meritz_orders').update({ broker_order_date: order.broker_order_date }).eq('id', order.id)).error);
      }
      const fills: BrokerFill[] = [];
      let buyCompletesUnit = false;
      for (const row of history) {
        if (!Number(row.cntg_dqty ?? row.cntg_qty)) continue;
        const tracked = (apiOrders.data ?? []).find(o => o.broker_order_no === String(row.oder_no) && o.broker_order_date === String(row.oder_date));
        const reference = run.data?.snapshot?.processed?.currentPrice ?? day.quote_price ?? (guide.kind === 'normal' ? guide.buyPrice : guide.referencePrice) ?? 0;
        const match = local.data?.length ? null : tracked?.guide_order ?? matchesManualGuide(row, guide, Number(reference));
        if (!local.data?.length && !match) throw new Error('수동 주문의 가격·수량이 가이드와 달라 T값 확인이 필요합니다.');
        if (String(row.seln_byov_clcd) === '2' && match?.sources.some((s: { completesBuyUnit?: boolean }) => s.completesBuyUnit)) buyCompletesUnit = true;
        const details = await client.rows('/trading/v1/overseas/orders/detail', { oder_sta_date: String(row.oder_date), oder_no: String(row.oder_no) });
        fills.push(...normalizeDetails(details, row, { recordedManually: Boolean(local.data?.length) }));
      }
      if (!fills.length) {
        if (local.data?.length) throw new Error('이미 입력한 체결은 있지만 메리츠 체결을 확인하지 못했습니다.');
        const current = await loadStrategy(strategy.id);
        const close = current.mode === 'reverse' ? await closingPrice(day.session_date) : null;
        if (current.version !== baseline.version) throw new Error('전략 상태가 변경되어 미체결·모드 복귀 확인이 필요합니다.');
        if (current.mode === 'reverse' && close === null) throw new Error('해당 거래일 종가가 없어 리버스 복귀 여부를 확인하지 못했습니다.');
        if (close !== null && shouldAutoReturnToNormalMode(toStrategyState(current), close)) {
          check((await db.from('strategies').update({ mode: 'normal', reverse_started_at: null, reverse_first_sell_done: false }).eq('id', strategy.id).eq('version', current.version)).error);
        }
        const saved = await db.from('meritz_days').update({ status: 'empty', broker_fills: [], error: null }).eq('id', day.id); check(saved.error);
        committed = true;
        recoveredEarlierDay = true;
        await notify(`sync:${day.id}:empty`, strategy.id, `${strategy.symbol} 체결 확인 완료`, '체결된 주문이 없습니다.', 'info');
        results.push({ strategy: strategy.id, date: day.session_date, status: 'empty' }); continue;
      }
      fills.sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.orderNo.localeCompare(b.orderNo) || a.fillNo.localeCompare(b.fillNo));
      if (local.data?.length) {
        const matching = recordedFillsMatch(fills, local.data);
        if (!matching) throw new Error('이미 입력한 체결과 메리츠 내역이 다릅니다. 중복 반영을 보류했습니다.');
        if ((await loadStrategy(strategy.id)).version !== strategy.version) throw new Error('체결 대조 중 앱 상태가 변경됐습니다. 다시 확인해 주세요.');
        if (strategy.position_qty === 0) await checkRoundBacklog(day.session_date);
        const cash = strategy.position_qty === 0 ? await readStrategyCash(client, strategy, 0) : null;
        const matched = await db.rpc('match_meritz_day', { p_day: day.id, p_account: account,
          p_version: strategy.version, p_fills: fills, p_cash: cash }); check(matched.error);
        committed = true;
      } else {
        const current = await loadStrategy(strategy.id);
        if (current.version !== baseline.version) throw new Error('체결 전 전략 상태가 변경돼 자동 반영을 보류했습니다.');
        const close = await closingPrice(day.session_date);
        if (close === null) throw new Error('해당 거래일 종가를 확인하지 못해 체결 반영을 보류했습니다.');
        const payload = buildBrokerCommit(baseline, guide, fills, day.session_date, close, { buyCompletesUnit });
        if (payload.round) await checkRoundBacklog(day.session_date);
        const final = payload.round ? { ...payload.final, broker_cash: {
          amount: await readStrategyCash(client, current, 0), date: now.date,
        } } : payload.final;
        const saved = await db.rpc('commit_meritz_day', { p_day: day.id, p_account: account, p_version: baseline.version,
          p_fills: fills, p_executions: payload.executions, p_snapshots: payload.snapshots, p_final: final, p_round: payload.round }); check(saved.error);
        committed = true;
      }
      recoveredEarlierDay = true;
      const updated = await db.from('meritz_links').update({ last_sync_at: new Date().toISOString(), last_error: null }).eq('strategy_id', strategy.id); check(updated.error);
      await notify(`sync:${day.id}:applied`, strategy.id, `${strategy.symbol} ${local.data?.length ? '수동 체결 입력 확인 완료' : '체결 반영 완료'}`, local.data?.length ? '직접 입력한 수량·금액이 메리츠 체결과 일치합니다. 체결을 추가 입력하지 않고 확인 대기를 해제했습니다.' : `매수 ${fills.filter(f => f.side === 'buy').reduce((n, f) => n + f.quantity, 0)}주 · 매도 ${fills.filter(f => f.side === 'sell').reduce((n, f) => n + f.quantity, 0)}주. 중복 없이 반영했습니다.`, 'success');
      results.push({ strategy: strategy.id, date: day.session_date, status: local.data?.length ? 'matched' : 'applied' });
    } catch (error) {
      const message = client.clean((error as Error).message);
      if (!committed) check((await db.from('meritz_days').update({ status: 'review', error: message }).eq('id', day.id)).error);
      check((await db.from('meritz_links').update({ last_error: message }).eq('strategy_id', strategy.id)).error);
      await notify(`sync:${day.id}:review`, strategy.id, `${strategy.symbol} 체결 반영 확인 필요`, message, 'warning');
      results.push({ strategy: strategy.id, date: day.session_date, error: message });
      break; // Preserve chronological state: later days cannot bypass this day.
    }
  }
  await deliverNotifications(); return { results };
}
