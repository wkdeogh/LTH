import 'server-only';
import { STRATEGY_ID } from '@/lib/strategyConfig';
import { accountKey, MeritzClient } from './meritz';
import { brokerDb, check, loadBrokerLink } from './store';
import { notify, deliverNotifications } from './notifications';
import { pollRead, type PollOptions } from './polling';

export async function reportBrokerFailure(key: string, title: string, error: unknown, strategyId = STRATEGY_ID) {
  const message = new MeritzClient().clean(error instanceof Error ? error.message : error);
  try { await notify(key, strategyId, title, message, 'warning'); }
  catch { console.error('메리츠 오류 알림 저장 실패', key); }
  try { await deliverNotifications(); }
  catch { console.error('메리츠 오류 알림 전송 실패', key); }
}

// Intentionally outside the broker lock: no authentication or brokerage calls.
export async function runBrokerWatchdog(kind: 'opening' | 'reprice', session: string, polling: PollOptions = {}) {
  try { return await inspectBrokerJob(kind, session, polling); }
  catch (error) {
    await reportBrokerFailure(`${kind}:${session}:watchdog-error`, 'SOXL 자동매매 감시 확인 필요', error);
    throw error;
  }
}

async function inspectBrokerJob(kind: 'opening' | 'reprice', session: string, polling: PollOptions) {
  const db = brokerDb(), account = accountKey(), clock = polling.clock ?? Date.now;
  const link = await loadBrokerLink(account);
  if (!link?.auto_enabled || !link.active_from || link.active_from > session) return { outcomes: [] };
  const { value } = await pollRead(async () => {
    const found = await db.from('meritz_runs').select('id,status').eq('strategy_id', link.strategy_id)
      .eq('account_key', account).eq('session_date', session).maybeSingle(); check(found.error);
    let status: string = found.data?.status ?? 'missing';
    if (kind === 'reprice') {
      const reprice = found.data ? await db.from('meritz_reprices').select('status').eq('run_id', found.data.id).maybeSingle()
        : { data: null, error: null }; check(reprice.error);
      status = reprice.data?.status ?? 'missing';
    }
    const lock = await db.from('meritz_locks').select('expires_at').eq('account_key', account).maybeSingle(); check(lock.error);
    return { status, locked: Boolean(lock.data && Date.parse(lock.data.expires_at) > clock()) };
  }, state => ['accepted','unchanged','partial','rejected','unknown','review','expired'].includes(state.status) || !state.locked,
  { timeoutMs: 270000, maxAttempts: 60, ...polling });
  if (value.status === 'accepted' || kind === 'reprice' && value.status === 'unchanged') {
    await deliverNotifications(); return { outcomes: [{ strategy: link.strategy_id, status: value.status }] };
  }
  const working = value.locked || ['submitting','checking','cancelling','cancelled'].includes(value.status);
  const label = kind === 'opening' ? '한국 22시 자동주문' : '새벽 3시 재점검·재주문';
  const message = working ? `${label}이 진행 중 상태로 남아 있습니다(${value.status}). 완료 여부와 주문내역을 확인해 주세요.`
    : `${label}의 완료를 확인하지 못했습니다(${value.status}). 주문내역을 확인해 주세요.`;
  await reportBrokerFailure(`${kind}:${link.strategy_id}:${session}:watchdog`, 'SOXL 자동매매 확인 필요', message, link.strategy_id);
  return { outcomes: [{ strategy: link.strategy_id, status: value.status, error: message }] };
}
