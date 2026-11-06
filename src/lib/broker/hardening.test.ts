import test from 'node:test';
import assert from 'node:assert/strict';
import { BrokerRequestError, MeritzClient, type BrokerRow } from './meritz';
import { blocksSessionOrder, brokerSession } from './reconciliation';
import { initialOrderSession, openingWindow, repriceWindow } from './calendar';
import { cancelThenReplace, isCancellationConfirmed, replacementBudgetMs, type CancellationTarget } from './repricing-policy';
import { waitForOrderFunding } from './funding';
import { pollRead } from './polling';

const source = { side: 'buy' as const, orderType: 'LOC' as const, price: 10, quantity: 1, label: '기본', note: '' };
const order = { ...source, key: 'buy', sources: [source] };
function clock() {
  let now = 0;
  return { clock: () => now, wait: async (ms: number) => { now += ms; }, advance: (ms: number) => { now += ms; } };
}
function target(index = 0): CancellationTarget {
  const row: BrokerRow = { oder_date: '20261106', oder_no: 101 + index, oder_rctf_cncl_cls_code: '0',
    iscd: 'SOXL.AX', seln_byov_clcd: '2', aspr_type_code: '5', ovrs_stck_oder_prc: 10,
    odqt: 1, cntg_qty: 0, cncl_cnfr_qty: 0, rctf_cnfr_qty: 0, ncnt_qty: 1, oder_able_qty: 1 };
  return { quantity: 1, history: row, order: { id: String(index), order_key: 'buy', body: {
    ovrs_stck_symb_iscd: 'SOXL', ovrs_stck_oder_prc: '10' }, guide_order: order,
    status: 'accepted', broker_order_no: String(101 + index), broker_order_date: '20261106', attempted_at: '2026-11-06T13:00:00Z' } };
}
function confirmed(t: CancellationTarget, date = '20261106') {
  const original = { ...t.history, ncnt_qty: 0, oder_able_qty: 0, oder_exec_ymdh: '2026-11-07 03:00:00' };
  return [original, { ...original, oder_date: date, oder_no: Number(t.order.broker_order_no) + 100,
    orgl_oder_no: t.order.broker_order_no, oder_rctf_cncl_cls_code: '2', ovrs_stck_oder_stat_cls_code: '0',
    rctf_cncl_cls_code: '3', cncl_cnfr_qty: 1 }];
}

test('중복 검사는 전날 새벽 주문만 배제하고 당일·예약·휴장일·불명확한 시각은 계속 차단한다', () => {
  const row = { iscd: 'SOXL.AX', oder_rctf_cncl_cls_code: '0', ovrs_stck_oder_stat_cls_code: '0', oder_dqty: 1 };
  for (const status of ['0','3']) {
    assert.equal(blocksSessionOrder({ ...row, ovrs_stck_oder_stat_cls_code: status, oder_exec_ymdh: '2026-11-06 03:00:00' }, 'SOXL', '2026-11-06'), false);
  }
  assert.equal(blocksSessionOrder({ ...row, oder_exec_ymdh: '2026-11-06 22:00:00' }, 'SOXL', '2026-11-06'), true);
  assert.equal(blocksSessionOrder({ ...row, oder_exec_ymdh: '2026-11-09 22:00:00' }, 'SOXL', '2026-11-06'), true);
  assert.equal(blocksSessionOrder({ ...row, oder_exec_ymdh: '2026-11-07 22:00:00' }, 'SOXL', '2026-11-09'), true);
  assert.equal(blocksSessionOrder({ ...row, iscd: 'OTHER.OQ', oder_exec_ymdh: '' }, 'SOXL', '2026-11-06'), false);
  assert.throws(() => blocksSessionOrder({ ...row, oder_exec_ymdh: '' }, 'SOXL', '2026-11-06'), /접수 시각/);
  assert.throws(() => brokerSession({ oder_exec_ymdh: '2026-02-30 22:00:00' }), /잘못/);
});

test('미국 마감 전의 과거 주문만 무시하며 마감 정각·한국 낮·조기폐장 이후는 계속 차단한다', () => {
  const row={iscd:'SOXL.AX',oder_rctf_cncl_cls_code:'0',ovrs_stck_oder_stat_cls_code:'0',oder_dqty:1};
  const cases:[string,string,boolean][]=[
    ['2026-11-06 03:00:00','2026-11-06',false],
    ['2026-11-06 05:59:59','2026-11-06',false],
    ['2026-11-06 06:00:00','2026-11-06',true],
    ['2026-11-06 10:00:00','2026-11-06',true],
    ['2026-11-06 18:00:00','2026-11-06',true],
    ['2026-07-07 04:59:59','2026-07-07',false],
    ['2026-07-07 05:00:00','2026-07-07',true],
    ['2026-07-07 10:00:00','2026-07-07',true],
    ['2026-11-28 02:59:59','2026-11-30',false],
    ['2026-11-28 03:00:00','2026-11-30',true],
    ['2026-11-07 10:00:00','2026-11-09',true],
  ];
  for(const [stamp,session,blocked] of cases) assert.equal(blocksSessionOrder({...row,oder_exec_ymdh:stamp},'SOXL',session),blocked,stamp);
});

test('지연 시작·제출·워치독의 허용 경계와 조기폐장 제한을 분리한다', () => {
  assert.equal(openingWindow(new Date('2026-11-06T13:02:59Z')), true);
  assert.equal(openingWindow(new Date('2026-11-06T13:03:00Z')), false);
  assert.equal(initialOrderSession(new Date('2026-11-06T13:04:59Z')), true);
  assert.equal(initialOrderSession(new Date('2026-11-06T13:05:00Z')), false);
  for (const fn of [openingWindow, repriceWindow]) {
    const hour = fn === openingWindow ? '13' : '18';
    assert.equal(fn(new Date(`2026-11-06T${hour}:04:59Z`), true), false);
    assert.equal(fn(new Date(`2026-11-06T${hour}:09:59Z`), true), true);
    assert.equal(fn(new Date(`2026-11-06T${hour}:10:00Z`), true), false);
  }
  assert.equal(repriceWindow(new Date('2026-11-06T18:04:59Z')), true);
  assert.equal(repriceWindow(new Date('2026-11-06T18:05:00Z')), false);
  assert.equal(repriceWindow(new Date('2026-11-27T18:01:00Z')), false);
});

test('인증·시간 검사 실패는 미전송이며 POST 응답 유실·파싱 실패·HTTP 오류는 불명으로 유지한다', async () => {
  for (const mode of ['auth','deadline','network','parse','http']) {
    let posts = 0;
    const c = new MeritzClient({ key: 'fixture-key', secret: 'fixture-secret', wait: async () => {},
      beforeRequest: async () => { if (mode === 'deadline' && posts === 0) throw Error('시간 부족'); },
      fetcher: async url => {
        if (String(url).includes('oauth2')) return new Response(JSON.stringify(mode === 'auth' ? {} : { access_token: 'fixture-token' }));
        posts++;
        if (mode === 'network') throw Error('network');
        if (mode === 'parse') return new Response('invalid json');
        return new Response(JSON.stringify({ rsp_cd: '0001', data: { warn_cls_code: '0', oder_no: 1 } }), { status: 500 });
      } });
    await assert.rejects(c.call('/trading/v1/overseas/orders/buy', {}, { odqt: 1 }, true), error => {
      assert.ok(error instanceof BrokerRequestError);
      assert.equal(error.requestSent, !['auth','deadline'].includes(mode));
      return true;
    });
    assert.equal(posts, ['auth','deadline'].includes(mode) ? 0 : 1);
  }
});

test('호출 간격 대기 중 마감된 요청은 fetch 직전 다시 차단한다', async () => {
  const time = clock(); let posts = 0;
  const c = new MeritzClient({ key: 'k', secret: 's', ...time, deadline: 500,
    fetcher: async url => { if (!String(url).includes('oauth2')) posts++; return new Response(JSON.stringify({ access_token: 't' })); } });
  await assert.rejects(c.call('/trading/v1/overseas/orders/buy', {}, { odqt: 1 }, true), error => error instanceof BrokerRequestError && !error.requestSent);
  assert.equal(posts, 0);
});

test('매수·매도·취소 모두 남은15초 미만은 미전송, 정확히15초부터는 15초 응답 한도로 보낸다', async t => {
  const timeouts:number[]=[];
  t.mock.method(AbortSignal,'timeout',(ms:number)=>{timeouts.push(ms);return new AbortController().signal});
  for(const path of ['buy','sell','cancel'])for(const remaining of [300,14999,15000,15001]) {
    const time=clock();let posts=0;
    const client=new MeritzClient({key:'fixture-key',secret:'fixture-secret',...time,deadline:240000,
      fetcher:async(url)=>{
        if(String(url).includes('oauth2'))return new Response(JSON.stringify({access_token:'fixture-token'}));
        posts++;time.advance(500);
        return new Response(JSON.stringify({rsp_cd:'0001',data:{warn_cls_code:'0',oder_no:101}}));
      }});
    await client.authenticate();time.advance(240000-remaining);timeouts.length=0;
    const call=client.call(`/trading/v1/overseas/orders/${path}`,{}, {odqt:1},true);
    if(remaining<15000) {
      await assert.rejects(call,e=>e instanceof BrokerRequestError&&!e.requestSent&&/15초/.test(e.message));
      assert.equal(posts,0);assert.deepEqual(timeouts,[]);
    } else {
      assert.equal((await call).rsp_cd,'0001');assert.equal(posts,1);assert.deepEqual(timeouts,[15000]);
    }
  }
});

test('송신 직전 검사나 호출 간격 대기로 15초 여유가 사라지면 POST를 보내지 않는다',async()=>{
  const time=clock();let posts=0;
  const client=new MeritzClient({key:'k',secret:'s',...time,deadline:240000,fetcher:async url=>{
    if(!String(url).includes('oauth2'))posts++;
    return new Response(JSON.stringify({access_token:'fixture-token'}));
  }});
  await client.authenticate();time.advance(225000);
  await assert.rejects(client.call('/trading/v1/overseas/orders/cancel',{}, {odqt:1},true,()=>{time.advance(1)}),e=>e instanceof BrokerRequestError&&!e.requestSent);
  assert.equal(posts,0);
  const paced=new MeritzClient({key:'k',secret:'s',...clock(),deadline:15500,fetcher:async url=>{
    if(!String(url).includes('oauth2'))posts++;
    return new Response(JSON.stringify({access_token:'fixture-token'}));
  }});
  await assert.rejects(paced.call('/trading/v1/overseas/orders/buy',{}, {odqt:1},true),e=>e instanceof BrokerRequestError&&!e.requestSent);
  assert.equal(posts,0);
});

test('주문 가능 시각이 호출 간격 대기 중 끝나도 실제 POST는 전송하지 않는다', async () => {
  const time = clock(); let posts = 0;
  const client = new MeritzClient({ key: 'k', secret: 's', ...time,
    fetcher: async url => {
      if (!String(url).includes('oauth2')) posts++;
      return new Response(JSON.stringify({ access_token: 't' }));
    } });
  await assert.rejects(client.call('/trading/v1/overseas/orders/buy', {}, { odqt: 1 }, true, () => {
    if (time.clock() >= 1000) throw Error('제출 시각 종료');
  }), error => error instanceof BrokerRequestError && !error.requestSent);
  assert.equal(posts, 0);
});

test('취소 확정과 현금 반환이 4번째 이후에 나타나도 예산 안에서 기다린다', async () => {
  const time = clock(), t = target(); let cancelled = false, reads = 0, replacements = 0;
  await cancelThenReplace([t], { guard: async () => {}, polling: time,
    live: async () => !cancelled ? [t.history] : ++reads < 5 ? [t.history] : confirmed(t),
    cancel: async () => { cancelled = true; return '201'; }, confirmed: async () => {}, replace: async () => { replacements++; } });
  assert.equal(reads, 5); assert.equal(replacements, 1);
  let cashReads = 0;
  const funding = await waitForOrderFunding(1000, 1, async () => ({ cash: ++cashReads < 5 ? 0 : 1000, sellable: 1 }), time);
  assert.equal(cashReads, 5); assert.equal(funding.cash, 1000);
});

test('시간 부족·다른 대상의 부분체결을 첫 취소 전에 검출한다', async () => {
  for (const fail of ['time','partial']) {
    const first = target(), second = target(1); let cancellations = 0;
    await assert.rejects(cancelThenReplace([first, second], { guard: async () => {},
      live: async () => [first.history, { ...second.history, cntg_qty: fail === 'partial' ? 1 : 0 }],
      preflight: () => { throw Error('시간 부족'); },
      cancel: async () => { cancellations++; return '201'; }, confirmed: async () => {}, replace: async () => {} }));
    assert.equal(cancellations, 0);
  }
});

test('32건은 정상 지연이면 교체하고 다페이지·느린 지연·남은 시간 부족이면 취소 0건으로 보존한다', async () => {
  for (const scenario of [{ pages: 1, size: 32, requestMs: 1100, elapsed: 0, allowed: true },
    { pages: 3, size: 12, requestMs: 2500, elapsed: 0, allowed: false },
    { pages: 1, size: 32, requestMs: 1100, elapsed: 50000, allowed: false }]) {
    const time = clock(); time.advance(scenario.elapsed);
    const targets = Array.from({ length: 32 }, (_, i) => target(i)), cancelled = new Set<string>(); let replaced = 0;
    const task = cancelThenReplace(targets, { guard: async () => {}, polling: time,
      live: async () => { time.advance(1000 * scenario.pages); return targets.flatMap(t => cancelled.has(t.order.id) ? confirmed(t) : [t.history]); },
      preflight: () => {
        if (240000 - time.clock() <= replacementBudgetMs(32, 32, scenario.pages, scenario.size, scenario.requestMs)) throw Error('시간 부족');
      },
      cancel: async t => { time.advance(1000); cancelled.add(t.order.id); return String(Number(t.order.broker_order_no) + 100); },
      confirmed: async () => {}, replace: async () => { time.advance(32000); replaced++; } });
    if (scenario.allowed) { await task; assert.equal(cancelled.size, 32); assert.equal(replaced, 1); assert.ok(time.clock() < 240000); }
    else { await assert.rejects(task, /시간 부족/); assert.equal(cancelled.size, 0); assert.equal(replaced, 0); }
  }
});

test('취소 확인 대기 종료나 번호·날짜 불일치에서는 재주문하지 않는다', async () => {
  const t = target(), time = clock(); let replaced = 0, polls = 0;
  await assert.rejects(cancelThenReplace([t], { guard: async () => {}, polling: { ...time, timeoutMs: 30000 },
    live: async () => { polls++; return [t.history]; }, cancel: async () => '201',
    confirmed: async () => {}, replace: async () => { replaced++; } }), /취소 확정/);
  assert.equal(replaced, 0); assert.ok(polls > 3); assert.equal(time.clock(), 30000);
  assert.equal(isCancellationConfirmed(t, confirmed(t), '201'), true);
  assert.equal(isCancellationConfirmed(t, confirmed(t, '20261107'), '201'), false);
  assert.equal(isCancellationConfirmed({ ...t, order: { ...t.order, broker_order_date: null } }, confirmed(t), '201'), false);
});

test('불일치·설정 변경 예외를 polling으로 무시하지 않는다', async () => {
  let reads = 0;
  await assert.rejects(pollRead(async () => { reads++; throw Error('수량 불일치'); }, () => false, clock()), /수량 불일치/);
  assert.equal(reads, 1);
});
