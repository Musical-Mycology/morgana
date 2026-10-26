/** Credits roll geometry as pure functions (timed-video sub-project 6). Pure: no DOM — enforced by
 *  tests/unit/pure-import-graph.test.ts. Sizes are fractions of the 16:9 stage HEIGHT: the roll's
 *  DOM (engine/components/credits-block.ts) and lint's speed estimate both read them. */
import type { CreditItem, CreditsArea } from "@/engine/deck/types";
import type { TextScroll } from "@/engine/components/effects/note-state";

export const DEFAULT_CREDITS_AREA: CreditsArea = { x: 0.2, y: 0.32, w: 0.6, h: 0.63 };
export const CREDITS_ROLE_FS = 0.03;     // near name size (0.034) so titles read on a projector
export const CREDITS_ROLE_LH = 0.046;
export const CREDITS_NAME_FS = 0.034;
export const CREDITS_NAME_LH = 0.05;
export const CREDITS_GAP = 0.03;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** The roll's translateY `t` seconds after it started: linear from `areaH` (just below the area)
 *  to `−blockH` (just above it). Any consistent unit (px, or stage fractions). */
export function creditsOffset(t: number, durationMs: number, blockH: number, areaH: number): number {
  const dur = durationMs / 1000;
  const p = dur <= 0 ? 1 : clamp01(t / dur);
  return areaH + (-blockH - areaH) * p;
}

/** The same roll as a TextScroll starting at beat-local `t0` (for credit-line text sources). */
export function creditsScroll(t0: number, durationMs: number, blockH: number, areaH: number): TextScroll {
  return { t0, dur: durationMs / 1000, from: areaH, to: -blockH };
}

/** The beat-local window in which a credit line's top edge is inside the area, in closed form from
 *  the linear offset, clipped to the roll's own span. Null if the line never shows. */
export function creditLineWindow(lineTop: number, area: Pick<CreditsArea, "y" | "h">, s: TextScroll): { start: number; end: number } | null {
  if (!(s.dur > 0) || !(s.to < s.from)) return null;
  const k = (s.to - s.from) / s.dur;                               // < 0: the roll moves up
  const tIn = s.t0 + (area.y + area.h - lineTop - s.from) / k;      // top reaches the area's bottom
  const tOut = s.t0 + (area.y - lineTop - s.from) / k;              // top reaches the area's top
  const start = Math.max(tIn, s.t0);
  const end = Math.min(tOut, s.t0 + s.dur);
  return end > start ? { start, end } : null;
}

/** Block height estimate (stage-height fraction) from line counts × line heights — no DOM (lint). */
export function estimateCreditsBlockH(items: CreditItem[]): number {
  return items.reduce((h, it, k) => h + (k > 0 ? CREDITS_GAP : 0) + (it.role ? CREDITS_ROLE_LH : 0) + it.names.length * CREDITS_NAME_LH, 0);
}
