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
