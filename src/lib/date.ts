const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;

export function koreaDate(offsetDays = 0, now = new Date()) {
  const koreaTime = new Date(now.getTime() + KOREA_OFFSET_MS);
  koreaTime.setUTCDate(koreaTime.getUTCDate() + offsetDays);
  return koreaTime.toISOString().slice(0, 10);
}
