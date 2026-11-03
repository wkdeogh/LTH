import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationTime, notificationMeaning, type NotificationItem } from './notificationPresentation';
import { normalizeDetails, recordedFillsMatch } from './reconciliation';

test('알림은 접속 기기 시간대와 무관하게 한국 날짜·시각을 표시한다',()=>{
  assert.equal(notificationTime('2026-11-03T13:00:12.022Z'),'2026.11.03 22:00');
  assert.equal(notificationTime('2026-11-03T15:00:01Z',true),'2026.11.04 00:00:01');
  assert.equal(notificationTime('bad'),'시간 정보 없음');
});
test('장운영 사전 검사와 실제 주문 거절을 구분하고 수동 입력은 중복을 권하지 않는다',()=>{
  const item:NotificationItem={id:'test',strategy_id:null,title:'SOXL 자동주문 확인 필요',body:'메리츠에서 미국 주문 시간의 장운영 상태를 확인하지 못했습니다.',tone:'warning',read_at:null,created_at:'2026-11-03T13:00:12Z'};
  assert.match(notificationMeaning(item).meaning,/주문 접수 여부를 알려주는 증권사 거절 메시지와는 구분/);
  assert.match(notificationMeaning({...item,body:'수동 주문의 가격·수량이 가이드와 달라 T값 확인이 필요합니다.'}).next,/또 입력할 필요가 없습니다/);
});
test('수동 체결 대조는 가이드 수량과 무관하게 실제 매수·매도 수량과 금액을 정확히 비교한다',()=>{
  const fills=[{side:'buy' as const,quantity:60,amount:4090.2},{side:'buy' as const,quantity:27,amount:1840.59}];
  const local=[{side:'buy',quantity:87,total_amount:'5930.7900'}];
  assert.equal(recordedFillsMatch(fills,local),true);
  assert.equal(recordedFillsMatch(fills,[{...local[0],quantity:88}]),false);
  assert.equal(recordedFillsMatch(fills,[{...local[0],total_amount:5930.8}]),false);
  assert.equal(recordedFillsMatch(fills,[...local,{side:'sell',quantity:1,total_amount:68.17}]),false);
  assert.equal(recordedFillsMatch([],[]),false);
});
test('부분체결 자동 T 추정은 계속 막고, 이미 수동 입력한 경우에만 체결 원본 합계를 대조한다',()=>{
  const history={oder_no:101,oder_date:'20261102',oder_dqty:'100',cntg_dqty:'87',cntg_camt:'5930.79'};
  const detail={oder_no:101,oder_date:'20261102',cntg_no:9,iscd:'SOXL.AX',seln_byov_clcd:'2',aspr_type_code:'5',cntg_dqty:'87',cntg_camt:'5930.79',ovrs_stck_oder_prc:'90',cntg_ymdh:'2026-11-03 06:00:00'};
  assert.throws(()=>normalizeDetails([detail],history),/부분체결/);
  const fills=normalizeDetails([detail],history,{recordedManually:true});
  assert.equal(recordedFillsMatch(fills,[{side:'buy',quantity:87,total_amount:5930.79}]),true);
  assert.throws(()=>normalizeDetails([{...detail,cntg_camt:'5930.80'}],history,{recordedManually:true}),/일치하지/);
});
