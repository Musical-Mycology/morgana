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
