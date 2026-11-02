import 'server-only';
import { toStrategyState, type Strategy } from '@/lib/types';
import { brokerConfigured, type BrokerRow } from './meritz';
import { nyTime, repriceWindow, shiftDate } from './calendar';
import { brokerDb, check, loadStrategy, withBrokerLock, type BrokerLink } from './store';
import { notify, deliverNotifications } from './notifications';
import { judgeOrder, validateFunding, validateOrderBounds } from './policy';
import { submitOrderBatch, type Run } from './service';
import { brokerSession } from './reconciliation';
import { cancelThenReplace, exceedsFivePercent, historyIdentity, planReplacement, type TrackedOrder } from './repricing-policy';

export async function runRepriceJob(watchdog = false) {
  if (!brokerConfigured()) return { skipped: '메리츠 키 미설정' };
  if (process.env.NODE_ENV === 'production' && !process.env.APP_PASSWORD) throw new Error('자동 재주문에 필요한 앱 접속 보호 설정이 없습니다.');
  if (!repriceWindow(new Date(), watchdog)) return { skipped: '한국 03시 재점검 시분 또는 거래일이 아님' };
  return withBrokerLock(async (client, account) => {
    const db = brokerDb(), session = nyTime().date;
    const links = await db.from('meritz_links').select('*').eq('account_key', account).eq('symbol', 'SOXL').eq('auto_enabled', true).lte('active_from', session).returns<BrokerLink[]>(); check(links.error);
    const outcomes: Record<string, unknown>[] = [];
    for (const link of links.data ?? []) {
      let run: Run | null = null, claimed = false;
      try {
        const found = await db.from('meritz_runs').select('*').eq('strategy_id', link.strategy_id).eq('session_date', session).maybeSingle<Run>(); check(found.error); run = found.data;
        const existing = run ? await db.from('meritz_reprices').select('status').eq('run_id', run.id).maybeSingle() : { data: null, error: null }; check(existing.error);
        if (watchdog) {
          if (!existing.data || !['unchanged','accepted'].includes(existing.data.status)) throw new Error('새벽 3시 재점검·재주문 완료를 확인하지 못했습니다. 주문내역을 확인해 주세요.');
          continue;
        }
        if (existing.data) { outcomes.push({ strategy: link.strategy_id, status: existing.data.status }); continue; }
        if (!run || run.status !== 'accepted' || run.account_key !== account) throw new Error('접수 완료된 동일 계좌의 1차 주문이 없어 취소·재주문하지 않았습니다.');
        check((await db.from('meritz_reprices').insert({ run_id: run.id, status: 'checking', initial_price: run.submission_price })).error); claimed = true;
        const strategy = await loadStrategy(run.strategy_id);
        if (strategy.symbol !== 'SOXL') throw new Error('SOXL 전략이 아니므로 재주문하지 않았습니다.');
        const guard = async () => {
          const current = await loadStrategy(strategy.id);
          const setting = await db.from('meritz_links').select('auto_enabled,active_from,account_key').eq('strategy_id', strategy.id).single(); check(setting.error);
          if (!setting.data?.auto_enabled || !setting.data.active_from || setting.data.active_from > session || setting.data.account_key !== account) throw new Error('자동매매 설정이 바뀌어 남은 취소·재주문을 중지했습니다.');
          if (current.version !== strategy.version || strategy.version !== run!.snapshot.strategy.version) throw new Error('전략 상태가 변경돼 취소·재주문을 보류했습니다.');
        };
        await guard(); await client.assertMarketOpen();
        const initial = Number(run.submission_price), price = await client.currentPrice('SOXL');
        const replace = exceedsFivePercent(initial, price);
        check((await db.from('meritz_reprices').update({ current_price: price }).eq('run_id', run.id)).error);
        if (!replace) {
          check((await db.from('meritz_reprices').update({ status: 'unchanged', finished_at: new Date().toISOString() }).eq('run_id', run.id)).error);
          outcomes.push({ strategy: strategy.id, status: 'unchanged', initial, price }); continue;
        }
        const history = async () => (await client.rows('/trading/v1/overseas/orders/history', {
          oder_sta_date: session.replaceAll('-',''), oder_fin_date: shiftDate(session,1).replaceAll('-',''), cntg_cls_code: '0', seln_byov_clcd: '0',
        })).filter(r => String(r.ovrs_stck_symb_iscd ?? r.iscd ?? '').split('.')[0] === 'SOXL' && brokerSession(r) === session);
        const saved = await db.from('meritz_orders').select('*').eq('run_id', run.id).returns<TrackedOrder[]>(); check(saved.error);
        const rows = await history();
        const replacement = planReplacement(run.snapshot.guide, saved.data ?? [], rows, price);
        const state = toStrategyState(strategy);
        state.positionQty += replacement.buyQuantity - replacement.sellQuantity;
        state.cashBalance = Math.round((state.cashBalance + replacement.cashChange) * 10000) / 10000;
        validateFunding(replacement.processed.orders, state, state.cashBalance, state.positionQty);
        check((await db.from('meritz_reprices').update({ status: 'cancelling', replacement_snapshot: replacement.processed }).eq('run_id', run.id)).error);
        // Store official broker dates before the Korea-local midnight boundary
        // can make a repeated order number point at another generation.
        for (const target of replacement.targets) check((await db.from('meritz_orders').update({ broker_order_date: String(target.history.oder_date) }).eq('id', target.order.id)).error);
        const live = () => client.rows('/trading/v1/overseas/orders/today', { cntg_cls_code: '0', seln_byov_clcd: '0' });
        const result = await cancelThenReplace(replacement.targets, {
          guard, live,
          cancel: async target => {
            const body = { oder_date: String(target.history.oder_date), orgl_oder_no: Number(target.order.broker_order_no),
              oder_cls_code: String(target.order.body.oder_cls_code), odqt: target.quantity, warn_cnfr_yn: 'N' };
            check((await db.from('meritz_cancellations').insert({ order_id: target.order.id, run_id: run!.id, body, status: 'attempting' })).error);
            const response = await client.call('/trading/v1/overseas/orders/cancel', {}, body, true);
            const status = judgeOrder(response), data = response.data as BrokerRow | undefined;
            const safe = { rsp_cd: response.rsp_cd, rsp_msg: client.clean(response.rsp_msg), rsp_sub_msg: client.clean(response.rsp_sub_msg), warn_cls_code: data?.warn_cls_code, warn_msg: client.clean(data?.warn_msg) };
            check((await db.from('meritz_cancellations').update({ status: status === 'accepted' ? 'requested' : status, broker_cancel_no: data?.oder_no ? String(data.oder_no) : null, response: safe }).eq('order_id', target.order.id)).error);
            if (status !== 'accepted') throw new Error(`취소 요청이 확정되지 않아 새 주문을 보내지 않았습니다. ${safe.rsp_cd ?? ''} ${safe.rsp_msg} ${safe.warn_msg}`);
          },
          confirmed: async targets => {
            for (const target of targets) {
              check((await db.from('meritz_cancellations').update({ status: 'confirmed', confirmed_at: new Date().toISOString() }).eq('order_id', target.order.id)).error);
              check((await db.from('meritz_orders').update({ status: 'cancelled' }).eq('id', target.order.id)).error);
            }
            check((await db.from('meritz_reprices').update({ status: 'cancelled' }).eq('run_id', run!.id)).error);
          },
          replace: async () => {
            await client.assertMarketOpen();
            validateOrderBounds(replacement.processed.orders, await client.currentPrice('SOXL'));
            const after = await history();
            if (replacement.targets.some(t => !after.some(r => historyIdentity(r) === historyIdentity(t.history) && Number(r.cntg_dqty ?? r.cntg_qty) === 0))) throw new Error('취소 후 원주문의 체결 상태가 달라 재주문을 보류했습니다.');
            if (after.some(r => String(r.oder_rctf_cncl_cls_code) === '0' && !['1','2','4'].includes(String(r.ovrs_stck_oder_stat_cls_code)) && !replacement.identities.has(historyIdentity(r)))) throw new Error('취소 중 다른 SOXL 주문이 추가돼 재주문을 보류했습니다.');
            const cash = await client.rows('/trading/v1/overseas/orders/estimate', { intg_marg_iqry_yn: 'N' });
            const holdings = (await client.rows('/accounts/v1/me/overseas/holdings')).filter(r => String(r.ovrs_stck_symb_iscd ?? r.iscd ?? '').split('.')[0] === 'SOXL' && String(r.rmnd_clcd) === '1');
            if (holdings.reduce((n,r) => n + Number(r.rmnd_dqty),0) !== state.positionQty) throw new Error('기체결 수량과 계좌 보유수량이 달라 재주문을 보류했습니다.');
            validateFunding(replacement.processed.orders, state, Number(cash.find(r => r.crcd === 'USD')?.oder_crnc_oder_able_camt), holdings.reduce((n,r) => n + Number(r.seln_able_dqty),0));
            await guard();
            check((await db.from('meritz_reprices').update({ status: 'submitting' }).eq('run_id', run!.id)).error);
            return submitOrderBatch(run!, strategy as Strategy, replacement.processed.orders, client, account, 'reprice:');
          },
        });
        check((await db.from('meritz_reprices').update({ status: result.status === 'accepted' ? 'accepted' : 'review', error: result.failure || null, finished_at: new Date().toISOString() }).eq('run_id', run.id)).error);
        try {
          await notify(`reprice:${run.id}:result`, strategy.id, result.status === 'accepted' ? 'SOXL 새벽 3시 재주문 완료' : 'SOXL 새벽 3시 재주문 확인 필요',
            `1차 기준 $${initial.toFixed(2)} → 3시 기준 $${price.toFixed(2)}. 기존 미체결 ${replacement.targets.length}건 취소 확인, 새 주문 ${result.accepted}건 접수. ${result.failure}`, result.status === 'accepted' ? 'success' : 'warning');
        } catch { console.error('재주문 결과 알림 저장 실패', run.id); }
        outcomes.push({ strategy: strategy.id, status: result.status, initial, price, accepted: result.accepted });
      } catch (error) {
        const message = client.clean((error as Error).message);
        if (claimed && run) check((await db.from('meritz_reprices').update({ status: 'review', error: message, finished_at: new Date().toISOString() }).eq('run_id', run.id)).error);
        await notify(`reprice:${link.strategy_id}:${session}:${watchdog ? 'watchdog' : 'error'}`, link.strategy_id, 'SOXL 새벽 3시 주문 확인 필요', message, 'warning');
        outcomes.push({ strategy: link.strategy_id, error: message });
      }
    }
    await deliverNotifications(); return { outcomes };
  });
}
