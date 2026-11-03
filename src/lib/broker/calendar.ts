export function nyTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute), second: Number(p.second) };
}

function dateString(d: Date) { return d.toISOString().slice(0, 10); }
function nth(y: number, m: number, day: number, n: number) {
  const d = new Date(Date.UTC(y, m - 1, 1));
  return dateString(new Date(Date.UTC(y, m - 1, 1 + (day - d.getUTCDay() + 7) % 7 + (n - 1) * 7)));
}
function observed(y: number, m: number, d: number) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCDay() === 6) date.setUTCDate(d - 1);
  if (date.getUTCDay() === 0) date.setUTCDate(d + 1);
  return dateString(date);
}
function easter(y: number) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451), v = h + l - 7 * m + 114;
  return new Date(Date.UTC(y, Math.floor(v / 31) - 1, v % 31 + 1));
}
export function isTradingDay(date: string) {
  const d = new Date(`${date}T12:00:00Z`), y = d.getUTCFullYear();
  if ([0, 6].includes(d.getUTCDay())) return false;
  const goodFriday = easter(y); goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  const memorial = new Date(Date.UTC(y, 4, 31));
  memorial.setUTCDate(31 - (memorial.getUTCDay() - 1 + 7) % 7);
  const newYear = new Date(Date.UTC(y, 0, 1));
  if (newYear.getUTCDay() === 0) newYear.setUTCDate(2);
  return !new Set([dateString(newYear), nth(y, 1, 1, 3), nth(y, 2, 1, 3), dateString(goodFriday),
    dateString(memorial), observed(y, 6, 19), observed(y, 7, 4), nth(y, 9, 1, 1), nth(y, 11, 4, 4), observed(y, 12, 25)]).has(date);
}
export function closeMinute(date: string) {
  const y = Number(date.slice(0, 4));
  const thanksgiving = new Date(`${nth(y, 11, 4, 4)}T12:00:00Z`); thanksgiving.setUTCDate(thanksgiving.getUTCDate() + 1);
  return [dateString(thanksgiving), `${y}-07-03`, `${y}-12-24`].includes(date) && isTradingDay(date) ? 13 * 60 : 16 * 60;
}
export function regularSession(now = new Date()) {
  const t = nyTime(now);
  return isTradingDay(t.date) && t.minute >= 570 && t.minute < closeMinute(t.date) - 10;
}
export function openingWindow(now = new Date()) {
  const t = nyTime(now);
  return isTradingDay(t.date) && now.getUTCHours() === 13 && now.getUTCMinutes() === 0;
}
export function initialOrderSession(now = new Date()) {
  return isTradingDay(nyTime(now).date) && now.getUTCHours() === 13 && now.getUTCMinutes() < 5;
}
export function manualOrderSession(now = new Date()) {
  const time = nyTime(now);
  return isTradingDay(time.date) && now >= new Date(`${time.date}T13:00:00Z`) && time.minute < closeMinute(time.date) - 10;
}
export function repriceWindow(now = new Date(), watchdog = false) {
  return regularSession(now) && now.getUTCHours() === 18 && now.getUTCMinutes() === (watchdog ? 5 : 0);
}
export function activationDate(now = new Date()) {
  const t = nyTime(now); const d = new Date(`${t.date}T12:00:00Z`);
  if (now >= new Date(`${t.date}T13:00:00Z`) || !isTradingDay(t.date)) d.setUTCDate(d.getUTCDate() + 1);
  while (!isTradingDay(dateString(d))) d.setUTCDate(d.getUTCDate() + 1);
  return dateString(d);
}
export function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return dateString(d);
}
