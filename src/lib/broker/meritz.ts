import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { SymbolCode } from '@/lib/types';

const BASE = 'https://openapi.imeritz.com:9443';
const OK = new Set(['0000', '0001', '5620', '5762', '5766', '5820', '5822']);
export type BrokerBody = Record<string, unknown> & { data?: unknown; rsp_cd?: string; rsp_msg?: string; rsp_sub_msg?: string };
export type BrokerRow = Record<string, string | number | null>;

export class BrokerRequestError extends Error {
  constructor(message: string, readonly requestSent: boolean) { super(message); this.name = 'BrokerRequestError'; }
}

export function brokerConfigured() { return Boolean(process.env.MERITZ_APP_KEY && process.env.MERITZ_APP_SECRET); }
export function accountKey() {
  if (!brokerConfigured()) throw new Error('메리츠 API 키가 설정되지 않았습니다.');
  return createHash('sha256').update(process.env.MERITZ_APP_KEY!).digest('hex');
}
export class MeritzClient {
  private token = '';
  private authenticating: Promise<void> | null = null;
  private lastStart = Number.NEGATIVE_INFINITY;
  private queue: Promise<void> = Promise.resolve();
  private longestRequestMs = 0;
  lastPageCount = 1;
  lastPageSize = 1;
  constructor(private options: { key?: string; secret?: string; fetcher?: typeof fetch;
    wait?: (ms: number) => Promise<unknown>; clock?: () => number; beforeRequest?: () => Promise<void>;
    deadline?: number } = {}) {}
  remainingMs() { return (this.options.deadline ?? Infinity) - (this.options.clock ?? Date.now)(); }
  estimatedRequestMs() { return Math.max(1000, this.longestRequestMs) * 1.1; }
  assertTimeRemaining(requiredMs = 0) {
    if (this.remainingMs() <= requiredMs) throw new Error('남은 처리 시간이 부족합니다. 기존 주문내역을 확인해 주세요.');
  }
  private key() { return this.options.key ?? process.env.MERITZ_APP_KEY ?? ''; }
  private secret() { return this.options.secret ?? process.env.MERITZ_APP_SECRET ?? ''; }
  clean(value: unknown) {
    let text = String(value ?? '');
    for (const secret of [this.key(), this.secret(), this.token].filter(Boolean)) text = text.split(secret).join('[숨김]');
    return text;
  }
  private async pacedFetch(path: string, init: RequestInit, onSend?: () => void,
    beforeSend?: () => void | Promise<void>): Promise<{ status: number; body: BrokerBody }> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(r => { release = r; });
    await previous;
    try {
      const now = this.options.clock ?? Date.now;
      await (this.options.wait ?? sleep)(Math.max(0, 1000 - (now() - this.lastStart)));
      await this.options.beforeRequest?.();
      await beforeSend?.();
      this.assertTimeRemaining();
      this.lastStart = now();
      let response: Response;
      try {
        const request: RequestInit = { ...init, cache: 'no-store', redirect: 'error',
          signal: AbortSignal.timeout(Math.max(1, Math.min(15000, this.remainingMs()))) };
        onSend?.();
        response = await (this.options.fetcher ?? fetch)(`${BASE}${path}`, request);
      } catch { throw new Error('메리츠 서버 응답을 받지 못했습니다. 주문 전송 후라면 접수 여부 확인이 필요합니다.'); }
      let body: BrokerBody;
      try { body = await response.json(); } catch { throw new Error('메리츠 응답 형식을 확인하지 못했습니다.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('메리츠 응답 형식이 잘못되었습니다.');
      this.longestRequestMs = Math.max(this.longestRequestMs, now() - this.lastStart);
      return { status: response.status, body };
    } finally { release(); }
  }
  async authenticate() {
    if (this.token) return;
    if (this.authenticating) return this.authenticating;
    this.authenticating = this.issueToken();
    try { await this.authenticating; } finally { this.authenticating = null; }
  }
  private async issueToken() {
    if (!this.key() || !this.secret()) throw new Error('메리츠 API 키가 설정되지 않았습니다.');
    const r = await this.pacedFetch('/oauth2/token', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'login', client_id: this.key(), client_secret: this.secret() }) });
    if (typeof r.body.access_token === 'string') this.token = r.body.access_token;
    if (r.status >= 400 || !this.token) {
      const message = this.clean(`메리츠 인증 실패: ${r.body.rsp_cd ?? r.body.error ?? ''} ${r.body.rsp_msg ?? ''}`);
      this.token = ''; throw new Error(message);
    }
  }
  async call(path: string, params: Record<string, string> = {}, body?: Record<string, unknown>, raw = false,
    beforeSend?: () => void | Promise<void>) {
    let requestSent = false;
    try {
      await this.authenticate();
      const mac = (process.env.MERITZ_MAC_ADDRESS ?? createHash('sha256').update(this.key()).digest('hex').slice(0, 12)).replace(/[:-]/g, '').toUpperCase();
      if (!/^[0-9A-F]{12}$/.test(mac)) throw new Error('MERITZ_MAC_ADDRESS 형식을 확인해 주세요.');
      const query = new URLSearchParams(params).toString();
      const result = await this.pacedFetch(`${path}${query ? `?${query}` : ''}`, {
        method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${this.token}`, mac_address: mac,
          ...(body ? { 'content-type': 'application/json; charset=utf-8' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
      }, () => { requestSent = true; }, beforeSend);
      if (result.status < 200 || result.status >= 300) throw new Error(this.clean(`메리츠 HTTP ${result.status}: ${result.body.rsp_cd ?? ''} ${result.body.rsp_msg ?? ''}`));
      if (!raw && !OK.has(String(result.body.rsp_cd))) {
        throw new Error(this.clean(`${result.body.rsp_cd ?? 'UNKNOWN'}: ${result.body.rsp_msg ?? ''} ${result.body.rsp_sub_msg ?? ''}`));
      }
      return result.body;
    } catch (error) {
      throw new BrokerRequestError(this.clean(error instanceof Error ? error.message : error), requestSent);
    }
  }
  async rows(path: string, params: Record<string, string> = {}) {
    const rows: BrokerRow[] = [], keys = new Set<string>(); let key: string | null = null;
    this.lastPageCount = 0; this.lastPageSize = 1;
    for (let page = 0; page < 100; page++) {
      const body = await this.call(path, { ...params, ...(key === null ? {} : { tr_cont: '1', tr_cont_key: key }) });
      if (!Array.isArray(body.data)) throw new Error('메리츠 조회 목록이 없습니다.');
      this.lastPageCount++; this.lastPageSize = Math.max(this.lastPageSize, body.data.length);
      rows.push(...body.data as BrokerRow[]);
      if (body.rsp_cd !== '5762') return rows;
      if (typeof body.tr_cont_key !== 'string' || !body.tr_cont_key || keys.has(body.tr_cont_key)) throw new Error('메리츠 연속조회 키를 확인해 주세요.');
      key = body.tr_cont_key; keys.add(key);
    }
    throw new Error('메리츠 조회 페이지 한도를 초과했습니다.');
  }
  async currentPrice(symbol: SymbolCode) {
    const r = await this.call('/market/v1/overseas/prices', { mrkt_div_code: 'OV', mrkt_cls_code: 'AX', iscd: symbol, dely_rltm_cls_code: '0' });
    const d = r.data as BrokerRow | undefined;
    const price = Number(d?.prpr);
    if (d?.iscd !== symbol || !Number.isFinite(price) || price <= 0 || d?.crnc_code !== 'USD') throw new Error('종목의 현재가·통화를 확인하지 못했습니다.');
    return price;
  }
  async cashBalance() {
    // Estimated cash includes unsettled executions. Settled cash (frcr_amt)
    // and buying power can both differ from the ledger after a trade.
    const body = await this.call('/accounts/v1/me/overseas/currencies');
    if (!Array.isArray(body.data) || body.rsp_cd === '5762') throw new Error('통화별 현금 조회가 완료되지 않았습니다.');
    const usd = (body.data as BrokerRow[]).filter(row => row.crcd === 'USD');
    const raw = usd[0]?.estm_frcr_amt;
    if (usd.length !== 1 || raw === null || raw === undefined || String(raw).trim() === ''
      || !Number.isFinite(Number(raw)) || Number(raw) < 0) throw new Error('USD 추정 예수금을 확인하지 못했습니다.');
    return Number(raw);
  }
  async assertMarketOpen(allowPreOpen = false) {
    // Scheduled/manual pre-open entry is already bounded by the Korea 22:00
    // window and US calendar. The market-status API describes regular trading,
    // not whether LOC/MOC orders can be accepted, so do not query it here.
    if (allowPreOpen) return;
    const r = await this.call('/reference/v1/overseas/market-hours', { ovrs_stck_mrkt_tr_cls_code: '01' });
    const d = r.data as BrokerRow | undefined;
    if (d?.ovrs_mkop_cls_code !== '004') throw new Error('메리츠에서 미국 주문 시간의 장운영 상태를 확인하지 못했습니다.');
  }
}
