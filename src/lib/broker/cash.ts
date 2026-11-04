import 'server-only';
import type { Strategy } from '@/lib/types';
import { toStrategyState } from '@/lib/types';
import { calculateBrokerWithdrawal } from '@/lib/trading/brokerCash';
import type { MeritzClient } from './meritz';
import { brokerDb, check, loadStrategy } from './store';
import { nyTime } from './calendar';
import { roundMoney } from '@/lib/trading/rounding';

export async function readStrategyCash(client: MeritzClient, strategy: Strategy, expectedQuantity = strategy.position_qty) {
  const holdings = await client.rows('/accounts/v1/me/overseas/holdings');
  if (holdings.some(row => String(row.rmnd_clcd) === '1' && (row.rmnd_dqty === null
    || row.rmnd_dqty === undefined || String(row.rmnd_dqty).trim() === ''
    || !Number.isFinite(Number(row.rmnd_dqty)) || Number(row.rmnd_dqty) < 0))) {
    throw new Error('메리츠 보유수량을 확인하지 못했습니다.');
  }
  const owned = holdings.filter(row => String(row.rmnd_clcd) === '1' && Number(row.rmnd_dqty) !== 0);
  if (owned.some(row => String(row.ovrs_stck_symb_iscd ?? row.iscd ?? '').split('.')[0] !== strategy.symbol)
    || owned.reduce((n, row) => n + Number(row.rmnd_dqty), 0) !== expectedQuantity) {
    throw new Error('계좌의 다른 보유종목 또는 미반영 체결을 확인한 후 현금을 갱신해 주세요.');
  }
  return roundMoney(await client.cashBalance());
}

export async function syncStrategyCash(client: MeritzClient, account: string, strategy: Strategy, referencePrice: number, roundId?: string) {
  const db = brokerDb();
  if (!strategy.position_qty && !roundId) {
    const round = await db.from('completed_rounds').select('id').eq('strategy_id', strategy.id).order('round_number', { ascending: false }).limit(1).maybeSingle();
    check(round.error); roundId = round.data?.id;
  }
  const cash = await readStrategyCash(client, strategy);
  const source = roundId && !strategy.position_qty ? 'meritz_round' : 'meritz_withdrawal';
  if (source === 'meritz_withdrawal' && !calculateBrokerWithdrawal(toStrategyState(strategy), cash)) return strategy;
  const saved = await db.rpc('sync_meritz_cash', { p_strategy: strategy.id, p_account: account,
    p_version: strategy.version, p_cash: cash, p_date: nyTime().date, p_source: source,
    p_round: roundId ?? null, p_reference_price: referencePrice });
  check(saved.error);
  return loadStrategy(strategy.id);
}
