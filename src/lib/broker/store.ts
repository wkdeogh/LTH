import 'server-only';
import { setTimeout as sleep } from 'node:timers/promises';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Strategy } from '@/lib/types';
import { accountKey, MeritzClient } from './meritz';
import { activationDate, nyTime } from './calendar';
import { strategyGuide } from './policy';
import { loadStrategyReferences } from '@/lib/marketData/references';
import { STRATEGY_ID, requireStrategyId } from '@/lib/strategyConfig';

export function brokerDb() {
  const db = createSupabaseServerClient();
  if (!db) throw new Error('데이터베이스 연결을 확인해 주세요.');
  return db;
}
export function check(error: { message: string; code?: string } | null) {
  if (!error) return;
  if (['PGRST205', '42P01', 'PGRST202'].includes(error.code ?? '')) throw new Error('메리츠 연동 DB 업데이트가 필요합니다.');
  if (error.code === '23505') throw new Error('이미 연결되거나 처리된 요청입니다. 새로고침 후 확인해 주세요.');
  throw new Error(error.message);
}
export type BrokerLink = { strategy_id: string; account_key: string; symbol: string; auto_enabled: boolean;
  active_from: string | null; sync_from: string; last_sync_at: string | null; last_error: string | null };

export async function loadStrategy(id: string) {
  requireStrategyId(id);
  const r = await brokerDb().from('strategies').select('*').eq('id', id).eq('is_archived', false).single<Strategy>();
  check(r.error); if (!r.data || r.data.symbol !== 'SOXL' || r.data.split_count !== 20) throw new Error('SOXL 20분할 전략을 찾을 수 없습니다.'); return r.data;
}
export async function linkStrategy(strategy: Strategy) {
  const db = brokerDb(), account = accountKey();
  requireStrategyId(strategy.id);
  const result = await db.from('meritz_links').upsert({ strategy_id: strategy.id, account_key: account, symbol: strategy.symbol,
    sync_from: nyTime().date }, { onConflict: 'strategy_id', ignoreDuplicates: true });
  check(result.error);
  const link = await db.from('meritz_links').select('*').eq('strategy_id', strategy.id).single<BrokerLink>();
  check(link.error);
  if (link.data?.account_key !== account || link.data.symbol !== strategy.symbol) throw new Error('연결 계좌·종목이 변경되어 확인이 필요합니다.');
  return link.data!;
}
export async function loadBrokerLink(account: string) {
  const result = await brokerDb().from('meritz_links').select('*').eq('strategy_id', STRATEGY_ID)
    .eq('account_key', account).maybeSingle<BrokerLink>();
  check(result.error);
  return result.data;
}
export async function captureDay(strategy: Strategy, date = nyTime().date, refreshUnsubmitted = false) {
  const db = brokerDb();
  const refs = await loadStrategyReferences(db, strategy.id, strategy.symbol);
  const guide = strategyGuide(strategy, refs[0]?.price);
  const r = await db.from('meritz_days').upsert({ strategy_id: strategy.id, session_date: date,
    baseline: strategy, guide }, { onConflict: 'strategy_id,session_date', ignoreDuplicates: true });
  check(r.error);
  let day = await db.from('meritz_days').select('*').eq('strategy_id', strategy.id).eq('session_date', date).single();
  check(day.error);
  if (refreshUnsubmitted && day.data!.status === 'pending' && day.data!.baseline.version !== strategy.version) {
    const [run, executions] = await Promise.all([
      db.from('meritz_runs').select('status').eq('strategy_id', strategy.id).eq('session_date', date).maybeSingle(),
      db.from('executions').select('id').eq('strategy_id', strategy.id).eq('executed_at', date).limit(1),
    ]); check(run.error); check(executions.error);
    if ((!run.data || ['prepared','expired'].includes(run.data.status)) && !executions.data?.length) {
      const updated = await db.from('meritz_days').update({ baseline: strategy, guide }).eq('id', day.data!.id).eq('status','pending'); check(updated.error);
      day = await db.from('meritz_days').select('*').eq('id', day.data!.id).single(); check(day.error);
    }
  }
  return day.data!;
}
export async function updateAutomation(id: string, enabled: boolean) {
  const strategy = await loadStrategy(id); await linkStrategy(strategy); await captureDay(strategy);
  const active = enabled ? activationDate() : null;
  const r = await brokerDb().from('meritz_links').update({ auto_enabled: enabled, active_from: active }).eq('strategy_id', id);
  check(r.error);
  return { enabled, activeFrom: active, message: enabled ? `${active} 미국 거래일부터 자동매매가 적용됩니다.` : '자동매매를 껐습니다. 체결 자동 반영은 유지됩니다.' };
}
export async function withBrokerLock<T>(fn: (client: MeritzClient, account: string) => Promise<T>): Promise<T> {
  const db = brokerDb(), account = accountKey(), owner = crypto.randomUUID();
  const lock = await db.rpc('acquire_meritz_lock', { p_account: account, p_owner: owner }); check(lock.error);
  if (!lock.data) throw new Error('다른 메리츠 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
  const deadline = Date.now() + 240000;
  let firstCall = true;
  const client = new MeritzClient({ beforeRequest: async () => {
    if (Date.now() > deadline) throw new Error('처리 시간을 초과했습니다. 주문내역 확인 후 다시 시도해 주세요.');
    // A new server instance waits after taking the account lock. This also
    // covers the gap from the preceding instance's final HTTP call.
    if (firstCall) { firstCall = false; await sleep(1000); }
    const slot = await db.rpc('reserve_meritz_call', { p_account: account, p_owner: owner }); check(slot.error);
    await sleep(Math.max(0, new Date(String(slot.data)).getTime() - Date.now()));
  } });
  try { return await fn(client, account); }
  finally { const released = await db.rpc('release_meritz_lock', { p_account: account, p_owner: owner }); if (released.error) console.error('메리츠 작업 잠금 해제 실패', released.error.code); }
}
