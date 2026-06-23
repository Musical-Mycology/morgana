export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, index));
}

/** Parse a 1-based `?slide` value into a clamped 0-based index. */
export function parseSlideParam(raw: string | null, count: number): number {
  const n = raw == null ? NaN : parseInt(raw, 10);
  if (!Number.isFinite(n)) return 0;
  return clampIndex(n - 1, count);
}

/** Format a 0-based index as a 1-based `?slide` string. */
export function slideParam(index: number): string {
  return String(index + 1);
}
