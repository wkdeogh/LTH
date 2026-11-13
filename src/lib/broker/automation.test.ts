import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './__tests__/harness';
import { BrokerRequestError, type MeritzClient } from './meritz';
import type { Strategy } from '@/lib/types';
import type { Run } from './service';
import type { ApiOrder } from './policy';

function fill(date: string, side: 'buy' | 'sell' = 'buy', quantity = 10, no = 101) {
  return { oder_date: date.replaceAll('-',''), oder_no: no, oder_rctf_cncl_cls_code: '0',
    ovrs_stck_oder_stat_cls_code: '0', iscd: 'SOXL.AX', seln_byov_clcd: side === 'buy' ? '2' : '1',
    aspr_type_code: '5', oder_dqty: quantity, cntg_dqty: quantity, cntg_camt: quantity * 49,
    ovrs_stck_oder_prc: side === 'buy' ? 49.99 : 50, oder_exec_ymdh: `${date} 22:00:01` };
}
const api: ApiOrder = { key: 'buy', side: 'buy', orderType: 'LOC', quantity: 1, price: 10,
  sources: [{ label: '기본', side: 'buy', orderType: 'LOC', quantity: 1, price: 10, note: '' }] };

test('첫 매도가 미체결이면 종가가 복귀 기준 위여도 리버스를 유지하고 매도 완료 후에는 복귀한다', async () => {
  for (const firstSellDone of [false, true]) {
    const h = harness();
    Object.assign(h.strategy(), { mode: 'reverse', t_value: firstSellDone ? 17.8 : 19.7734375,
      reverse_started_at: '2026-11-05', reverse_first_sell_done: firstSellDone });
    const day = h.addDay('2026-11-05');
    h.setNow('2026-11-06T12:00:00Z');
    await h.service().reconcileBroker();
    assert.equal(day.status, 'empty');
    assert.equal(h.strategy().mode, firstSellDone ? 'normal' : 'reverse');
    assert.equal(h.requests.some(path => path.endsWith('/buy') || path.endsWith('/sell')), false);
  }
});
function batchRun(h: ReturnType<typeof harness>) {
  return { id: 'run', strategy_id: h.strategy().id, source: 'auto', session_date: '2026-11-06' } as Run;
}

function outcomes(result: unknown) {
  assert.ok(result && typeof result === 'object' && 'outcomes' in result);
  return (result as { outcomes: Record<string, unknown>[] }).outcomes;
}

test('실제 준비·제출 경로: 전날 새벽 이력은 허용하고 당일 수동 주문은 두 단계에서 차단한다', async () => {
  for (const stage of ['previous','prepare','submit','daytime-prepare','daytime-submit']) {
    const h = harness();
    if (stage === 'previous') h.history.push({ ...fill('2026-11-06'), oder_exec_ymdh: '2026-11-06 03:00:01' });
    if (stage === 'prepare') h.history.push(fill('2026-11-06'));
    if (stage === 'daytime-prepare') h.history.push({...fill('2026-11-06'),oder_exec_ymdh:'2026-11-06 10:00:00'});
    if (stage === 'submit' || stage === 'daytime-submit') {
      const original = h.client.rows.bind(h.client); let reads = 0;
      h.client.rows = async (path, params) => {
        if (path.endsWith('/history') && ++reads === 2) h.history.push({...fill('2026-11-06'),
          oder_exec_ymdh:stage==='daytime-submit'?'2026-11-06 10:00:00':'2026-11-06 22:00:01'});
        return original(path, params);
      };
    }
    const result = await h.service().runOpeningJob();
    if (stage === 'previous') {
      assert.equal(outcomes(result)[0].status, 'accepted');
      assert.ok(h.requests.some(r => r.endsWith('/buy')));
    } else {
      assert.match(String(outcomes(result)[0].error), /중복|당일/);
      assert.equal(h.requests.some(r => r.endsWith('/buy') || r.endsWith('/sell')), false);
    }
  }
});

test('전송 전 실패는 rejected, 전송 후·접수 후 DB 저장 실패는 unknown이며 다시 보내지 않는다', async () => {
  for (const mode of ['not_sent','uncertain','db']) {
    const h = harness(); let sends = 0;
    h.faults.acceptedSave = mode === 'db';
    h.client.call = async () => {
      if (mode !== 'not_sent') sends++;
      if (mode !== 'db') throw new BrokerRequestError('모의 오류', mode === 'uncertain');
      return { rsp_cd: '0001', data: { warn_cls_code: '0', oder_no: 101 } };
    };
    const result = await h.service().submitOrderBatch(batchRun(h), h.strategy() as Strategy, [api, api], h.client as unknown as MeritzClient, 'account');
    assert.equal(result.status, mode === 'not_sent' ? 'rejected' : 'unknown');
    assert.equal(sends, mode === 'not_sent' ? 0 : 1);
    assert.equal(h.tables.meritz_orders.length, 1);
    assert.equal(h.tables.meritz_orders[0].response.transmission, mode === 'not_sent' ? 'not_sent' : 'uncertain');
  }
});

test('미전송 취소·접수 불명 주문을 자동 재전송하지 않고 오전 대조에서도 불명을 보존한다', async () => {
  const h = harness(), day = h.addDay('2026-11-05');
  h.tables.meritz_runs = [{ id: 'unknown-run', strategy_id: h.strategy().id, session_date: day.session_date }];
  h.tables.meritz_orders = [{ id: 'unknown', run_id: 'unknown-run', status: 'unknown', attempted_at: '2026-11-05T13:00:00Z' }];
  await h.service().runOpeningJob();
  assert.equal(day.status, 'review');
  assert.match(day.error, /접수 여부/);
  assert.equal(h.requests.some(r => r.endsWith('/buy') || r.endsWith('/sell')), false);
});

test('밤 자동주문은 전날 체결을 복구한 새 버전으로 오늘 가이드를 갱신한다', async () => {
  const h = harness(), old = h.addDay('2026-11-05', 'review');
  h.history.push(fill('2026-11-05'));
  const result = await h.service().runOpeningJob();
  assert.equal(old.status, 'applied');
  assert.equal(h.strategy().version, 2);
  assert.equal(h.strategy().position_qty, 110);
  const today = h.tables.meritz_days.find(d => d.session_date === '2026-11-06')!;
  assert.equal(today.baseline.version, 2);
  assert.equal(h.tables.meritz_runs[0].snapshot.strategy.version, 2);
  assert.equal(outcomes(result)[0].status, 'accepted');
  assert.equal(h.rpcCalls.filter(r => r.name === 'commit_meritz_day').length, 1);
  assert.equal(h.refreshes(), 1);
});

test('수동 미리보기는 이전 날 자동 체결을 새로 입력하지 않는다', async () => {
  const h = harness(), day = h.addDay('2026-11-05', 'review'); h.history.push(fill('2026-11-05'));
  await assert.rejects(h.service().prepareOrders(h.strategy().id), /이전 거래일/);
  assert.equal(day.status, 'review'); assert.equal(h.rpcCalls.length, 0); assert.equal(h.requests.length, 0);
});

test('종가 장애가 두 번 난 뒤 회복하면 중간의 주문 없는 pending 날짜도 정리된다', async () => {
  const h = harness(), first = h.addDay('2026-11-04', 'review');
  h.history.push(fill('2026-11-04')); h.faults.candles = true;
  for (let attempt = 0; attempt < 2; attempt++) {
    await h.service().runOpeningJob();
    assert.equal(first.status, 'review'); assert.equal(h.rpcCalls.length, 0);
  }
  // Yesterday's blocked opening captured the next day with the stale baseline.
  const untouched = h.addDay('2026-11-05'); h.faults.candles = false;
  const result = await h.service().runOpeningJob();
  assert.equal(first.status, 'applied'); assert.equal(untouched.status, 'empty');
  assert.equal(untouched.baseline.version, 2);
  assert.equal(outcomes(result)[0].status, 'accepted');
});

test('거래 이력이나 review가 있는 과거 날짜는 낡은 baseline을 자동 교체하지 않는다', async () => {
  for (const protectedDay of ['review','history','run','manual']) {
    const h = harness(); h.addDay('2026-11-04', 'review'); h.history.push(fill('2026-11-04'));
    const next = h.addDay('2026-11-05', protectedDay === 'review' ? 'review' : 'pending');
    if (protectedDay === 'history') h.history.push({ ...fill('2026-11-05'), cntg_dqty: 0, cntg_camt: 0 });
    if (protectedDay === 'run') h.tables.meritz_runs = [{ id: 'previous', strategy_id: h.strategy().id, session_date: next.session_date, status: 'accepted' }];
    if (protectedDay === 'manual') h.tables.executions = [{ strategy_id: h.strategy().id, executed_at: next.session_date, side: 'buy', quantity: 1, total_amount: 49 }];
    const result = await h.service().runOpeningJob();
    assert.equal(next.baseline.version, 1, protectedDay);
    assert.equal(next.status, 'review', protectedDay);
    assert.match(String(outcomes(result)[0].error), /이전 거래일/);
    assert.equal(h.requests.some(r => r.endsWith('/buy') || r.endsWith('/sell')), false);
  }
});

test('라운드 종료일 복구는 정상 반영하고 다일 backlog는 한국어 경고와 함께 원자적 반영 전에 중단한다', async () => {
  for (const backlog of [false, true]) {
    const h = harness(), day = h.addDay('2026-11-04', 'review');
    const quarter = fill('2026-11-04', 'sell', 25), final = { ...fill('2026-11-04', 'sell', 75, 102), aspr_type_code: '2', ovrs_stck_oder_prc: 60 };
    h.history.push(quarter, final);
    if (backlog) h.addDay('2026-11-05');
    const result = await h.service().runOpeningJob();
    if (backlog) {
      assert.equal(day.status, 'review'); assert.match(day.error, /여러 미처리 거래일/);
      assert.equal(h.rpcCalls.length, 0); assert.equal(h.strategy().position_qty, 100);
    } else {
      assert.equal(day.status, 'applied'); assert.equal(h.strategy().position_qty, 0);
      assert.equal(h.strategy().principal, 12000);
      assert.equal(outcomes(result)[0].status, 'accepted');
    }
  }
});

test('부분체결과 버전 불일치는 자동 복구로 강제 해제하지 않는다', async () => {
  for (const mode of ['partial','version']) {
    const h = harness(), day = h.addDay('2026-11-05', 'review');
    h.history.push({ ...fill('2026-11-05'), cntg_dqty: mode === 'partial' ? 9 : 10, cntg_camt: mode === 'partial' ? 441 : 490 });
    if (mode === 'version') h.strategy().version++;
    await h.service().runOpeningJob();
    assert.equal(day.status, 'review'); assert.equal(h.rpcCalls.length, 0);
    assert.equal(h.requests.some(r => r.endsWith('/buy')), false);
  }
});

test('잠금 중 워치독은 브로커 호출 없이 진행 중→완료를 기다리며 오탐을 보내지 않는다', async () => {
  for (const kind of ['opening','reprice'] as const) {
    const h = harness(); h.faults.lock = true;
    h.tables.meritz_runs = [{ id: 'run', strategy_id: h.strategy().id, account_key: 'account', session_date: '2026-11-06', status: 'submitting' }];
    h.tables.meritz_reprices = [{ run_id: 'run', status: 'cancelling' }];
    h.tables.meritz_locks = [{ account_key: 'account', expires_at: '2026-11-06T13:10:00Z' }];
    const result = await h.watchdog().runBrokerWatchdog(kind, '2026-11-06', { ...h.time, wait: async ms => {
      await h.time.wait(ms);
      h.tables.meritz_runs[0].status = 'accepted'; h.tables.meritz_reprices[0].status = 'accepted';
    } });
    assert.equal(result.outcomes[0].status, 'accepted');
    assert.equal(h.notices.length, 0); assert.equal(h.requests.length, 0);
  }
});

test('워치독은 정체 상태를 실패와 구분하고 본 작업 잠금 실패도 알린다', async () => {
  const h = harness(); h.faults.lock = true;
  await assert.rejects(h.service().runOpeningJob(), /다른 메리츠/);
  assert.equal(h.notices.length, 1);
  h.tables.meritz_runs = [{ id: 'run', strategy_id: h.strategy().id, account_key: 'account', session_date: '2026-11-06', status: 'submitting' }];
  h.tables.meritz_locks = [{ account_key: 'account', expires_at: '2026-11-06T13:10:00Z' }];
  await h.watchdog().runBrokerWatchdog('opening', '2026-11-06', { timeoutMs: 10000, ...h.time });
  assert.match(h.notices.at(-1)!.body, /진행 중/); assert.equal(h.requests.length, 0);
});

test('아침 공통 루프에서도 앞선 날 복구 후 주문 없는 pending 날짜를 갱신한다', async () => {
  const h = harness(); h.setNow('2026-11-05T21:10:00Z');
  const first = h.addDay('2026-11-04', 'review'), next = h.addDay('2026-11-05');
  h.history.push(fill('2026-11-04'));
  await h.service().reconcileBroker();
  assert.equal(first.status, 'applied'); assert.equal(next.status, 'empty');
  assert.equal(next.baseline.version, 2);
  assert.equal(h.requests.some(r => r.endsWith('/buy') || r.endsWith('/sell')), false);
});

test('워치독의 270초 대기와 느린 알림을 합해 300초 예산 안에서 끝낸다', async () => {
  const h = harness(), started = h.time.clock(); h.faults.notificationMs = 20000;
  h.tables.meritz_runs = [{ id: 'run', strategy_id: h.strategy().id, account_key: 'account', session_date: '2026-11-06', status: 'submitting' }];
  h.tables.meritz_locks = [{ account_key: 'account', expires_at: '2026-11-06T13:10:00Z' }];
  await h.watchdog().runBrokerWatchdog('opening', '2026-11-06', h.time);
  assert.equal(h.time.clock() - started, 290000);
  assert.match(h.notices[0].body, /진행 중/);
});

test('22:02:59 시작에서 복구 지연을 포함해 제출하고 22:05 이후 남은 주문은 차단한다', async () => {
  for (const delay of [110000, 116000, 125000]) {
    const h = harness(); h.setNow('2026-11-06T13:02:59Z');
    h.addDay('2026-11-05', 'review'); h.history.push(fill('2026-11-05'));
    const rows = h.client.rows.bind(h.client); let recovered = false;
    h.client.rows = async (path, params) => {
      if (!recovered && path.endsWith('/history')) { recovered = true; await h.time.wait(delay); }
      return rows(path, params);
    };
    const call = h.client.call.bind(h.client), sentAt: number[] = [];
    h.client.call = async (path, params, body) => {
      sentAt.push(h.time.clock()); await h.time.wait(delay === 110000 ? 1000 : 3000);
      return call(path, params, body);
    };
    const result = await h.service().runOpeningJob();
    assert.ok(sentAt.every(stamp => stamp < Date.parse('2026-11-06T13:05:00Z')));
    if (delay === 110000) { assert.equal(outcomes(result)[0].status, 'accepted'); assert.ok(sentAt.length > 0); }
    else if (delay === 116000) { assert.equal(outcomes(result)[0].status, 'partial'); assert.ok(sentAt.length > 0); }
    else { assert.equal(sentAt.length, 0); assert.match(String(outcomes(result)[0].error), /거래 시간/); }
  }
});

function repriceFixture() {
  const h = harness(); h.setNow('2026-11-06T18:00:00Z');
  // 50 -> 40 moves the +20% buy cap to 48, so the 49.99 LOC buy really changes.
  h.client.currentPrice = async () => 40;
  const source = { ...api.sources[0], price: 49.99, quantity: 10, completesBuyUnit: true };
  const processed = { orders: [{ ...api, price: 49.99, quantity: 10, sources: [source] }], currentPrice: 50, skipped: [] };
  const guide = { kind: 'normal', phase: 'second_half', buyOrders: [source], sellOrders: [], warnings: [], formulas: [] };
  h.tables.meritz_runs = [{ ...batchRun(h), account_key: 'account', status: 'accepted', submission_price: 50,
    snapshot: { strategy: structuredClone(h.strategy()), guide, processed } }];
  h.tables.meritz_orders = [{ id: 'first', run_id: 'run', order_key: 'buy', status: 'accepted', broker_order_no: '101', broker_order_date: null,
    attempted_at: '2026-11-06T13:00:00Z', body: { ovrs_stck_symb_iscd: 'SOXL', ovrs_stck_oder_prc: '49.9900', oder_cls_code: '32' }, guide_order: processed.orders[0] }];
  h.history.push({ ...fill('2026-11-06'), cntg_dqty: 0, cntg_camt: 0 });
  return h;
}

test('실제 재주문 경로는 공식 날짜를 메모리에도 반영해 취소 뒤 한 번만 교체한다', async () => {
  const h = repriceFixture();
  const result = await h.reprice().runRepriceJob();
  assert.equal(outcomes(result)[0].status, 'accepted');
  assert.equal(h.tables.meritz_orders[0].broker_order_date, '20261106');
  assert.equal(h.requests.filter(r => r.endsWith('/cancel')).length, 1);
  assert.equal(h.requests.filter(r => r.endsWith('/buy')).length, 1);
  await h.reprice().runRepriceJob();
  assert.equal(h.requests.filter(r => r.endsWith('/buy')).length, 1);
});

test('5% 초과여도 재주문 내용이 기존 주문과 같으면 취소·재주문하지 않는다', async () => {
  const h = repriceFixture();
  h.client.currentPrice = async () => 55;
  const result = await h.reprice().runRepriceJob();
  assert.equal(outcomes(result)[0].status, 'unchanged');
  assert.equal(h.tables.meritz_reprices[0].status, 'unchanged');
  assert.equal(h.requests.some(r => r.endsWith('/cancel') || r.endsWith('/buy') || r.endsWith('/sell')), false);
});

test('취소 후 실패·review 저장 실패에도 취소/접수 건수와 잔존 주문 미확인 알림은 남는다', async () => {
  const h = repriceFixture(); h.faults.reviewSave = true;
  const original = h.client.rows.bind(h.client);
  h.client.rows = async (path, params) => {
    if (path.endsWith('/holdings')) throw Error('잔고 조회 실패');
    return original(path, params);
  };
  await h.reprice().runRepriceJob();
  assert.equal(h.requests.filter(r => r.endsWith('/cancel')).length, 1);
  assert.equal(h.requests.some(r => r.endsWith('/buy')), false);
  assert.match(h.notices.at(-1)!.body, /취소 접수 1건·확정 1건/);
  assert.match(h.notices.at(-1)!.body, /새 주문 0건/);
  assert.match(h.notices.at(-1)!.body, /잔존 주문은 미확인/);
});

test('취소0건 중 미전송·명확한 거절은 기존 주문 유지, 전송 후 불명은 미확인으로 구분한다',async()=>{
  for(const mode of ['preflight','not_sent','rejected','uncertain','unknown_response']) {
    const h=repriceFixture();
    if(mode==='preflight') h.client.assertTimeRemaining=()=>{throw Error('남은 시간 부족')};
    else h.client.call=async()=>{
      if(mode==='rejected')return {rsp_cd:'0002',data:{warn_cls_code:'0'}};
      if(mode==='unknown_response')return {rsp_cd:'0001',data:{warn_cls_code:'0'}};
      throw new BrokerRequestError('모의 오류',mode==='uncertain');
    };
    await h.reprice().runRepriceJob();
    const body=h.notices.at(-1)!.body;
    assert.match(body,/취소 접수 0건·확정 0건/);
    if(mode==='uncertain'||mode==='unknown_response') {assert.match(body,/잔존 주문은 미확인/);assert.doesNotMatch(body,/기존 주문 유지/);}
    else {assert.match(body,/기존 주문 유지/);assert.doesNotMatch(body,/잔존 주문은 미확인/);}
    assert.equal(h.requests.some(path=>path.endsWith('/buy')||path.endsWith('/sell')),false);
    if(mode==='not_sent')assert.equal(h.tables.meritz_cancellations[0].response.transmission,'not_sent');
  }
});
