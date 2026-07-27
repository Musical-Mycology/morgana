import { expect, test } from "vitest";
import {
  clamp01, hash32, mulberry32, backOut2, powerOut1, powerIn1,
  EMIT_SPEED_N, NOTE_SIZE_N, STAGE_ASPECT,
} from "@/engine/components/effects/note-state";
import { emitterSpritesAt, emitterDecaySeconds, MAX_SPRITES_PER_SOURCE } from "@/engine/components/effects/note-state";
import type { Action } from "@/engine/deck/types";

test("clamp01 pins to the unit interval", () => {
  expect(clamp01(-0.5)).toBe(0);
  expect(clamp01(0.25)).toBe(0.25);
  expect(clamp01(3)).toBe(1);
});

test("hash32 is a pure, well-distributed uint32", () => {
  expect(hash32(0, 0)).toBe(hash32(0, 0));          // pure
  expect(hash32(1, 2)).not.toBe(hash32(2, 1));      // order matters
  for (const [a, b] of [[0, 0], [1, 7], [255, 1024]]) {
    const h = hash32(a, b);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  }
});

test("mulberry32 is reproducible and stays in [0,1)", () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  expect(seqA).toEqual(seqB);
  for (const v of seqA) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  expect(new Set(seqA).size).toBe(3);               // not a constant generator
});

test("ease functions match GSAP's formulas at their endpoints and midpoint", () => {
  // back.out(2): overshoots above 1 in the middle, pinned at the ends
  expect(backOut2(0)).toBeCloseTo(0, 10);
  expect(backOut2(1)).toBeCloseTo(1, 10);
  expect(backOut2(0.5)).toBeCloseTo(1.125, 10);     // (−.5)²·(3(−.5)+2)+1
  // power1.out = 1 − (1−p)²
  expect(powerOut1(0)).toBeCloseTo(0, 10);
  expect(powerOut1(0.5)).toBeCloseTo(0.75, 10);
  expect(powerOut1(1)).toBeCloseTo(1, 10);
  // power1.in = p²
  expect(powerIn1(0)).toBeCloseTo(0, 10);
  expect(powerIn1(0.5)).toBeCloseTo(0.25, 10);
  expect(powerIn1(1)).toBeCloseTo(1, 10);
});

test("normalization constants derive from the 1920px reference stage", () => {
  expect(EMIT_SPEED_N).toBeCloseTo(130 / 1920, 10);
  expect(NOTE_SIZE_N).toBeCloseTo(42 / 1920, 10);
  expect(STAGE_ASPECT).toBeCloseTo(16 / 9, 10);
});

const EM = (over: Partial<Extract<Action, { kind: "note_emitter" }>> = {}) =>
  ({ kind: "note_emitter", color: "#ff0000", pos: { x: 0.5, y: 0.5 }, dir: 0, decay: 1000, freq: 2, ...over }) as
    Extract<Action, { kind: "note_emitter" }>;

test("decay is milliseconds, clamped to a 0.1s floor in seconds", () => {
  expect(emitterDecaySeconds(1000)).toBeCloseTo(1, 10);
  expect(emitterDecaySeconds(2500)).toBeCloseTo(2.5, 10);
  expect(emitterDecaySeconds(1)).toBeCloseTo(0.1, 10);      // the registry's old bad default
});

test("emitter live window opens at i/freq and closes at i/freq + D", () => {
  const a = EM({ freq: 2, decay: 1000 });   // note i born at i/2 s, lives 1 s
  // note 1 is born at t=0.5
  expect(emitterSpritesAt(a, 0, 0.49).length).toBe(1);      // only note 0
  expect(emitterSpritesAt(a, 0, 0.5).length).toBe(2);       // note 1 has arrived
  // note 0 dies at exactly t=1.0 (window is half-open: [birth, birth+D))
  const at1 = emitterSpritesAt(a, 0, 1.0);
  expect(at1.some((s) => s.key === "0:0")).toBe(false);
});

test("emitter steady-state count matches the live-window formula", () => {
  const a = EM({ freq: 4, decay: 2000 });   // D = 2s, freq = 4/s
  const at = (t: number) => emitterSpritesAt(a, 0, t).length;
  // live iff 0 ≤ t − i/freq < D  →  i ∈ ((t−D)·freq, t·freq], a half-open interval
  const expected = (t: number) => Math.floor(t * 4) - Math.floor((t - 2) * 4);
  for (const t of [3, 5.1, 7.35, 10]) expect(at(t)).toBe(expected(t));
  // ceil(D·freq) + 1 is the pool BOUND, not the steady-state count — never exceeded
  for (const t of [3, 5.1, 7.35, 10]) expect(at(t)).toBeLessThanOrEqual(Math.ceil(2 * 4) + 1);
});

test("emitter renders nothing for degenerate or pre-start input", () => {
  expect(emitterSpritesAt(EM({ freq: 0 }), 0, 5)).toEqual([]);
  expect(emitterSpritesAt(EM({ freq: -1 }), 0, 5)).toEqual([]);
  expect(emitterSpritesAt(EM({ decay: 0 }), 0, 5)).toEqual([]);
  expect(emitterSpritesAt(EM(), 0, -0.1)).toEqual([]);
});

test("emitter sprite appearance matches the ported GSAP eases", () => {
  const a = EM({ freq: 1, decay: 1000, var: 0 });   // D=1, tIn = min(0.4, 0.4) = 0.4
  // sample at t=0.2 → note 0 has age 0.2, halfway through the 0.4s bounce-in
  const s = emitterSpritesAt(a, 0, 0.2)[0];
  expect(s.scale).toBeCloseTo(0.4 + 0.6 * 1.125, 6);   // backOut2(0.5) = 1.125
  expect(s.opacity).toBeCloseTo(1, 6);                 // backOut2(0.5) clamped to 1
  expect(s.hex).toBe("#ff0000");
  // at age 0.8 the fade-out (starting at 0.6·D) is half done → 1 − 0.5² = 0.75
  const late = emitterSpritesAt(a, 0, 0.8)[0];
  expect(late.opacity).toBeCloseTo(0.75, 6);
});

test("emitter travel preserves the compass angle across per-axis normalization", () => {
  // dir 45° with zero spread: dx = sin45·d, dy = −cos45·d·(16/9) → |dy/dx| = 16/9
  const a = EM({ dir: 45, var: 0, freq: 1, decay: 1000 });
  const s = emitterSpritesAt(a, 0, 0.5)[0];
  const dx = s.x - 0.5, dy = s.y - 0.5;
  expect(dx).toBeGreaterThan(0);
  expect(dy).toBeLessThan(0);                       // compass 45° travels up-and-right
  expect(Math.abs(dy / dx)).toBeCloseTo(16 / 9, 6);
});

test("emitter jitter is seeded — identical inputs give identical output", () => {
  const a = EM({ var: 90 });
  expect(emitterSpritesAt(a, 0, 3)).toEqual(emitterSpritesAt(a, 0, 3));
});

test("two emitters in one beat get distinct jitter", () => {
  const a = EM({ var: 90 });
  const one = emitterSpritesAt(a, 0, 3).map((s) => s.x);
  const two = emitterSpritesAt(a, 1, 3).map((s) => s.x);   // different srcIdx
  expect(one).not.toEqual(two);
});

test("emitter clamps to MAX_SPRITES_PER_SOURCE, keeping the newest notes", () => {
  const a = EM({ freq: 1000, decay: 10000 });   // natural window would be ~10001
  const out = emitterSpritesAt(a, 0, 20);
  expect(out.length).toBe(MAX_SPRITES_PER_SOURCE);
  // keys are unique among live sprites (pool slots do not collide)
  expect(new Set(out.map((s) => s.key)).size).toBe(out.length);
});

import { circleSpritesAt } from "@/engine/components/effects/note-state";

const RING = (over: Partial<Extract<Action, { kind: "note_circle" }>> = {}) =>
  ({ kind: "note_circle", pos: { x: 0.5, y: 0.5 }, width: 0.4, height: 0.2,
     hex: ["#111111", "#222222"], bounce: 0, notes: 4, speed: 4000, ...over }) as
    Extract<Action, { kind: "note_circle" }>;

test("ring emits `notes` sprites, evenly phased, cycling the palette", () => {
  const out = circleSpritesAt(RING(), 0, 0);
  expect(out.length).toBe(4);
  expect(out.map((s) => s.hex)).toEqual(["#111111", "#222222", "#111111", "#222222"]);
  expect(new Set(out.map((s) => s.key)).size).toBe(4);
  for (const s of out) { expect(s.opacity).toBe(1); expect(s.scale).toBe(1); }
});

test("ring with bounce=0 traces an exact ellipse", () => {
  const a = RING({ notes: 1, bounce: 0, speed: 4000 });   // rx = 0.2, ry = 0.1, 4s per orbit
  // phase 0 at t=0 → angle 0 → (cx + rx, cy)
  const t0 = circleSpritesAt(a, 0, 0)[0];
  expect(t0.x).toBeCloseTo(0.7, 10);
  expect(t0.y).toBeCloseTo(0.5, 10);
  // quarter orbit → angle π/2 → (cx, cy + ry)
  const t1 = circleSpritesAt(a, 0, 1)[0];
  expect(t1.x).toBeCloseTo(0.5, 10);
  expect(t1.y).toBeCloseTo(0.6, 10);
  // half orbit → angle π → (cx − rx, cy)
  const t2 = circleSpritesAt(a, 0, 2)[0];
  expect(t2.x).toBeCloseTo(0.3, 10);
  expect(t2.y).toBeCloseTo(0.5, 10);
  // full orbit returns to start
  const t4 = circleSpritesAt(a, 0, 4)[0];
  expect(t4.x).toBeCloseTo(t0.x, 10);
  expect(t4.y).toBeCloseTo(t0.y, 10);
});

test("bounce superimposes an always-upward hop of bounce·ry·0.5·|sin(3a)|", () => {
  const a = RING({ notes: 1, bounce: 1, speed: 4000 });   // ry = 0.1
  // at t=1 the angle is π/2; |sin(3·π/2)| = 1 → hop = 1·0.1·0.5·1 = 0.05, subtracted from y
  const s = circleSpritesAt(a, 0, 1)[0];
  expect(s.y).toBeCloseTo(0.6 - 0.05, 10);
});

test("ring falls back to white when the palette is empty", () => {
  expect(circleSpritesAt(RING({ hex: [], notes: 1 }), 0, 0)[0].hex).toBe("#FFFFFF");
});

test("ring applies its defaults and guards", () => {
  const noOpts = { kind: "note_circle", pos: { x: 0.5, y: 0.5 }, width: 0.2, height: 0.2, hex: ["#fff"] } as
    Extract<Action, { kind: "note_circle" }>;
  expect(circleSpritesAt(noOpts, 0, 0).length).toBe(8);       // notes defaults to 8
  expect(circleSpritesAt(RING(), 0, -1)).toEqual([]);         // before the source starts
  expect(circleSpritesAt(RING({ notes: 0 }), 0, 0).length).toBe(1);   // clamped to at least 1
  expect(circleSpritesAt(RING({ notes: 5000 }), 0, 0).length).toBe(MAX_SPRITES_PER_SOURCE);
});

test("ring is deterministic", () => {
  expect(circleSpritesAt(RING(), 0, 1.7)).toEqual(circleSpritesAt(RING(), 0, 1.7));
});
