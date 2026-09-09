const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;

export function koreaDate(offsetDays = 0, now = new Date()) {
  const koreaTime = new Date(now.getTime() + KOREA_OFFSET_MS);
  koreaTime.setUTCDate(koreaTime.getUTCDate() + offsetDays);
  return koreaTime.toISOString().slice(0, 10);
}

export function inclusiveDateCount(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1;
  return Math.max(Math.round((end - start) / 86_400_000) + 1, 1);
}

export function latestClosedMarketDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  const date = new Date(`${value('year')}-${value('month')}-${value('day')}T00:00:00Z`);
  if (Number(value('hour')) < 16) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function executionDateError(date: string, earliest: string | null, latest = latestClosedMarketDate()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '체결일을 선택해 주세요.';
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return '체결일을 확인해 주세요.';
  if (date > latest) return '장이 마감된 거래일까지 입력할 수 있습니다.';
  if ([0, 6].includes(parsed.getUTCDay())) return '주말은 체결일로 입력할 수 없습니다.';
  if (earliest && date < earliest) return `${earliest} 이전 체결은 저장할 수 없습니다. 최근 체결을 취소한 후 날짜순으로 입력해 주세요.`;
  return null;
}
