/** "draw" text timing as pure functions (timed-video sub-project 6). Pure: no DOM, GSAP or React —
 *  enforced by tests/unit/pure-import-graph.test.ts. beat-clock's introDuration and cinematic-anim's
 *  drawIn both read these, so the beat axis and the painted strokes cannot drift apart. */

/** Which outline phase ships, decided by the Task 1 probe (e2e/svg-draw-probe.spec.ts): "dash" =
 *  per-glyph stroke-dashoffset; "mask" = a soft mask-image sweep over fully stroked glyphs. */
export const DRAW_VARIANT: "dash" | "mask" = "dash";
export const DRAW_LEAD = 0.1;
export const DRAW_STAGGER = 0.08;
export const DRAW_FILL = 0.4;
/** The dash length L, in em: an upper bound on one glyph's outline (the probe checks it). */
export const DRAW_DASH_EM = 12;
/** stroke-width, in em (1.5% of the font size). */
export const DRAW_STROKE_EM = 0.015;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export function drawDuration(chars: number, speed = 1): number {
  return (DRAW_LEAD + chars * DRAW_STAGGER + DRAW_FILL) / speed;
}

/** One glyph's state: `dash` is the dash offset as a fraction of L (1 = nothing drawn, 0 = whole
 *  outline); `fill` / `stroke` are fill-opacity / stroke-opacity. */
export interface DrawGlyphState { dash: number; fill: number; stroke: number }

export function drawGlyphAt(i: number, chars: number, t: number, speed = 1): DrawGlyphState {
  const s = t * speed;
  const p = clamp01((s - i * DRAW_STAGGER) / (DRAW_LEAD + DRAW_STAGGER));
  const f = clamp01((s - (DRAW_LEAD + chars * DRAW_STAGGER)) / DRAW_FILL);
  return { dash: 1 - p, fill: f, stroke: 1 - f };
}

/** The "mask" variant's sweep position, 0 → 1 over the outline phase. */
export function drawSweepAt(chars: number, t: number, speed = 1): number {
  return clamp01((t * speed) / (DRAW_LEAD + chars * DRAW_STAGGER));
}

/** A draw line is one row: newlines become spaces (same length, so `chars` stays value.length). */
export function drawText(value: string): string {
  return value.replace(/\n/g, " ");
}

/** [start, end) UTF-16 indices of each run of non-space characters. */
export function wordRuns(s: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /\S+/g;
  for (let m = re.exec(s); m; m = re.exec(s)) out.push([m.index, m.index + m[0].length]);
  return out;
}
