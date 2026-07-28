/** Pure helpers for the cinematic running-total counter (the counter_* actions). */

/** Format a counter value for display: rounded, thousands-separated, with an optional prefix.
 *  e.g. formatCounterValue(49000, "$") === "$49,000" */
export function formatCounterValue(value: number, prefix = ""): string {
  return `${prefix}${Math.round(value).toLocaleString("en-US")}`;
}

/** Resolve the value a counter tween should animate TO:
 *  counter_to → its absolute value; counter_add → current + delta. */
export function counterTarget(
  current: number,
  action: { kind: "counter_to"; value: number } | { kind: "counter_add"; delta: number },
): number {
  return action.kind === "counter_to" ? action.value : current + action.delta;
}

/** GSAP "power2.out" (cubic out) — the ease tweenCounter uses. */
const powerOut2 = (p: number): number => 1 - Math.pow(1 - p, 3);

/** A counter's displayed value at local progress `p` (0–1). Pure: this is what makes
 *  a counter scrubbable rather than wall-clock-animated (design spec §7b §5). */
export function counterValueAt(from: number, to: number, p: number): number {
  const c = p < 0 ? 0 : p > 1 ? 1 : p;
  return from + (to - from) * powerOut2(c);
}
