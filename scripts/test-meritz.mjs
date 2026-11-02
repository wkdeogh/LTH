// Official reference: meritz-securities/open-api @ a93c6409db73ea97ad15f7b7186f36c9f32ecd89
// Only token issuance and overseas price GET requests are implemented.
import { networkInterfaces } from 'node:os';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const BASE_URL = 'https://openapi.imeritz.com:9443';
const PRICE_PATH = '/market/v1/overseas/prices';
const OK_CODES = new Set(['0000', '0001', '5620', '5762', '5766', '5820', '5822']);
const TARGETS = [{ symbol: 'TQQQ', exchange: 'OQ' }, { symbol: 'SOXL', exchange: 'AX' }];

export function macAddress(override) {
  const found = Object.values(networkInterfaces()).flat().find(
    (item) => item && !item.internal && item.mac && item.mac !== '00:00:00:00:00:00',
  );
  const mac = (override || found?.mac || '').replace(/[:-]/g, '').toUpperCase();
  if (!/^[A-F0-9]{12}$/.test(mac) || mac === '000000000000') {
    throw new Error('유효한 MAC 주소가 없습니다. MERITZ_MAC_ADDRESS에 12자리 주소를 설정해 주세요.');
  }
  return mac;
}

export function redact(value, secrets) {
  let text = String(value ?? '');
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join('[숨김]');
  }
  return text;
}

export async function runMeritzTest({
  env = process.env, fetchImpl = fetch, emit = console.log,
  probe = false, tokenOnly = false, delayed = false,
} = {}) {
  const secrets = [env.MERITZ_APP_KEY, env.MERITZ_APP_SECRET];
  const report = (result) => emit(redact(JSON.stringify(result, null, 2), secrets));
  async function request(path, options = {}) {
    let response;
    try {
      response = await fetchImpl(`${BASE_URL}${path}`, {
        ...options, redirect: 'error', signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      const code = error.cause?.code || error.code || error.name || 'NETWORK_ERROR';
      throw new Error(`메리츠 서버 연결 실패 (${redact(code, secrets)}). 네트워크와 9443 포트 접근을 확인해 주세요.`);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error(`메리츠 응답이 JSON이 아닙니다 (HTTP ${response.status}).`);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error(`메리츠 응답 형식이 잘못되었습니다 (HTTP ${response.status}).`);
    }
    return { status: response.status, body };
  }

  try {
    if (probe) {
      const { status, body } = await request(`${PRICE_PATH}?${new URLSearchParams({
        mrkt_div_code: 'OV', mrkt_cls_code: 'OQ', iscd: 'TQQQ', dely_rltm_cls_code: '0',
      })}`);
      if (!body.rsp_cd) throw new Error('메리츠 인증 전 응답에 rsp_cd가 없습니다.');
      report({ 단계: '인증 전 서버 연결 확인', HTTP: status, 코드: body.rsp_cd,
        메시지: body.rsp_msg, 상세: body.rsp_sub_msg, 인증된_조회: false });
      return 0;
    }

    const missing = ['MERITZ_APP_KEY', 'MERITZ_APP_SECRET'].filter((key) => !env[key]?.trim());
    if (missing.length) throw new Error(`키 설정이 필요합니다: ${missing.join(', ')}. .env.local에 추가해 주세요.`);
    const mac = macAddress(env.MERITZ_MAC_ADDRESS);
    const tokenResponse = await request('/oauth2/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials',
        client_id: env.MERITZ_APP_KEY, client_secret: env.MERITZ_APP_SECRET, scope: 'login' }),
    });
    const token = tokenResponse.body.access_token;
    if (typeof token !== 'string' || !token || tokenResponse.status >= 400) {
      report({ 단계: '토큰 발급 실패', HTTP: tokenResponse.status,
        코드: tokenResponse.body.rsp_cd || tokenResponse.body.error,
        메시지: tokenResponse.body.rsp_msg || tokenResponse.body.error_description,
        상세: tokenResponse.body.rsp_sub_msg });
      return 1;
    }
    secrets.push(token);
    report({ 단계: '토큰 발급 성공', 유효기간_초: tokenResponse.body.expires_in ?? null });
    if (tokenOnly) return 0;

    let failed = false;
    for (const [index, target] of TARGETS.entries()) {
      if (index) await delay(150);
      const params = new URLSearchParams({ mrkt_div_code: 'OV',
        mrkt_cls_code: target.exchange, iscd: target.symbol, dely_rltm_cls_code: delayed ? '1' : '0' });
      const { status, body } = await request(`${PRICE_PATH}?${params}`, {
        headers: { authorization: `Bearer ${token}`, mac_address: mac },
      });
      // Meritz returns business errors as HTTP 500. Judge rsp_cd, then actual data.
      const data = body.data;
      const hasPrice = data && !Array.isArray(data) && data.iscd === target.symbol
        && Number.isFinite(Number(data.prpr)) && Number(data.prpr) > 0;
      const success = OK_CODES.has(body.rsp_cd) && hasPrice;
      failed ||= !success;
      report({ 단계: success ? '시세 조회 성공' : '시세 조회 미확인',
        종목: target.symbol, 거래소_코드: target.exchange, 시세_구분: delayed ? '지연' : '실시간 요청',
        HTTP: status, 코드: body.rsp_cd, 메시지: body.rsp_msg, 상세: body.rsp_sub_msg,
        ...(success ? { 종목명: data.kor_isnm, 현재가: data.prpr, 통화: data.crnc_code,
          전일대비율: data.prdy_ctrt, 누적거래량: data.acml_vol } : {}),
      });
      // Permission and rate-limit errors are not fixed by issuing another token.
      if (['0760', 'EGW00200'].includes(body.rsp_cd)) break;
    }
    return failed ? 1 : 0;
  } catch (error) {
    report({ 단계: '테스트 중단', 메시지: redact(error.message, secrets) });
    return 1;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(['--probe', '--token-only', '--delayed', '--help']);
  if (args.some((arg) => !flags.has(arg))) {
    console.error('지원하지 않는 옵션입니다. npm run test:meritz -- --help로 확인해 주세요.');
    return 2;
  }
  if (args.includes('--help')) {
    console.log('메리츠 연결 테스트 (토큰 발급 + TQQQ/SOXL 시세 조회)\n'
      + 'npm run test:meritz\n'
      + '  --probe       키 없이 서버 연결만 확인\n'
      + '  --token-only  토큰 발급만 확인\n'
      + '  --delayed     지연 시세 요청\n'
      + '.env.local: MERITZ_APP_KEY, MERITZ_APP_SECRET (선택: MERITZ_MAC_ADDRESS)\n'
      + '키와 토큰은 출력하거나 저장하지 않습니다.');
    return 0;
  }
  const envFile = fileURLToPath(new URL('../.env.local', import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  return runMeritzTest({ probe: args.includes('--probe'), tokenOnly: args.includes('--token-only'),
    delayed: args.includes('--delayed') });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch(() => {
    console.error('테스트 설정 파일을 읽을 수 없습니다. .env.local 형식을 확인해 주세요.');
    process.exitCode = 1;
  });
}
