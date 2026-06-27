export function money(value: number | string | null | undefined, digits = 2) {
  const number = typeof value === 'string' ? Number(value) : value ?? 0;
  return number.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function compact(value: number | string | null | undefined, digits = 4) {
  const number = typeof value === 'string' ? Number(value) : value ?? 0;
  return number.toLocaleString('en-US', { maximumFractionDigits: digits });
}
