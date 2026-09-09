import assert from 'node:assert/strict';
import test from 'node:test';
import { readCachePolicy, READ_CACHE_TAG, MARKET_CACHE_TAG } from './readCachePolicy';

const url = (path: string) => `https://example.supabase.co/rest/v1/${path}`;
test('조회용 종가와 기록은 만료 시간과 갱신 태그를 공유한다', () => {
  for (const table of ['daily_prices','executions','completed_rounds','strategy_snapshots','strategy_adjustments']) {
    const policy = readCachePolicy(url(`${table}?strategy_id=eq.test`));
    assert.equal(policy.cache, 'force-cache');
    assert.equal(policy.next?.revalidate, 60);
    assert.deepEqual(policy.next?.tags, [READ_CACHE_TAG]);
  }
  assert.deepEqual(readCachePolicy(url('market_candles')).next?.tags, [READ_CACHE_TAG, MARKET_CACHE_TAG]);
});
test('현재 잔고, 요청 중복 검사, AI 진행 상태와 모든 쓰기는 캐시하지 않는다', () => {
  for (const table of ['strategies','strategy_write_requests','ai_chart_analyses','rpc/commit_strategy_execution']) {
    assert.equal(readCachePolicy(url(table)).cache, 'no-store');
  }
  for (const method of ['POST','PATCH','DELETE','HEAD']) {
    assert.equal(readCachePolicy(url('executions'), method).cache, 'no-store');
  }
  assert.equal(readCachePolicy('https://example.supabase.co/auth/v1/user').cache, 'no-store');
});

test('메뉴용 메인 ID만 캐시하고 잔고와 버전이 포함된 전략 조회는 항상 최신 값을 읽는다', () => {
  assert.equal(readCachePolicy(url('strategies?select=id&is_main=eq.true&is_archived=eq.false')).cache, 'force-cache');
  assert.equal(readCachePolicy(url('strategies?select=*&is_main=eq.true&is_archived=eq.false')).cache, 'no-store');
  assert.equal(readCachePolicy(url('strategies?select=id,version&is_main=eq.true&is_archived=eq.false')).cache, 'no-store');
});
