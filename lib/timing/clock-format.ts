/** m:ss clock text for the timed Player and editor ruler. Pure. */
export function formatClock(sec: number, opts: { tenths?: boolean } = {}): string {
  const s = Math.max(0, sec);
  if (opts.tenths === false) {
    const whole = Math.floor(s);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  }
  const tenths = Math.round(s * 10);
  const m = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
}

/** "m:ss[.f]" or plain seconds → seconds > 0; anything else (incl. 0, unless `allowZero`) → null. */
export function parseClock(text: string, opts: { allowZero?: boolean } = {}): number | null {
  const t = text.trim();
  const m = /^(?:(\d+):([0-5]\d(?:\.\d+)?)|(\d+(?:\.\d+)?))$/.exec(t);
  if (!m) return null;
  const v = m[3] !== undefined ? Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(v) && (v > 0 || (opts.allowZero && v === 0)) ? v : null;
}
