/** A clip's own time as a pure function of deck time (spec §3). Pure. */
import type { ClipOpts } from "@/engine/deck/types";
export const HOLD_EPSILON = 0.001;
export function clipTimeAt(since: number, T: number, opts: ClipOpts | undefined, duration?: number): number {
  const known = typeof duration === "number" && Number.isFinite(duration) && duration > 0;
  const last = known ? Math.max(0, duration! - HOLD_EPSILON) : Infinity;
  const rawIn = Number.isFinite(opts?.in) ? Math.max(0, opts!.in!) : 0;
  const inPt = Math.min(rawIn, last);
  const t = inPt + Math.max(0, T - since);
  if (!known) return t;
  // test the UNCLAMPED in-point: after clamping, duration - inPt sits at HOLD_EPSILON and float fuzz decides
  if (opts?.loop && duration! - rawIn > HOLD_EPSILON) return inPt + ((t - inPt) % (duration! - inPt));
  return Math.min(t, last);
}
