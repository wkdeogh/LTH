import 'server-only';
import { toStrategyState, type Strategy } from '@/lib/types';
import { brokerConfigured, BrokerRequestError, type BrokerRow } from './meritz';
import { nyTime, repriceWindow, shiftDate } from './calendar';
import { brokerDb, check, loadStrategy, withBrokerLock, loadBrokerLink } from './store';
import { notify, deliverNotifications } from './notifications';
import { judgeOrder } from './policy';
import { buyReservation, fitOrderFunding, fundingSummary, orderCash, waitForOrderFunding } from './funding';
import { submitOrderBatch, type Run } from './service';
import { brokerSession } from './reconciliation';
import { cancelThenReplace, exceedsFivePercent, historyIdentity, planReplacement, replacementBudgetMs, type TrackedOrder } from './repricing-policy';
import { reportBrokerFailure, runBrokerWatchdog } from './watchdog';

export async function runRepriceJob(watchdog = false) {
  if (!brokerConfigured()) return { skipped: '메리츠 키 미설정' };
  if (process.env.NODE_ENV === 'production' && !process.env.APP_PASSWORD) throw new Error('자동 재주문에 필요한 앱 접속 보호 설정이 없습니다.');
  if (!repriceWindow(new Date(), watchdog)) return { skipped: '한국 03시 재점검 시분 또는 거래일이 아님' };
  if (watchdog) return runBrokerWatchdog('reprice', nyTime().date);
  return withBrokerLock(async (client, account) => {
    const db = brokerDb(), session = nyTime().date;
    const link = await loadBrokerLink(account);
    if (!link?.auto_enabled || !link.active_from || link.active_from > session) { await deliverNotifications(); return { outcomes: [] }; }
    const outcomes: Record<string, unknown>[] = [];
    let run: Run | null = null, claimed = false;
    let cancelRequested = 0, cancelConfirmed = 0, replacementAccepted = 0;
    const cancelledOrders: string[] = [];
    try {
      const found = await db.from('meritz_runs').select('*').eq('strategy_id', link.strategy_id).eq('session_date', session).maybeSingle<Run>(); check(found.error); run = found.data;
      const existing = run ? await db.from('meritz_reprices').select('status').eq('run_id', run.id).maybeSingle() : { data: null, error: null }; check(existing.error);
      if (existing.data) { outcomes.push({ strategy: link.strategy_id, status: existing.data.status }); await deliverNotifications(); return { outcomes }; }
      if (!run || run.status !== 'accepted' || run.account_key !== account) throw new Error('접수 완료된 동일 계좌의 1차 주문이 없어 취소·재주문하지 않았습니다.');
      check((await db.from('meritz_reprices').insert({ run_id: run.id, status: 'checking', initial_price: run.submission_price })).error); claimed = true;
      if (!run.snapshot.processed.orders.length) {
        check((await db.from('meritz_reprices').update({ status: 'unchanged', finished_at: new Date().toISOString() }).eq('run_id', run.id)).error);
        await deliverNotifications(); return { outcomes: [{ strategy: link.strategy_id, status: 'unchanged', reason: '1차 주문 없음' }] };
      }
      const strategy = await loadStrategy(run.strategy_id);
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
        outcomes.push({ strategy: strategy.id, status: 'unchanged', initial, price }); await deliverNotifications(); return { outcomes };
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
      replacement.processed = fitOrderFunding(replacement.processed, state, state.cashBalance, state.positionQty);
      check((await db.from('meritz_reprices').update({ status: 'cancelling', replacement_snapshot: replacement.processed }).eq('run_id', run.id)).error);
      // Store official broker dates before the Korea-local midnight boundary
      // can make a repeated order number point at another generation.
      for (const target of replacement.targets) {
        const date = String(target.history.oder_date);
        check((await db.from('meritz_orders').update({ broker_order_date: date }).eq('id', target.order.id)).error);
        target.order.broker_order_date = date;
      }
      const live = () => client.rows('/trading/v1/overseas/orders/today', { cntg_cls_code: '0', seln_byov_clcd: '0' });
      // Preserve time for fresh quotes, funding, history and the replacement batch.
      const replacementReserve = () => (replacement.processed.orders.length + 10) * client.estimatedRequestMs() + 15000;
      const result = await cancelThenReplace(replacement.targets, {
        guard, live,
        preflight: () => client.assertTimeRemaining(replacementBudgetMs(replacement.targets.length,
          replacement.processed.orders.length, client.lastPageCount, client.lastPageSize, client.estimatedRequestMs())),
        polling: { timeoutMs: 30000, beforeRead: () => client.assertTimeRemaining(replacementReserve()) },
        onConfirmed: count => { cancelConfirmed = count; },
        cancel: async target => {
          const body = { oder_date: String(target.history.oder_date), orgl_oder_no: Number(target.order.broker_order_no),
            oder_cls_code: String(target.order.body.oder_cls_code), odqt: target.quantity, warn_cnfr_yn: 'N' };
          check((await db.from('meritz_cancellations').insert({ order_id: target.order.id, run_id: run!.id, body, status: 'attempting' })).error);
          let response;
          try { response = await client.call('/trading/v1/overseas/orders/cancel', {}, body, true); }
          catch (error) {
            const notSent = error instanceof BrokerRequestError && !error.requestSent;
            try { check((await db.from('meritz_cancellations').update({ status: notSent ? 'rejected' : 'unknown',
              response: { error: client.clean((error as Error).message), transmission: notSent ? 'not_sent' : 'uncertain' } }).eq('order_id', target.order.id)).error); }
            catch { console.error('취소 실패 상태 저장 실패', target.order.id); }
            throw error;
          }
          const status = judgeOrder(response), data = response.data as BrokerRow | undefined;
          if (status === 'accepted') { cancelRequested++; cancelledOrders.push(`${target.history.oder_date}/${target.order.broker_order_no}`); }
          const safe = { rsp_cd: response.rsp_cd, rsp_msg: client.clean(response.rsp_msg), rsp_sub_msg: client.clean(response.rsp_sub_msg), warn_cls_code: data?.warn_cls_code, warn_msg: client.clean(data?.warn_msg) };
          check((await db.from('meritz_cancellations').update({ status: status === 'accepted' ? 'requested' : status, broker_cancel_no: data?.oder_no ? String(data.oder_no) : null, response: safe }).eq('order_id', target.order.id)).error);
          if (status !== 'accepted') throw new Error(`취소 요청이 확정되지 않아 새 주문을 보내지 않았습니다. ${safe.rsp_cd ?? ''} ${safe.rsp_msg} ${safe.warn_msg}`);
          return String(data!.oder_no);
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
          // Cancellation can take many one-second calls. Rebuild the same
          // remaining guide at the latest quote, rather than leave no orders
          // merely because the old cap/cutoff moved by a few cents meanwhile.
          replacement.processed = planReplacement(run!.snapshot.guide, saved.data ?? [], rows, await client.currentPrice('SOXL')).processed;
          const funding = await waitForOrderFunding(Math.min(state.cashBalance, buyReservation(replacement.processed.orders)),
            replacement.processed.orders.filter(order => order.side === 'sell').reduce((sum, order) => sum + order.quantity, 0), async () => {
              const cash = replacement.processed.orders.some(order => order.side === 'buy')
                ? orderCash(await client.rows('/trading/v1/overseas/orders/estimate', { intg_marg_iqry_yn: 'N' })) : 0;
              const holdings = (await client.rows('/accounts/v1/me/overseas/holdings')).filter(r => String(r.ovrs_stck_symb_iscd ?? r.iscd ?? '').split('.')[0] === 'SOXL' && String(r.rmnd_clcd) === '1');
              if (holdings.reduce((n,r) => n + Number(r.rmnd_dqty),0) !== state.positionQty) throw new Error('기체결 수량과 계좌 보유수량이 달라 재주문을 보류했습니다.');
              return { cash, sellable: holdings.reduce((n,r) => n + Number(r.seln_able_dqty),0) };
            }, { timeoutMs: 15000, beforeRead: () => client.assertTimeRemaining(
              (replacement.processed.orders.length + 5) * client.estimatedRequestMs() + 5000) });
          replacement.processed = fitOrderFunding(planReplacement(run!.snapshot.guide, saved.data ?? [], rows,
            await client.currentPrice('SOXL')).processed, state, funding.cash, funding.sellable);
          const after = await history();
          if (replacement.targets.some(t => !after.some(r => historyIdentity(r) === historyIdentity(t.history) && Number(r.cntg_dqty ?? r.cntg_qty) === 0))) throw new Error('취소 후 원주문의 체결 상태가 달라 재주문을 보류했습니다.');
          if (after.some(r => String(r.oder_rctf_cncl_cls_code) === '0' && !['1','2','4'].includes(String(r.ovrs_stck_oder_stat_cls_code)) && !replacement.identities.has(historyIdentity(r)))) throw new Error('취소 중 다른 SOXL 주문이 추가돼 재주문을 보류했습니다.');
          await guard();
          check((await db.from('meritz_reprices').update({ status: 'submitting', replacement_snapshot: replacement.processed }).eq('run_id', run!.id)).error);
          return submitOrderBatch(run!, strategy as Strategy, replacement.processed.orders, client, account, 'reprice:',
            count => { replacementAccepted = count; });
        },
      });
      check((await db.from('meritz_reprices').update({ status: result.status === 'accepted' ? 'accepted' : 'review', error: result.failure || null, finished_at: new Date().toISOString() }).eq('run_id', run.id)).error);
      try {
        await notify(`reprice:${run.id}:result`, strategy.id, result.status === 'accepted' ? 'SOXL 새벽 3시 재주문 완료' : 'SOXL 새벽 3시 재주문 확인 필요',
          `1차 기준 $${initial.toFixed(2)} → 3시 기준 $${price.toFixed(2)}. 기존 미체결 ${replacement.targets.length}건 취소 확인, 새 주문 ${result.accepted}건 접수. ${result.failure}${fundingSummary(replacement.processed)}`, result.status === 'accepted' ? 'success' : 'warning');
      } catch { console.error('재주문 결과 알림 저장 실패', run.id); }
      outcomes.push({ strategy: strategy.id, status: result.status, initial, price, accepted: result.accepted });
    } catch (error) {
      const message = client.clean((error as Error).message)
        + ` 취소 접수 ${cancelRequested}건·확정 ${cancelConfirmed}건, 새 주문 ${replacementAccepted}건 접수.`
        + (cancelledOrders.length ? ` 취소 접수 원주문: ${cancelledOrders.join(', ')}.` : '')
        + ' 잔존 주문은 미확인입니다. 메리츠 주문내역에서 남은 주문과 수동 주문 필요 여부를 확인해 주세요.';
      if (claimed && run) {
        try { check((await db.from('meritz_reprices').update({ status: 'review', error: message, finished_at: new Date().toISOString() }).eq('run_id', run.id)).error); }
        catch { console.error('재점검 실패 상태 저장 실패', run.id); }
      }
      await reportBrokerFailure(`reprice:${link.strategy_id}:${session}:error`, 'SOXL 새벽 3시 주문 확인 필요', message, link.strategy_id);
      outcomes.push({ strategy: link.strategy_id, error: message });
    }
    await deliverNotifications(); return { outcomes };
  }).catch(async error => {
    await reportBrokerFailure(`reprice:${nyTime().date}:job-error`, 'SOXL 새벽 3시 주문 확인 필요', error);
    throw error;
  });
}
