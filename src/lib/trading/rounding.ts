export function floorShares(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function roundTo(value: number, digits: number) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function roundPrice(value: number) {
  return roundTo(value, 2);
}

export function roundMoney(value: number) {
  return roundTo(value, 4);
}

export function roundRate(value: number) {
  return roundTo(value, 8);
}

export function roundT(value: number) {
  return roundTo(value, 10);
}
