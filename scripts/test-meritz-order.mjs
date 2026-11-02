// Reference: meritz-securities/open-api @ a93c6409db73ea97ad15f7b7186f36c9f32ecd89
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { macAddress, redact } from './test-meritz.mjs';

const BASE_URL = 'https://openapi.imeritz.com:9443';
const ORDER_PATH = '/trading/v1/overseas/orders/buy';

export function buildOrder() {
  return {
    ovrs_stck_symb_iscd: 'SOXL',
    ovrs_exch_vndr_idno: '0066',
    oder_cls_code: '32',
    oder_cond_cls_code: '7',
    odqt: 1,
    ovrs_stck_oder_prc: '110.0000',
    warn_cnfr_yn: 'N',
  };
}

export function classifyOrderResponse(body) {
  const data = body?.data;
  const warning = data?.warn_cls_code;
  if (warning != null && String(warning) !== '0') {
    return { state: 'not_accepted', retryableWarning: ['1', '3'].includes(String(warning)) };
  }
  const hasOrderNumber = typeof data?.oder_no === 'number'
    ? Number.isSafeInteger(data.oder_no) && data.oder_no > 0
    : typeof data?.oder_no === 'string' && /^[1-9]\d*$/.test(data.oder_no);
  if (body?.rsp_cd === '0001' && String(warning) === '0' && hasOrderNumber) {
    return { state: 'accepted' };
  }
  if (typeof body?.rsp_cd === 'string' && body.rsp_cd && body.rsp_cd !== '0001') {
    return { state: 'rejected' };
  }
  return { state: 'unknown' };
}

export async function runOrderTest({
  send = false, env = process.env, fetchImpl = fetch, emit = console.log,
} = {}) {
  const order = buildOrder();
  const secrets = [env.MERITZ_APP_KEY, env.MERITZ_APP_SECRET];
  const report = (value) => emit(redact(JSON.stringify(value, null, 2), secrets));
  report({ 단계: '주문 미리보기', 전송: false,
    종목: 'SOXL', 방향: '매수', 주문유형: 'LOC', 수량: 1, 지정가_USD: '200.00',
    주문금액_USD_수수료제외: '200.00', method: 'POST', url: `${BASE_URL}${ORDER_PATH}`, body: order });
  if (!send) return 0;

  let orderDispatched = false;
  let stage = '설정 확인';
  async function request(path, init) {
    let response;
    try {
      response = await fetchImpl(`${BASE_URL}${path}`, {
        ...init, redirect: 'error', signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      throw new Error(`연결 오류 (${error.cause?.code || error.code || error.name || 'NETWORK_ERROR'})`);
    }
    let body;
    try { body = await response.json(); }
    catch { throw new Error(`JSON 응답을 읽지 못했습니다 (HTTP ${response.status}).`); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error(`응답 형식이 잘못되었습니다 (HTTP ${response.status}).`);
    }
    return { status: response.status, body };
  }

  try {
    if (env.MERITZ_READ_ONLY !== '0') {
      throw new Error('전송하려면 MERITZ_READ_ONLY=0을 명시해 주세요.');
    }
    const missing = ['MERITZ_APP_KEY', 'MERITZ_APP_SECRET'].filter((key) => !env[key]?.trim());
    if (missing.length) throw new Error(`키 설정이 필요합니다: ${missing.join(', ')}`);
    const mac = macAddress(env.MERITZ_MAC_ADDRESS);

    stage = '토큰 발급';
    const auth = await request('/oauth2/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'login',
        client_id: env.MERITZ_APP_KEY, client_secret: env.MERITZ_APP_SECRET }),
    });
    const token = auth.body.access_token;
    if (typeof token === 'string' && token) secrets.push(token);
    if (auth.status >= 400 || typeof token !== 'string' || !token) {
      report({ 단계: '토큰 발급 실패', 주문전송: false, HTTP: auth.status,
        코드: auth.body.rsp_cd || auth.body.error,
        메시지: auth.body.rsp_msg || auth.body.error_description, 상세: auth.body.rsp_sub_msg });
      return 1;
    }

    stage = '주문 응답 확인';
    orderDispatched = true;
    // Send once. A timeout may occur after acceptance; never retry automatically.
    const response = await request(ORDER_PATH, {
      method: 'POST', headers: { 'content-type': 'application/json',
        authorization: `Bearer ${token}`, mac_address: mac },
      body: JSON.stringify(order),
    });
    const result = classifyOrderResponse(response.body);
    const data = response.body.data;
    const labels = { accepted: '주문 접수 확인', not_accepted: '경고·보류로 주문 미접수',
      rejected: '주문 거절', unknown: '주문 접수 여부 미확인' };
    report({ 단계: labels[result.state], HTTP: response.status, 코드: response.body.rsp_cd,
      메시지: response.body.rsp_msg, 상세: response.body.rsp_sub_msg,
      주문번호: data?.oder_no, 경고코드: data?.warn_cls_code, 경고내용: data?.warn_msg,
      ...(result.state === 'accepted' ? { 체결여부: '미확인' } : {}),
      ...(result.state === 'unknown' ? { 안내: '재실행 전 메리츠 주문내역에서 접수 여부를 확인해 주세요.' } : {}),
      자동재전송: false });
    return result.state === 'accepted' ? 0 : result.state === 'unknown' ? 3 : 1;
  } catch (error) {
    report({ 단계: orderDispatched ? '주문 접수 여부 미확인' : `${stage} 실패`,
      메시지: error.message, 주문요청시도: orderDispatched, 자동재전송: false,
      ...(orderDispatched ? { 안내: '재실행 전 메리츠 주문내역에서 접수 여부를 확인해 주세요.' } : {}) });
    return orderDispatched ? 3 : 1;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--send', '--help'].includes(arg))) {
    console.error('지원 옵션: --help, --send');
    return 2;
  }
  if (args.includes('--help')) {
    console.log('SOXL 1주 · $200 · LOC 매수 API 테스트\n'
      + 'npm run test:meritz:order                         주문 미리보기 (네트워크 요청 없음)\n'
      + 'MERITZ_READ_ONLY=0 npm run test:meritz:order -- --send   실계좌 주문 1회 전송\n'
      + '.env.local의 MERITZ_APP_KEY / MERITZ_APP_SECRET 사용. 자동 재전송 없음.');
    return 0;
  }
  if (args.includes('--send')) {
    const envFile = fileURLToPath(new URL('../.env.local', import.meta.url));
    if (existsSync(envFile)) process.loadEnvFile(envFile);
  }
  return runOrderTest({ send: args.includes('--send') });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch(() => {
    console.error('테스트를 완료하지 못했습니다. 전송 모드였다면 재실행 전 메리츠 주문내역을 확인해 주세요.');
    process.exitCode = 1;
  });
}
