export function floorShares(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function roundPrice(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function roundMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

export function roundT(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000000000) / 10000000000;
}
