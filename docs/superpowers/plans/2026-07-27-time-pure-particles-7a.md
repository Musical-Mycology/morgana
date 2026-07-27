# Time-Pure Note Particles (§7a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Morgana's note particles (`note_emitter`, `note_circle`, `stop_notes`, `stop_circle`) deterministic functions of time, render them in the editor canvas for the first time, and complete their inspector descriptors.

**Architecture:** A pure reducer `noteFieldStateAt(scene, beatIndex, tLocal)` returns the list of live note sprites at a time — no GSAP, no `Math.random()`, no wall-clock. `NoteField` becomes a dumb renderer that pools DOM nodes and writes closed-form styles. Both render paths (`DeckCanvas`'s rAF loop, `BeatStage`'s proxy tween) mount the same component and supply only a clock. This is the same shape sub-project 3b used for objects (`objectStateAt` / `ObjectStage`).

**Tech Stack:** TypeScript, React 19, Next.js 15, Vitest (jsdom), Playwright, `@testing-library/react`. GSAP is *removed* from the note path.

**Spec:** [`docs/superpowers/specs/2026-07-27-time-pure-particles-7a-design.md`](../specs/2026-07-27-time-pure-particles-7a-design.md)

## Global Constraints

- **`DeckDoc.version` stays `1`.** Render + descriptor only. No persisted field is added, removed, or reinterpreted.
- **No infrastructure coupling.** Morgana is standalone OSS — no MM-specific host, CI, or auth may be introduced.
- **Empty scenes are legal and must stay reachable.** Any scene→beat index mapping must tolerate a zero-beat scene without throwing.
- **The e2e build must NOT move into a Playwright `globalSetup`.** Run the suite as `npm run test:e2e` only.
- **Never add `--workers=1`** to the Playwright invocation. Default parallelism.
- Commands: `npm test` (Vitest), `CI=1 npm run test:e2e` (Playwright), `npx tsc --noEmit`.
- Unit tests live in `tests/unit/*.test.ts` / `*.test.tsx`; the `@` alias maps to the repo root.
- **Out of scope (do not implement):** the `seek(t)` transport surface over the GSAP master (§7b), the canvas swap / parity gate / `seek.ts` deletion (§7c), on-stage drag handles (§4), and a `stringList` `FieldType`.

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `engine/components/effects/note-state.ts` | **Create** | The pure reducer: PRNG, ease functions, emitter/ring sprite math, cross-beat fold, caps. No DOM. |
| `engine/components/NoteField.tsx` | **Rewrite** | Pooled DOM renderer. `renderAt(scene, beatIndex, t)` + `applyNoteState`. 16:9 sprite host. |
| `engine/components/effects/notes.ts` | **Modify** | Keep `makeNoteHex` + `randomGlyph`; delete `makeNote`, `emitNote`, `launchNote`. |
| `components/editor/DeckCanvas.tsx` | **Modify** | Mount `NoteField`; sample it from the existing `draw()`. |
| `engine/authoring/BeatStage.tsx` | **Modify** | Drop `notes` from the runtime call (Task 5); drive `NoteField` from the existing proxy tween (Task 8). |
| `engine/components/layouts/CinematicSlide.tsx` | **Modify** | Delete 5 `CinematicRuntime` members + 5 `scheduleAction` cases. |
| `engine/authoring/runtime.ts` | **Modify** | Delete the matching hooks/members. |
| `engine/authoring/seek.ts` | **Modify** | `isSeekable` → `a.kind !== "cue"`. |
| `lib/editor/registry.ts` | **Modify** | Complete four note descriptors; fix `GENERIC.seekable`. |
| `samples/notes.deck.json` | **Create** | Fixture deck; seeds itself into all three e2e data dirs. |
| `app/dev/notefield/page.tsx` | **Create** | Dev route for the BeatStage e2e. |
| `tests/unit/note-state.test.ts` | **Create** | Reducer unit suite (the determinism gate). |
| `tests/unit/note-field.test.tsx` | **Create** | Component tests for the DOM writer + pooling. |
| `tests/unit/authoring-runtime.test.ts` | **Create** | The runtime no longer carries note-source hooks. |
| `tests/unit/note-parity.test.tsx` | **Create** | Both entry points agree at sampled times. |
| `tests/unit/deck-canvas-notes.test.tsx` | **Create** | Canvas paints notes; scrub is deterministic. |
| `e2e/notes.spec.ts` | **Create** | Editor scrub determinism + dev-route paint. |

---

## Task 1: Pure helpers — PRNG and ease functions

**Files:**
- Create: `engine/components/effects/note-state.ts`
- Test: `tests/unit/note-state.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `clamp01(n: number): number`, `hash32(a: number, b: number): number`, `mulberry32(seed: number): () => number`, `backOut2(p: number): number`, `powerOut1(p: number): number`, `powerIn1(p: number): number`, and the constants `REF_W`, `EMIT_SPEED_N`, `NOTE_SIZE_N`, `STAGE_ASPECT`, `MAX_SPRITES_PER_SOURCE`, `MAX_SPRITES_TOTAL` (all `number`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/note-state.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  clamp01, hash32, mulberry32, backOut2, powerOut1, powerIn1,
  EMIT_SPEED_N, NOTE_SIZE_N, STAGE_ASPECT,
} from "@/engine/components/effects/note-state";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/note-state.test.ts`
Expected: FAIL — `Failed to resolve import "@/engine/components/effects/note-state"`.

- [ ] **Step 3: Write minimal implementation**

Create `engine/components/effects/note-state.ts`:

```ts
/** Pure, time-indexed note-particle state. No GSAP, no Math.random(), no wall-clock:
 *  every value here is a function of (scene, beatIndex, tLocal) alone, so scrubbing to
 *  the same time always paints the same frame. See docs/superpowers/specs/
 *  2026-07-27-time-pure-particles-7a-design.md §3. */

/** Reference stage width the engine's px constants were authored against. */
export const REF_W = 1920;
/** launchNote's EMIT_SPEED (130 px/s), as stage-widths per second. */
export const EMIT_SPEED_N = 130 / REF_W;
/** The 42px note sprite, as a fraction of stage width. */
export const NOTE_SIZE_N = 42 / REF_W;
/** The stage is a fixed 16:9 box, so a stage-width distance converts to a
 *  stage-height distance by this factor — which is what preserves travel angles
 *  under separate per-axis normalization. */
export const STAGE_ASPECT = 16 / 9;

export const MAX_SPRITES_PER_SOURCE = 256;
export const MAX_SPRITES_TOTAL = 512;

export const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Deterministic 32-bit mix of two integers → the seed for one sprite's jitter. */
export function hash32(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Small, fast, seedable PRNG. Replaces the two Math.random() calls in launchNote. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** GSAP "back.out(2)": (p−1)²·((s+1)(p−1) + s) + 1 with s = 2. Overshoots above 1. */
export function backOut2(p: number): number {
  const q = p - 1;
  return q * q * (3 * q + 2) + 1;
}

/** GSAP "power1.out" (quad out). */
export const powerOut1 = (p: number): number => 1 - (1 - p) * (1 - p);
/** GSAP "power1.in" (quad in). */
export const powerIn1 = (p: number): number => p * p;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/note-state.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add engine/components/effects/note-state.ts tests/unit/note-state.test.ts
git commit -m "feat(notes): seeded PRNG and closed-form ease helpers"
```

---

## Task 2: Emitter sprite math

**Files:**
- Modify: `engine/components/effects/note-state.ts`
- Test: `tests/unit/note-state.test.ts`

**Interfaces:**
- Consumes: Task 1's `clamp01`, `hash32`, `mulberry32`, `backOut2`, `powerOut1`, `powerIn1`, `EMIT_SPEED_N`, `STAGE_ASPECT`, `MAX_SPRITES_PER_SOURCE`.
- Produces:
  - `interface NoteSpriteState { key: string; x: number; y: number; scale: number; opacity: number; hex: string; glyph: NoteGlyph }`
  - `emitterSpritesAt(a: Extract<Action, { kind: "note_emitter" }>, srcIdx: number, elapsed: number): NoteSpriteState[]`
  - `emitterDecaySeconds(decayMs: number): number`

**Domain note for the implementer:** `note_emitter.decay` is in **milliseconds** (`engine/deck/types.ts`: "decay = note lifetime ms"), and the engine clamps it — `launchNote` uses `Math.max(0.1, decayMs / 1000)`. Every formula below uses `D`, the clamped value in **seconds**. The emitter is a GSAP timeline with a zero-duration body and `repeatDelay: 1/freq`, so note *i* is born at `i/freq` after the source starts and lives exactly `D` seconds.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/note-state.test.ts`:

```ts
import { emitterSpritesAt, emitterDecaySeconds, MAX_SPRITES_PER_SOURCE } from "@/engine/components/effects/note-state";
import type { Action } from "@/engine/deck/types";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/note-state.test.ts`
Expected: FAIL — `emitterSpritesAt is not exported` / import error.

- [ ] **Step 3: Write minimal implementation**

Add to the top of `engine/components/effects/note-state.ts`:

```ts
import type { Action } from "@/engine/deck/types";
import type { NoteGlyph } from "@/engine/deck/story-assets";
import { randomGlyph } from "./notes";
```

Add to the bottom:

```ts
/** One live note sprite at an absolute time. x/y are normalized 0–1 stage coordinates.
 *  `key` is a stable pool slot — the renderer reuses the DOM node with the same key. */
export interface NoteSpriteState {
  key: string;
  x: number; y: number;
  scale: number;
  opacity: number;
  hex: string;
  glyph: NoteGlyph;
}

/** `decay` is authored in MILLISECONDS; launchNote clamped it to a 0.1s floor. */
export const emitterDecaySeconds = (decayMs: number): number => Math.max(0.1, decayMs / 1000);

/** Live sprites of one note_emitter, `elapsed` seconds after the source started.
 *  Ports launchNote's three tweens as closed-form functions of each note's age. */
export function emitterSpritesAt(
  a: Extract<Action, { kind: "note_emitter" }>,
  srcIdx: number,
  elapsed: number,
): NoteSpriteState[] {
  const freq = a.freq;
  if (!(freq > 0) || !(a.decay > 0) || elapsed < 0) return [];
  const D = emitterDecaySeconds(a.decay);
  const P = Math.min(Math.ceil(D * freq) + 1, MAX_SPRITES_PER_SOURCE);
  // live iff 0 ≤ elapsed − i/freq < D
  const iMax = Math.floor(elapsed * freq);
  const iMin = Math.max(0, Math.floor((elapsed - D) * freq) + 1, iMax - P + 1); // keep the newest P
  const tIn = Math.min(0.4, D * 0.4);
  const fadeStart = 0.6 * D;
  const fadeSpan = 0.4 * D;

  const out: NoteSpriteState[] = [];
  for (let i = iMin; i <= iMax; i++) {
    const age = elapsed - i / freq;
    const rnd = mulberry32(hash32(srcIdx, i));
    const spread = (rnd() * 2 - 1) * (a.var ?? 0);
    const mult = 0.8 + rnd() * 0.4;
    const theta = ((a.dir + spread) * Math.PI) / 180;   // compass: 0 = up, clockwise
    const dist = EMIT_SPEED_N * D * mult;
    const dx = Math.sin(theta) * dist;
    const dy = -Math.cos(theta) * dist * STAGE_ASPECT;

    const bounce = backOut2(clamp01(age / tIn));
    let opacity = clamp01(bounce);
    if (age >= fadeStart) opacity *= 1 - powerIn1(clamp01((age - fadeStart) / fadeSpan));
    const travel = powerOut1(clamp01(age / D));

    out.push({
      key: `${srcIdx}:${i % P}`,
      x: a.pos.x + dx * travel,
      y: a.pos.y + dy * travel,
      scale: 0.4 + 0.6 * bounce,
      opacity,
      hex: a.color,
      glyph: randomGlyph(i),
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/note-state.test.ts`
Expected: PASS — 14 tests.

**If the steady-state test fails**, re-derive rather than loosening the assertion: `ceil(D·freq)+1`
is the *pool bound* (the most notes that can ever be live), while the count at a given `t` is the
number of integers in the half-open interval `((t−D)·freq, t·freq]`. Both are asserted separately
and on purpose.

- [ ] **Step 5: Commit**

```bash
git add engine/components/effects/note-state.ts tests/unit/note-state.test.ts
git commit -m "feat(notes): closed-form emitter sprite state at time t"
```

---

## Task 3: Ring sprite math

**Files:**
- Modify: `engine/components/effects/note-state.ts`
- Test: `tests/unit/note-state.test.ts`

**Interfaces:**
- Consumes: Task 2's `NoteSpriteState`, `MAX_SPRITES_PER_SOURCE`.
- Produces: `circleSpritesAt(a: Extract<Action, { kind: "note_circle" }>, srcIdx: number, elapsed: number): NoteSpriteState[]`

**Domain note:** `note_circle` is *already* closed-form in the current engine — the GSAP tween only advances an angle. This task is transcription plus normalization. Unlike the emitter, `width`/`height` are already per-axis stage fractions, so **no aspect correction is applied**: `rx = width/2`, `ry = height/2` go straight into normalized space. Ring notes never expire.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/note-state.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/note-state.test.ts`
Expected: FAIL — `circleSpritesAt is not exported`.

- [ ] **Step 3: Write minimal implementation**

Append to `engine/components/effects/note-state.ts`:

```ts
/** Live sprites of one note_circle, `elapsed` seconds after the source started.
 *  Already closed-form in the engine — this is the same ellipse math with the GSAP
 *  angle tween replaced by `2π·elapsed/dur`, in normalized stage space. */
export function circleSpritesAt(
  a: Extract<Action, { kind: "note_circle" }>,
  srcIdx: number,
  elapsed: number,
): NoteSpriteState[] {
  if (elapsed < 0) return [];
  const N = Math.max(1, Math.round(a.notes ?? 8));
  const count = Math.min(N, MAX_SPRITES_PER_SOURCE);
  const dur = Math.max(0.1, (a.speed ?? 6000) / 1000);   // speed is ms per orbit
  const colors = a.hex.length ? a.hex : ["#FFFFFF"];
  const rx = a.width / 2;
  const ry = a.height / 2;
  const bounce = a.bounce ?? 0;

  const out: NoteSpriteState[] = [];
  for (let k = 0; k < count; k++) {
    const ang = (k / N) * Math.PI * 2 + (elapsed / dur) * Math.PI * 2;
    const hop = bounce * ry * 0.5 * Math.abs(Math.sin(ang * 3));   // |sin| → always upward
    out.push({
      key: `${srcIdx}:${k}`,
      x: a.pos.x + Math.cos(ang) * rx,
      y: a.pos.y + Math.sin(ang) * ry - hop,
      scale: 1,
      opacity: 1,
      hex: colors[k % colors.length],
      glyph: randomGlyph(k),
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/note-state.test.ts`
Expected: PASS — 20 tests.

- [ ] **Step 5: Commit**

```bash
git add engine/components/effects/note-state.ts tests/unit/note-state.test.ts
git commit -m "feat(notes): closed-form note ring sprite state at time t"
```

---

## Task 4: The reducer — source resolution, cross-beat fold, caps

**Files:**
- Modify: `engine/components/effects/note-state.ts`
- Test: `tests/unit/note-state.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3's `emitterSpritesAt`, `circleSpritesAt`, `NoteSpriteState`, `MAX_SPRITES_TOTAL`; `beatTimeline` and `beatDuration` from `@/engine/authoring/seek`.
- Produces: `noteFieldStateAt(scene: Scene, beatIndex: number, tLocal: number): NoteSpriteState[]`

**Domain notes for the implementer:**

1. **Why a fold.** `NoteField` is mounted *outside* `CinematicSlide` and is not torn down per beat, so in real playback an emitter started in beat 0 keeps emitting through beat 2 until a `stop_notes`. The reducer reproduces that by replaying prior beats to derive the live source set, then continuing each carried source's phase. This mirrors `objectStateAt` in `lib/editor/object-state.ts` — read it first if the fold is unfamiliar.
2. **`srcIdx` must be globally unique across the fold**, not per-beat: it is both the pool-key prefix and the jitter seed, and two sources from different beats can be live simultaneously. Use a running counter over the fixed traversal order.
3. **Zero-beat scenes are legal** (see `docs/MM_MORGANA.md`) — return `[]`, never throw.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/note-state.test.ts`:

```ts
import { noteFieldStateAt, MAX_SPRITES_TOTAL } from "@/engine/components/effects/note-state";
import type { Scene } from "@/engine/deck/types";

const emitter: Action = { kind: "note_emitter", color: "#abcdef", pos: { x: 0.5, y: 0.5 }, dir: 0, decay: 1000, freq: 2 };
const ring: Action = { kind: "note_circle", pos: { x: 0.5, y: 0.5 }, width: 0.2, height: 0.2, hex: ["#fff"], notes: 3, speed: 4000 };

const scene = (beats: Action[][]): Scene =>
  ({ id: "s", beats: beats.map((timeline, i) => ({ id: `b${i}`, timeline })) });

test("a source started in the current beat is live only after its window opens", () => {
  const s = scene([[{ kind: "wait", ms: 1000 }, emitter]]);   // emitter starts at t=1
  expect(noteFieldStateAt(s, 0, 0.5)).toEqual([]);
  expect(noteFieldStateAt(s, 0, 1.0).length).toBeGreaterThan(0);
});

test("a source started in a prior beat is still live, phase-continued", () => {
  const s = scene([[emitter, { kind: "wait", ms: 1000 }], [{ kind: "wait", ms: 1000 }], [{ kind: "wait", ms: 1000 }]]);
  // beat 0 contributes 1s after the emitter starts; beat 1 contributes 1s; then tLocal.
  const atBeat2 = noteFieldStateAt(s, 2, 0.5);
  expect(atBeat2.length).toBeGreaterThan(0);
  // elapsed = 1 + 1 + 0.5 = 2.5 → identical to sampling the same emitter directly
  expect(atBeat2).toEqual(emitterSpritesAt(emitter as never, 0, 2.5));
});

test("stop_notes in a prior beat removes every carried source", () => {
  const s = scene([[emitter, ring, { kind: "wait", ms: 1000 }], [{ kind: "stop_notes" }], [{ kind: "wait", ms: 500 }]]);
  expect(noteFieldStateAt(s, 2, 0.2)).toEqual([]);
});

test("stop_circle removes rings only and leaves emitters running", () => {
  const s = scene([[emitter, ring, { kind: "wait", ms: 1000 }], [{ kind: "stop_circle" }, { kind: "wait", ms: 500 }]]);
  const out = noteFieldStateAt(s, 1, 0.4);
  expect(out.length).toBeGreaterThan(0);
  expect(out.every((sp) => sp.hex === "#abcdef")).toBe(true);   // emitter colour only, no ring
});

test("a stop within the current beat only takes effect once its window is reached", () => {
  const s = scene([[emitter, { kind: "wait", ms: 1000 }, { kind: "stop_notes" }, { kind: "wait", ms: 1000 }]]);
  expect(noteFieldStateAt(s, 0, 0.5).length).toBeGreaterThan(0);   // before the stop
  expect(noteFieldStateAt(s, 0, 1.5)).toEqual([]);                 // after the stop
});

test("the reducer is pure — two identical calls deep-equal", () => {
  const s = scene([[emitter, ring, { kind: "wait", ms: 2000 }]]);
  expect(noteFieldStateAt(s, 0, 1.3)).toEqual(noteFieldStateAt(s, 0, 1.3));
});

test("sprite keys are unique across simultaneously live sources", () => {
  const s = scene([[emitter, ring, { kind: "wait", ms: 2000 }]]);
  const out = noteFieldStateAt(s, 0, 1.3);
  expect(new Set(out.map((sp) => sp.key)).size).toBe(out.length);
});

test("the total cap drops whole trailing sources", () => {
  const fat: Action = { ...emitter, freq: 1000, decay: 10000 } as Action;
  const s = scene([[fat, fat, fat, { kind: "wait", ms: 5000 }]]);
  const out = noteFieldStateAt(s, 0, 4);
  expect(out.length).toBeLessThanOrEqual(MAX_SPRITES_TOTAL);
  expect(out.length).toBeGreaterThan(0);
});

test("degenerate inputs return [] and never throw", () => {
  const s = scene([[emitter, { kind: "wait", ms: 1000 }]]);
  expect(noteFieldStateAt(s, -1, 0.5)).toEqual([]);
  expect(noteFieldStateAt(s, 9, 0.5)).toEqual([]);
  expect(noteFieldStateAt(scene([]), 0, 0.5)).toEqual([]);              // zero-beat scene (legal!)
  expect(noteFieldStateAt(scene([[]]), 0, 0.5)).toEqual([]);            // empty timeline
  expect(noteFieldStateAt({ id: "s" } as Scene, 0, 0.5)).toEqual([]);   // missing beats
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/note-state.test.ts`
Expected: FAIL — `noteFieldStateAt is not exported`.

- [ ] **Step 3: Write minimal implementation**

Add to the imports at the top of `engine/components/effects/note-state.ts`:

```ts
import type { Scene } from "@/engine/deck/types";
import { beatTimeline, beatDuration } from "@/engine/authoring/seek";
```

Append:

```ts
type NoteSource =
  | { kind: "emitter"; action: Extract<Action, { kind: "note_emitter" }>; srcIdx: number; startBeat: number; windowStart: number }
  | { kind: "ring"; action: Extract<Action, { kind: "note_circle" }>; srcIdx: number; startBeat: number; windowStart: number };

/** Walk one beat's timeline up to `limit` seconds, mutating the live source list.
 *  `limit = Infinity` replays the whole beat (used when folding prior beats). */
function foldBeat(
  sources: NoteSource[], timeline: Action[], beatIdx: number, limit: number, nextIdx: () => number,
): NoteSource[] {
  let live = sources;
  for (const { action, start } of beatTimeline(timeline)) {
    if (start > limit) break;
    if (action.kind === "note_emitter") {
      live.push({ kind: "emitter", action, srcIdx: nextIdx(), startBeat: beatIdx, windowStart: start });
    } else if (action.kind === "note_circle") {
      live.push({ kind: "ring", action, srcIdx: nextIdx(), startBeat: beatIdx, windowStart: start });
    } else if (action.kind === "stop_notes") {
      live.length = 0;
    } else if (action.kind === "stop_circle") {
      live = live.filter((s) => s.kind !== "ring");
    }
  }
  return live;
}

/** Every live note sprite at (beatIndex, tLocal seconds into that beat).
 *
 *  Prior beats are folded to their settled state to derive which sources survive
 *  (stop_notes / stop_circle remove them), then each carried source's phase is
 *  continued across the intervening beat durations. Mirrors objectStateAt's fold,
 *  so there is one cross-beat model in the codebase. */
export function noteFieldStateAt(scene: Scene, beatIndex: number, tLocal: number): NoteSpriteState[] {
  const beats = scene?.beats;
  if (!beats?.length) return [];                                   // zero-beat scenes are legal
  if (beatIndex < 0 || beatIndex >= beats.length) return [];

  let counter = 0;
  const nextIdx = () => counter++;
  let sources: NoteSource[] = [];
  for (let bi = 0; bi < beatIndex; bi++) {
    sources = foldBeat(sources, beats[bi].timeline, bi, Infinity, nextIdx);
  }
  sources = foldBeat(sources, beats[beatIndex].timeline, beatIndex, tLocal, nextIdx);

  const elapsedOf = (s: NoteSource): number => {
    if (s.startBeat === beatIndex) return tLocal - s.windowStart;
    let e = beatDuration(beats[s.startBeat].timeline) - s.windowStart;
    for (let j = s.startBeat + 1; j < beatIndex; j++) e += beatDuration(beats[j].timeline);
    return e + tLocal;
  };

  const out: NoteSpriteState[] = [];
  for (const s of sources) {
    const sprites = s.kind === "emitter"
      ? emitterSpritesAt(s.action, s.srcIdx, elapsedOf(s))
      : circleSpritesAt(s.action, s.srcIdx, elapsedOf(s));
    // Total cap drops whole trailing sources, so one runaway emitter cannot blank a
    // scene's rings mid-source.
    if (out.length + sprites.length > MAX_SPRITES_TOTAL) break;
    out.push(...sprites);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/note-state.test.ts && npx tsc --noEmit`
Expected: PASS — 29 tests; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add engine/components/effects/note-state.ts tests/unit/note-state.test.ts
git commit -m "feat(notes): noteFieldStateAt reducer with cross-beat fold"
```

---

## Task 5: Strip the dead note runtime plumbing

**Files:**
- Modify: `engine/components/layouts/CinematicSlide.tsx` (the `CinematicRuntime` interface ~lines 61-89, and `scheduleAction` ~lines 500-509)
- Modify: `engine/authoring/runtime.ts`
- Modify: `engine/authoring/BeatStage.tsx` (the `makeAuthoringRuntime` call only)
- Test: `tests/unit/authoring-runtime.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `CinematicRuntime` **without** `cue`, `emitter`, `noteCircle`, `stopNotes`, `stopCircles`; `AuthoringHooks` **without** `notes`.

**Why this comes before the `NoteField` rewrite:** the reducer built in Tasks 1-4 owns note sources now, so the runtime hooks that used to *start* them have no purpose — the same split 3b made for objects ("renders via a parallel stage, not by teaching the runtime a new case"). Removing the **callers** first means Task 6 can then delete `NoteField`'s methods with zero dangling references, so every commit on this branch typechecks.

`makeAuthoringRuntime` is the only implementation of `CinematicRuntime` in the repo — `Slide.tsx` merely passes one through as an optional prop — so this is a closed change.

The **`cue` action kind stays in `engine/deck/types.ts`** for deck-format compatibility. It simply becomes inert. Do not touch `types.ts` in this task.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/authoring-runtime.test.ts`:

```ts
import { expect, test } from "vitest";
import { createRef } from "react";
import { makeAuthoringRuntime } from "@/engine/authoring/runtime";
import type { ArtStageHandle } from "@/engine/components/ArtStage";

const runtime = () => makeAuthoringRuntime({
  art: createRef<ArtStageHandle>(),
  setNight: () => {},
  resolveEntry: () => [],
  resolveEnd: () => [],
  onGate: () => {},
  onWaiting: () => {},
});

test("the authoring runtime carries no note-source hooks", () => {
  const rt = runtime() as unknown as Record<string, unknown>;
  for (const k of ["cue", "emitter", "noteCircle", "stopNotes", "stopCircles"]) {
    expect(k in rt).toBe(false);
  }
});

test("the authoring runtime still carries the art / gate / nav surface", () => {
  const rt = runtime() as unknown as Record<string, unknown>;
  for (const k of ["art", "applyArt", "setNightlight", "onGate", "revealArrows", "pulseArrow", "onWaiting", "resolveEntry", "resolveEnd", "jumpTo"]) {
    expect(typeof rt[k]).toBe("function");
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/authoring-runtime.test.ts`
Expected: FAIL — the first test fails with `expected true to be false` (the hooks are still present). It may also fail to compile the `makeAuthoringRuntime({...})` literal, because `AuthoringHooks` still requires a `notes` field — either failure is the correct red.

- [ ] **Step 3a: Strip `CinematicSlide.tsx`**

Delete these five members, with their doc comments, from the `CinematicRuntime` interface:

```ts
  cue(c: EffectCue): void;
  emitter(opts: { color: string; x: number; y: number; dir: number; spread: number; decayMs: number; freq: number }): void;
  noteCircle(opts: { x: number; y: number; width: number; height: number; hex: string[]; bounce: number; notes: number; speed: number }): void;
  stopNotes(): void;
  stopCircles(): void;
```

Delete these five cases from `scheduleAction`:

```ts
      case "cue": master.add(() => runtime.cue(a.cue)); break;
      case "note_emitter": master.add(() => runtime.emitter({ /* … */ })); break;
      case "note_circle": master.add(() => runtime.noteCircle({ /* … */ })); break;
      case "stop_circle": master.add(() => runtime.stopCircles()); break;
      case "stop_notes": master.add(() => runtime.stopNotes()); break;
```

Replace the deleted cases with one comment, so the omission reads as intentional:

```ts
      // cue / note_emitter / note_circle / stop_circle / stop_notes are NOT scheduled here.
      // Note sources render from the pure noteFieldStateAt reducer via NoteField (see
      // engine/components/effects/note-state.ts), driven by whatever clock the host supplies —
      // the same split objects use. `cue` is inert; the kind survives in types.ts for
      // deck-format compatibility only.
```

`EffectCue` is now very likely an unused import — if `npx tsc --noEmit` or the linter flags it, remove it from the import list at the top of the file. Leave every other case untouched.

- [ ] **Step 3b: Rewrite `engine/authoring/runtime.ts`**

Replace the whole file with:

```ts
import type { RefObject } from "react";
import type { CinematicRuntime } from "@/engine/components/layouts/CinematicSlide";
import type { ArtStageHandle } from "@/engine/components/ArtStage";
import type { StoryAsset } from "@/engine/deck/story-assets";

export interface AuthoringHooks {
  art: RefObject<ArtStageHandle | null>;
  setNight: (n: number) => void;
  resolveEntry: () => StoryAsset[];
  resolveEnd: () => StoryAsset[];
  onGate: (resume: () => void) => void;
  onWaiting: (waiting: boolean) => void;
}

/** A CinematicRuntime with NO global input capture / fullscreen — for the editor.
 *  Note sources are deliberately NOT plumbed through here: they render from the pure
 *  noteFieldStateAt reducer via NoteField, driven by whatever clock the host supplies. */
export function makeAuthoringRuntime(h: AuthoringHooks): CinematicRuntime {
  return {
    art: (layers, mode, ms) => h.art.current?.show(layers, mode, ms),
    applyArt: (t, ms) => h.art.current?.apply(t, ms),
    setNightlight: (to) => h.setNight(to),
    onGate: (resume) => h.onGate(resume),
    revealArrows: () => {},
    pulseArrow: () => {},
    onWaiting: (w) => h.onWaiting(w),
    resolveEntry: () => h.resolveEntry(),
    resolveEnd: () => h.resolveEnd(),
    jumpTo: () => {},
  };
}
```

- [ ] **Step 3c: Update the `makeAuthoringRuntime` call in `BeatStage.tsx`**

Drop the `notes` property from the object literal — `AuthoringHooks` no longer declares it, so leaving it in is a TypeScript excess-property error:

```tsx
  const runtime = useMemo(
    () => makeAuthoringRuntime({
      art, setNight,
      resolveEntry: () => entryLayers,
      resolveEnd: () => endLayers,
      onGate: () => {}, onWaiting: () => {},
    }),
    [entryLayers, endLayers],
  );
```

**Keep** the `const notes = useRef<NoteFieldHandle>(null);` declaration and the `<NoteField ref={notes} reduced={false} />` element exactly as they are — Task 8 wires `notes` to the new imperative handle. Do not remove either.

- [ ] **Step 4: Run the full gate**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — the whole unit suite (including `beatstage-objects.test.tsx`, which renders `BeatStage`), and tsc clean. Note sources now render nowhere, which is the same as before this branch started; no test asserted otherwise.

- [ ] **Step 5: Commit**

```bash
git add engine/components/layouts/CinematicSlide.tsx engine/authoring/runtime.ts engine/authoring/BeatStage.tsx tests/unit/authoring-runtime.test.ts
git commit -m "refactor(notes): drop note-source hooks from the cinematic runtime

The noteFieldStateAt reducer owns note sources now, so CinematicRuntime's
cue/emitter/noteCircle/stopNotes/stopCircles hooks and their
scheduleAction cases have no purpose. The \`cue\` action kind stays in
types.ts for deck-format compatibility and is now inert."
```

---

## Task 6: Rewrite `NoteField` as a pooled renderer

**Files:**
- Rewrite: `engine/components/NoteField.tsx`
- Modify: `engine/components/effects/notes.ts`
- Test: `tests/unit/note-field.test.tsx` (create)

**Interfaces:**
- Consumes: Task 4's `noteFieldStateAt`, Task 2's `NoteSpriteState`, `NOTE_SIZE_N` from Task 1; `makeNoteHex` and `randomGlyph` from `./effects/notes`.
- Produces:
  - `interface NoteFieldHandle { renderAt(scene: Scene, beatIndex: number, t: number): void }`
  - `applyNoteState(node: HTMLElement, s: NoteSpriteState, resolveStory: (k: StoryAsset) => string): void`
  - `NoteField` — a `forwardRef<NoteFieldHandle, { reduced?: boolean }>` component rendering `data-testid="notefield"`.

**Why the deletions:** `emit`, `stopEmit`, and `swirl` have **no callers anywhere in the repo** — they are vendored leftovers that drove mm-website's story-panel effects, reachable only via `runtime.cue`, which Task 5 has now removed. `startEmitter`/`startCircle`/`stopNotes`/`stopCircles` likewise lost their last caller in Task 5. Keeping any of them would leave a component that is half closed-form reducer and half orphaned GSAP — the drift liability this whole sub-project exists to remove. `engine/` is vendored **from** mm-website, not to it, so nothing downstream breaks.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/note-field.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRef } from "react";
import { NoteField, type NoteFieldHandle } from "@/engine/components/NoteField";
import type { Scene, Action } from "@/engine/deck/types";

const emitter: Action = { kind: "note_emitter", color: "#ff0000", pos: { x: 0.5, y: 0.5 }, dir: 0, decay: 1000, freq: 4 };
const scene: Scene = { id: "s", beats: [{ id: "b0", timeline: [emitter, { kind: "wait", ms: 4000 }] }] };

const sprites = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-testid="notefield"] span'));
const visible = (c: HTMLElement) => sprites(c).filter((n) => n.style.display !== "none");

describe("NoteField", () => {
  it("paints sprites at the reducer state and writes normalized styles", () => {
    const ref = createRef<NoteFieldHandle>();
    const { container } = render(<NoteField ref={ref} />);
    ref.current!.renderAt(scene, 0, 1.0);
    const live = visible(container);
    expect(live.length).toBeGreaterThan(0);
    const first = live[0];
    expect(first.style.left).toMatch(/%$/);
    expect(first.style.top).toMatch(/%$/);
    expect(first.style.transform).toContain("scale(");
    expect(parseFloat(first.style.opacity)).toBeGreaterThan(0);
  });

  it("reuses pooled nodes — node count is stable across a t sweep", () => {
    const ref = createRef<NoteFieldHandle>();
    const { container } = render(<NoteField ref={ref} />);
    ref.current!.renderAt(scene, 0, 2.0);
    const after1 = sprites(container).length;
    for (const t of [2.1, 2.5, 3.0, 3.5]) ref.current!.renderAt(scene, 0, t);
    expect(sprites(container).length).toBe(after1);
  });

  it("is deterministic — the same t repaints the same DOM", () => {
    const ref = createRef<NoteFieldHandle>();
    const { container } = render(<NoteField ref={ref} />);
    ref.current!.renderAt(scene, 0, 1.7);
    const snap = visible(container).map((n) => `${n.style.left}|${n.style.top}|${n.style.opacity}`);
    ref.current!.renderAt(scene, 0, 3.3);           // scrub away…
    ref.current!.renderAt(scene, 0, 1.7);           // …and back
    expect(visible(container).map((n) => `${n.style.left}|${n.style.top}|${n.style.opacity}`)).toEqual(snap);
  });

  it("paints nothing under reduced motion", () => {
    const ref = createRef<NoteFieldHandle>();
    const { container } = render(<NoteField ref={ref} reduced />);
    ref.current!.renderAt(scene, 0, 1.0);
    expect(visible(container).length).toBe(0);
  });

  it("hides sprites again when the source stops", () => {
    const stopped: Scene = { id: "s", beats: [{ id: "b0", timeline: [
      emitter, { kind: "wait", ms: 1000 }, { kind: "stop_notes" }, { kind: "wait", ms: 1000 },
    ] }] };
    const ref = createRef<NoteFieldHandle>();
    const { container } = render(<NoteField ref={ref} />);
    ref.current!.renderAt(stopped, 0, 0.5);
    expect(visible(container).length).toBeGreaterThan(0);
    ref.current!.renderAt(stopped, 0, 1.5);
    expect(visible(container).length).toBe(0);
  });

  it("anchors sprites to a 16:9 stage box, not the full host", () => {
    const { container } = render(<NoteField />);
    const stage = container.querySelector<HTMLElement>(".notefield__stage");
    expect(stage).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/note-field.test.tsx`
Expected: FAIL — `renderAt is not a function` (the current handle exposes `emit`/`swirl`/`startEmitter`/…).

- [ ] **Step 3a: Trim `effects/notes.ts`**

Replace the whole contents of `engine/components/effects/notes.ts` with:

```ts
import { NOTE_GLYPHS, type NoteGlyph, type StoryAsset } from "@/engine/deck/story-assets";
import { NOTE_SIZE_N } from "./note-state";

/** Build a note sprite tinted to an arbitrary HEX (glyph is white line-art → mask + bg color).
 *  Sized as a fraction of the 16:9 stage so the effect is resolution-independent — the px
 *  sizing it replaced made the same emitter look different in the canvas and in BeatStage. */
export function makeNoteHex(hex: string, glyph: NoteGlyph, resolveStory: (key: StoryAsset) => string): HTMLElement {
  const el = document.createElement("span");
  const url = resolveStory(glyph);
  Object.assign(el.style, {
    position: "absolute", width: `${NOTE_SIZE_N * 100}%`, aspectRatio: "1",
    backgroundColor: hex,
    WebkitMaskImage: `url(${url})`, maskImage: `url(${url})`,
    WebkitMaskSize: "contain", maskSize: "contain",
    WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
    filter: `drop-shadow(0 0 6px ${hex})`,
    willChange: "transform, opacity",
  } as unknown as CSSStyleDeclaration);
  el.dataset.hex = hex;
  el.dataset.glyph = glyph;
  return el;
}

const GLYPHS = NOTE_GLYPHS.filter((g) => g.startsWith("Notes")) as NoteGlyph[];
export function randomGlyph(i: number): NoteGlyph { return GLYPHS[i % GLYPHS.length]; }
```

Deleted with it: `makeNote`, `emitNote`, `launchNote`, `EMIT_SPEED`, and the `gsap` / `NOTE_TINTS` / `NoteColor` imports.

- [ ] **Step 3b: Rewrite `NoteField.tsx`**

Replace the whole contents of `engine/components/NoteField.tsx` with:

```tsx
"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Scene } from "@/engine/deck/types";
import type { StoryAsset } from "@/engine/deck/story-assets";
import { useAssetResolver } from "@/engine/asset-resolver-react";
import { makeNoteHex } from "./effects/notes";
import { noteFieldStateAt, type NoteSpriteState } from "./effects/note-state";

export interface NoteFieldHandle {
  /** Paint every live note sprite at (beatIndex, t seconds into that beat).
   *  The caller owns the clock — this component holds no time state of its own. */
  renderAt(scene: Scene, beatIndex: number, t: number): void;
}

/** The only place reducer output touches a sprite node. Pure DOM writer. */
export function applyNoteState(
  node: HTMLElement, s: NoteSpriteState, resolveStory: (key: StoryAsset) => string,
): void {
  node.style.display = "block";
  node.style.left = `${s.x * 100}%`;
  node.style.top = `${s.y * 100}%`;
  node.style.opacity = String(s.opacity);
  node.style.transform = `translate(-50%, -50%) scale(${s.scale})`;
  // A pool slot is reused by successive notes, whose glyph/colour differ — restyle only
  // when they actually change, so the common case is three style writes.
  if (node.dataset.hex !== s.hex) {
    node.style.backgroundColor = s.hex;
    node.style.filter = `drop-shadow(0 0 6px ${s.hex})`;
    node.dataset.hex = s.hex;
  }
  if (node.dataset.glyph !== s.glyph) {
    const url = resolveStory(s.glyph);
    node.style.maskImage = `url(${url})`;
    node.style.setProperty("-webkit-mask-image", `url(${url})`);
    node.dataset.glyph = s.glyph;
  }
}

interface Props { reduced?: boolean }

export const NoteField = forwardRef<NoteFieldHandle, Props>(function NoteField({ reduced }, ref) {
  const assets = useAssetResolver();
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const stage = useRef<HTMLDivElement>(null);
  const pool = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => () => { pool.current.forEach((n) => n.remove()); pool.current.clear(); }, []);

  useImperativeHandle(ref, () => ({
    renderAt(scene, beatIndex, t) {
      const host = stage.current;
      if (!host) return;
      const sprites = reduced ? [] : noteFieldStateAt(scene, beatIndex, t);
      const seen = new Set<string>();
      for (const s of sprites) {
        seen.add(s.key);
        let node = pool.current.get(s.key);
        if (!node) {
          node = makeNoteHex(s.hex, s.glyph, assetsRef.current.story);
          host.appendChild(node);
          pool.current.set(s.key, node);
        }
        applyNoteState(node, s, assetsRef.current.story);
      }
      for (const [key, node] of pool.current) if (!seen.has(key)) node.style.display = "none";
    },
  }), [reduced]);

  return (
    <div aria-hidden className="notefield" data-testid="notefield">
      <div className="notefield__stage" ref={stage} />
      <style>{`
        .notefield { position: absolute; inset: 0; pointer-events: none; z-index: 2; overflow: hidden; }
        /* Sprites are positioned against the SAME 16:9 letterbox as .cin__stage, not the
           host. The host differs between the two render paths (DeckCanvas is 16:9;
           BeatStage is fixed/inset:0 = the viewport), so host-relative positioning put the
           same emitter in different places in each. */
        .notefield__stage { position: absolute; inset: 0; margin: auto;
          width: min(100cqw, calc(100cqh * 16 / 9)); height: min(100cqh, calc(100cqw * 9 / 16)); }
      `}</style>
    </div>
  );
});
```

- [ ] **Step 4: Run the full gate**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — the whole unit suite and tsc clean. Task 5 already removed every caller of the deleted methods, so nothing should dangle. If tsc reports an unresolved reference to `startEmitter`, `startCircle`, `stopNotes`, `stopCircles`, `emit`, `stopEmit`, or `swirl`, Task 5 missed a call site — report it rather than re-adding the method.

- [ ] **Step 5: Commit**

```bash
git add engine/components/NoteField.tsx engine/components/effects/notes.ts tests/unit/note-field.test.tsx
git commit -m "feat(notes): reducer-driven NoteField with pooled sprites

Drops per-sprite GSAP, anchors sprites to the 16:9 stage rather than the
host, and deletes the now-unreachable emit/stopEmit/swirl legacy API."
```

---

## Task 7: Mount `NoteField` in the editor canvas

**Files:**
- Modify: `components/editor/DeckCanvas.tsx`
- Test: `tests/unit/deck-canvas-notes.test.tsx` (create)

**Interfaces:**
- Consumes: Task 6's `NoteField`, `NoteFieldHandle`.
- Produces: no new exports. `DeckCanvas` renders a `data-testid="notefield"` node and samples it from `draw()`.

**Note:** unlike objects there is **no mode-swap** — notes have no authoring overlay to swap against, so they render at every `t` including `0`, which is what playback does.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/deck-canvas-notes.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { createRef } from "react";
import { DeckCanvas, type CanvasHandle } from "@/components/editor/DeckCanvas";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc: DeckDoc = {
  version: 1, meta: { id: "d", title: "T" },
  scenes: [{
    id: "s1",
    beats: [{ id: "b0", timeline: [
      { kind: "note_emitter", color: "#ff0000", pos: { x: 0.5, y: 0.5 }, dir: 0, decay: 1000, freq: 4 },
      { kind: "wait", ms: 4000 },
    ] }],
  }],
} as DeckDoc;

const visible = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('[data-testid="notefield"] span')).filter((n) => n.style.display !== "none");

describe("DeckCanvas note rendering", () => {
  beforeEach(() => act(() => useEditor.getState().load(doc)));

  it("paints notes as the scrubber advances", () => {
    const ref = createRef<CanvasHandle>();
    const flat = useEditor.getState().beats[0];
    const { container } = render(<DeckCanvas ref={ref} flat={flat} />);
    act(() => ref.current!.seek(1.5));
    expect(visible(container).length).toBeGreaterThan(0);
  });

  it("scrubbing away and back repaints an identical frame", () => {
    const ref = createRef<CanvasHandle>();
    const flat = useEditor.getState().beats[0];
    const { container } = render(<DeckCanvas ref={ref} flat={flat} />);
    act(() => ref.current!.seek(1.5));
    const snap = visible(container).map((n) => `${n.style.left}|${n.style.top}|${n.style.opacity}`);
    act(() => ref.current!.seek(3.2));
    act(() => ref.current!.seek(1.5));
    expect(visible(container).map((n) => `${n.style.left}|${n.style.top}|${n.style.opacity}`)).toEqual(snap);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/deck-canvas-notes.test.tsx`
Expected: FAIL — `expected 0 to be greater than 0` (no `notefield` node in the canvas).

- [ ] **Step 3: Write minimal implementation**

In `components/editor/DeckCanvas.tsx`:

Add the import beside the existing engine imports:

```ts
import { NoteField, type NoteFieldHandle } from "@/engine/components/NoteField";
```

Add a ref beside `objStage`:

```ts
const notes = useRef<NoteFieldHandle>(null);
```

Extend `draw()` — it becomes:

```ts
const draw = () => {
  if (textHost.current && flat) renderBeatAt(flat.beat.timeline, t.current, { textHost: textHost.current, art: art.current, setNight });
  if (scene) objStage.current?.renderAt(scene, beatIndex, t.current);
  if (scene) notes.current?.renderAt(scene, beatIndex, t.current);
};
```

Mount the component between `<ArtStage>` and the `.cin` div so DOM order matches `BeatStage`'s (art → notes → text → objects):

```tsx
<ArtStage ref={art} nightlight={night} reduced={false} transparentBg />
<NoteField ref={notes} reduced={false} />
<div className="cin"><div className="cin__stage">{/* …unchanged… */}</div></div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — the whole unit suite and tsc clean.

- [ ] **Step 5: Commit**

```bash
git add components/editor/DeckCanvas.tsx tests/unit/deck-canvas-notes.test.tsx
git commit -m "feat(notes): render notes in the editor canvas"
```

---

## Task 8: Drive notes from `BeatStage`

**Files:**
- Modify: `engine/authoring/BeatStage.tsx` (the proxy-tween `useEffect` only)
- Test: `tests/unit/note-parity.test.tsx` (create)

**Interfaces:**
- Consumes: Task 6's `NoteFieldHandle` (the `notes` ref is already declared and already passed to `<NoteField>` — Task 5 left both in place), Task 4's `noteFieldStateAt`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/note-parity.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRef } from "react";
import { BeatStage } from "@/engine/authoring/BeatStage";
import { NoteField, type NoteFieldHandle } from "@/engine/components/NoteField";
import { noteFieldStateAt } from "@/engine/components/effects/note-state";
import type { Scene, Action } from "@/engine/deck/types";

const emitter: Action = { kind: "note_emitter", color: "#00ff00", pos: { x: 0.4, y: 0.6 }, dir: 90, var: 30, decay: 1200, freq: 3 };
const ring: Action = { kind: "note_circle", pos: { x: 0.5, y: 0.5 }, width: 0.3, height: 0.2, hex: ["#fff", "#0ff"], notes: 5, speed: 3000 };
const scene: Scene = { id: "s", beats: [{ id: "b0", timeline: [emitter, ring, { kind: "wait", ms: 4000 }] }] };

const painted = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('[data-testid="notefield"] span'))
    .filter((n) => n.style.display !== "none")
    .map((n) => `${n.style.left}|${n.style.top}|${n.style.opacity}|${n.style.transform}`)
    .sort();

describe("note rendering parity across entry points", () => {
  it("a standalone NoteField and the reducer agree at sampled times", () => {
    const ref = createRef<NoteFieldHandle>();
    const { container } = render(<NoteField ref={ref} />);
    for (const t of [0, 0.4, 1.1, 2.7, 3.9]) {
      ref.current!.renderAt(scene, 0, t);
      expect(painted(container).length).toBe(noteFieldStateAt(scene, 0, t).filter((s) => s.opacity > 0).length);
    }
  });

  it("BeatStage paints the settled state when not animating", () => {
    const { container } = render(
      <BeatStage sceneId="s" beat={scene.beats[0]} scene={scene} beatIndex={0} animate={false} contained />,
    );
    expect(painted(container).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/note-parity.test.tsx`
Expected: the first test PASSES (Task 6 already delivered `NoteField`); the second FAILS with `expected 0 to be greater than 0`, because `BeatStage` never calls `renderAt`.

- [ ] **Step 3: Wire the proxy tween**

In `engine/authoring/BeatStage.tsx`, extend the existing proxy-tween `useEffect` so the *same* clock drives both stages:

```tsx
  useEffect(() => {
    if (!scene) return;
    const span = beatTimeline(beat.timeline).reduce((m, w) => Math.max(m, w.end), 0);
    if (!animate || span <= 0) {
      objStage.current?.renderAt(scene, beatIndex, span || 1e9);
      notes.current?.renderAt(scene, beatIndex, span);   // notes settle at the beat's span
      return;
    }
    const proxy = { p: 0 };
    const tl = gsap.timeline().to(proxy, {
      p: 1, duration: span, ease: "none",
      onUpdate: () => {
        objStage.current?.renderAt(scene, beatIndex, proxy.p * span);
        notes.current?.renderAt(scene, beatIndex, proxy.p * span);
      },
    });
    return () => { tl.kill(); };
  }, [scene, beat, beatIndex, animate]);
```

Append one sentence to the existing `KNOWN LIMITATION` comment block directly above this effect:

```
//   NoteField now rides this same proxy, so it inherits the identical desync. §7b's
//   transport work should re-point BOTH stages at CinematicSlide's real segment timelines.
```

- [ ] **Step 4: Run the full gate**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — the whole unit suite and tsc clean.

- [ ] **Step 5: Commit**

```bash
git add engine/authoring/BeatStage.tsx tests/unit/note-parity.test.tsx
git commit -m "feat(notes): drive NoteField from BeatStage's proxy clock"
```

---

## Task 9: Complete the note descriptors and correct the `seekable` contract

**Files:**
- Modify: `lib/editor/registry.ts:39-44` (the `note_emitter` entry) and `:101-104` (`GENERIC`)
- Modify: `engine/authoring/seek.ts:48-50`
- Modify: `tests/unit/seek.test.ts:12-16`, `tests/unit/registry.test.ts:15`
- Test: `tests/unit/registry-notes.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `REGISTRY.note_circle`, `REGISTRY.stop_notes`, `REGISTRY.stop_circle` (all `EffectDescriptor`); `isSeekable` semantics change to `a.kind !== "cue"`.

**Honesty note for the implementer:** `isSeekable` and `EffectDescriptor.seekable` are referenced **only by tests** — no production code reads either. This change corrects declared contract, not behavior; §7b/§7c and the descriptor-owned plugin work (§11) are the future readers.

**Known gap (deliberate, do not fix here):** `note_circle.hex` is `string[]`, and `FieldType` has no array kind, so `hex` is **omitted from the schema** — exactly as `rotateList`'s descriptor omits its `items: string[]`. A `stringList` field type would close both; that is a follow-on, out of scope.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/registry-notes.test.ts`:

```ts
import { expect, test } from "vitest";
import { descriptorFor } from "@/lib/editor/registry";
import { isSeekable } from "@/engine/authoring/seek";
import type { Action } from "@/engine/deck/types";

test("all four note kinds have real descriptors, not the GENERIC fallback", () => {
  for (const kind of ["note_emitter", "note_circle", "stop_notes", "stop_circle"]) {
    const d = descriptorFor({ kind } as never);
    expect(d.label).not.toBe(kind);            // GENERIC uses the raw kind as its label
    expect(d.icon).not.toBe("ti-square");      // GENERIC's icon
    expect(d.seekable).toBe(true);
  }
});

test("note_emitter exposes every authorable field and a sane decay default", () => {
  const d = descriptorFor({ kind: "note_emitter" } as never);
  const keys = d.schema.map((f) => f.key);
  expect(keys).toEqual(expect.arrayContaining(["color", "pos.x", "pos.y", "dir", "var", "decay", "freq"]));
  const def = d.defaults() as Extract<Action, { kind: "note_emitter" }>;
  expect(def.decay).toBe(1000);   // was 1 (one millisecond!), silently clamped to 0.1s
});

test("note_circle exposes its geometry; hex is a documented gap", () => {
  const d = descriptorFor({ kind: "note_circle" } as never);
  const keys = d.schema.map((f) => f.key);
  expect(keys).toEqual(expect.arrayContaining(["pos.x", "pos.y", "width", "height", "bounce", "notes", "speed"]));
  expect(keys).not.toContain("hex");   // string[] — no array FieldType exists yet
  const def = d.defaults() as Extract<Action, { kind: "note_circle" }>;
  expect(def.hex.length).toBeGreaterThan(0);
});

test("cue is the only non-seekable kind left", () => {
  expect(isSeekable({ kind: "note_emitter", color: "#fff", pos: { x: 0, y: 0 }, dir: 0, decay: 1000, freq: 5 })).toBe(true);
  expect(isSeekable({ kind: "note_circle", pos: { x: 0, y: 0 }, width: 0.2, height: 0.2, hex: ["#fff"] })).toBe(true);
  expect(isSeekable({ kind: "cue", cue: { effect: "noteEmit", action: "start" } })).toBe(false);
  expect(descriptorFor({ kind: "cue" } as never).seekable).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/registry-notes.test.ts`
Expected: FAIL — `expected 'note_circle' not to be 'note_circle'` (GENERIC fallback still in use).

- [ ] **Step 3a: Update `lib/editor/registry.ts`**

Replace the `note_emitter` entry with:

```ts
  note_emitter: { kind: "note_emitter", label: "Note emitter", icon: "ti-music", seekable: true, schema: [
    { key: "color", label: "Color", type: "text" },
    { key: "pos.x", label: "Pos X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "pos.y", label: "Pos Y", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "dir", label: "Direction° (0 = up)", type: "number", min: 0, max: 360, step: 1 },
    { key: "var", label: "Spread°", type: "range", min: 0, max: 180, step: 1 },
    { key: "decay", label: "Lifetime ms", type: "number", min: 100, step: 100 },
    { key: "freq", label: "Notes/sec", type: "number", min: 0, step: 0.5 },
  ], defaults: () => ({ kind: "note_emitter", color: "#ffffff", pos: { x: 0.5, y: 0.5 }, dir: 0, decay: 1000, freq: 2 }) },
  // hex (string[]) is intentionally absent: FieldType has no array kind, exactly as
  // rotateList omits its items[]. A `stringList` field type would close both gaps.
  note_circle: { kind: "note_circle", label: "Note ring", icon: "ti-circle-dotted", seekable: true, schema: [
    { key: "pos.x", label: "Center X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "pos.y", label: "Center Y", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "width", label: "Width (0–1)", type: "range", min: 0.05, max: 1, step: 0.01 },
    { key: "height", label: "Height (0–1)", type: "range", min: 0.05, max: 1, step: 0.01 },
    { key: "bounce", label: "Bounce", type: "range", min: 0, max: 1, step: 0.05 },
    { key: "notes", label: "Note count", type: "number", min: 1, max: 64, step: 1 },
    { key: "speed", label: "Ms per orbit", type: "number", min: 100, step: 100 },
  ], defaults: () => ({ kind: "note_circle", pos: { x: 0.5, y: 0.5 }, width: 0.3, height: 0.3, hex: ["#ffffff"], bounce: 0, notes: 8, speed: 6000 }) },
  stop_notes: { kind: "stop_notes", label: "Stop all notes", icon: "ti-player-stop", seekable: true, schema: [],
    defaults: () => ({ kind: "stop_notes" }) },
  stop_circle: { kind: "stop_circle", label: "Stop note rings", icon: "ti-player-stop", seekable: true, schema: [],
    defaults: () => ({ kind: "stop_circle" }) },
```

Change `GENERIC`'s `seekable` to:

```ts
  kind, label: kind, icon: "ti-square", seekable: kind !== "cue", schema: [],
```

- [ ] **Step 3b: Update `engine/authoring/seek.ts`**

Replace `isSeekable` and its doc comment:

```ts
/** Every effect can be rendered at arbitrary progress. `cue` is the sole exception: it is
 *  inert in Morgana (no runtime implements it) and renders nothing. Note sources became
 *  seekable in §7a via the pure noteFieldStateAt reducer. */
export function isSeekable(a: Action): boolean {
  return a.kind !== "cue";
}
```

- [ ] **Step 3c: Update the two stale assertions**

In `tests/unit/seek.test.ts`, replace the `seekability` test:

```ts
test("seekability: every effect is seekable except the inert `cue`", () => {
  expect(isSeekable({ kind: "text", value: "x", in: "fade" })).toBe(true);
  expect(isSeekable({ kind: "art", art: { to: "3.02", mode: "fade" } })).toBe(true);
  expect(isSeekable({ kind: "note_emitter", color: "#fff", pos: { x: 0, y: 0 }, dir: 0, decay: 1000, freq: 5 })).toBe(true);
  expect(isSeekable({ kind: "cue", cue: { effect: "noteEmit", action: "start" } })).toBe(false);
});
```

In `tests/unit/registry.test.ts:15`, change the `note_emitter` expectation from `.toBe(false)` to `.toBe(true)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — full unit suite; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/editor/registry.ts engine/authoring/seek.ts tests/unit/seek.test.ts tests/unit/registry.test.ts tests/unit/registry-notes.test.ts
git commit -m "feat(notes): complete note descriptors; cue is the only non-seekable kind

Also fixes note_emitter's decay default: 1 (one millisecond, silently
clamped to the 0.1s floor) becomes 1000."
```

---

## Task 10: Fixture deck, dev route, e2e, and docs

**Files:**
- Create: `samples/notes.deck.json`
- Create: `app/dev/notefield/page.tsx`
- Create: `e2e/notes.spec.ts`
- Modify: `docs/MM_MORGANA.md`
- Modify: `docs/2026-06-29-morgana-end-state-design.md:204-252` (§7)

**Interfaces:**
- Consumes: everything above.
- Produces: the deck `notes` (openable at `/editor?deck=notes`), the route `/dev/notefield`.

**Why a fixture:** `scripts/prepare-standalone.sh` copies `samples/*.deck.json` into all three isolated e2e data dirs, so a new sample seeds itself with no config change. No existing sample deck uses a single note action.

- [ ] **Step 1: Write the failing test**

Create `e2e/notes.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

/** Set a range input to `value` and fire the React onChange. The NATIVE value setter is
 *  required — React tracks controlled-input values on the element, so a plain
 *  `el.value = x` is invisible to it and onChange never fires. Copied from the working
 *  helper in e2e/objects-playback.spec.ts:5. */
async function setRange(page: import("@playwright/test").Page, testId: string, value: number) {
  await page.getByTestId(testId).evaluate(
    (el: HTMLInputElement, v: number) => {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      nativeSetter?.call(el, String(v));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    value,
  );
}

const sprites = '[data-testid="notefield"] span';
const frame = (page: import("@playwright/test").Page) =>
  page.$$eval(sprites, (nodes) =>
    nodes
      .filter((n) => (n as HTMLElement).style.display !== "none")
      .map((n) => { const e = n as HTMLElement; return `${e.style.left}|${e.style.top}|${e.style.opacity}`; })
      .sort());

/** Editor specs in this suite have a pre-existing hydration race — the shell HTML can paint
 *  before the client bundle is live. A brief settle measurably reduces (does not eliminate)
 *  it; see the same wait in e2e/objects-playback.spec.ts:36 and e2e/objects.spec.ts. */
const openDeck = async (page: import("@playwright/test").Page) => {
  await page.goto("/editor?deck=notes");
  await expect(page.getByTestId("scrub")).toBeVisible();
  await page.waitForTimeout(300);
};

test("editor canvas paints notes under scrub, deterministically", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openDeck(page);

  await setRange(page, "scrub", 1.5);
  await expect.poll(async () => (await frame(page)).length).toBeGreaterThan(0);
  const at15 = await frame(page);

  await setRange(page, "scrub", 3.0);
  const at30 = await frame(page);
  expect(at30).not.toEqual(at15);          // time actually advances the sprites

  await setRange(page, "scrub", 1.5);
  expect(await frame(page)).toEqual(at15); // …and returning to t repaints the same frame

  expect(errors).toEqual([]);
});

test("notes survive into a later beat and stop when told to", async ({ page }) => {
  await openDeck(page);
  const film = page.getByTestId("filmstrip");

  // beat 1 starts no sources of its own — anything painted is carried from beat 0
  await film.locator(".ed__beat").nth(1).click();
  await setRange(page, "scrub", 0.5);
  await expect.poll(async () => (await frame(page)).length).toBeGreaterThan(0);

  // beat 2 stops the rings, then everything
  await film.locator(".ed__beat").nth(2).click();
  await setRange(page, "scrub", 2.5);
  await expect.poll(async () => (await frame(page)).length).toBe(0);
});

test("BeatStage dev route paints notes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/dev/notefield");
  await expect(page.locator(sprites).first()).toBeVisible();
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=1 npm run test:e2e -- notes.spec.ts`
Expected: FAIL — the `notes` deck 404s and `/dev/notefield` is a 404.

- [ ] **Step 3a: Create the fixture deck**

Create `samples/notes.deck.json`:

```json
{
  "version": 1,
  "meta": { "id": "notes", "title": "Note Particles" },
  "scenes": [
    { "id": "notes", "beats": [
      { "id": "b0", "timeline": [
        { "kind": "text", "value": "Sources start here", "in": "fade" },
        { "kind": "note_emitter", "color": "#f0c9a0", "pos": { "x": 0.3, "y": 0.7 }, "dir": 0, "var": 30, "decay": 1500, "freq": 3 },
        { "kind": "note_circle", "pos": { "x": 0.7, "y": 0.4 }, "width": 0.24, "height": 0.24, "hex": ["#d4a843", "#f0c9a0"], "bounce": 0.3, "notes": 6, "speed": 4000 },
        { "kind": "wait", "ms": 4000 }
      ] },
      { "id": "b1", "timeline": [
        { "kind": "text", "value": "…and carry into this beat", "in": "fade" },
        { "kind": "wait", "ms": 3000 }
      ] },
      { "id": "b2", "timeline": [
        { "kind": "text", "value": "Rings stop, then everything", "in": "fade" },
        { "kind": "wait", "ms": 1000 },
        { "kind": "stop_circle" },
        { "kind": "wait", "ms": 1000 },
        { "kind": "stop_notes" },
        { "kind": "wait", "ms": 1000 }
      ] }
    ] }
  ]
}
```

- [ ] **Step 3b: Create the dev route**

Create `app/dev/notefield/page.tsx`:

```tsx
"use client";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { Scene } from "@/engine/deck/types";

// A ring is used for the static assertion because ring notes never expire — the settled
// state (animate=false → t = the beat's span) always has all `notes` sprites painted,
// which makes the e2e deterministic without sampling a mid-flight emitter.
const scene: Scene = {
  id: "s1",
  beats: [{ id: "b0", timeline: [
    { kind: "note_circle", pos: { x: 0.5, y: 0.5 }, width: 0.3, height: 0.3, hex: ["#d4a843"], notes: 6, speed: 4000 },
    { kind: "wait", ms: 2000 },
  ] }],
};

export default function Page() {
  return <BeatStage sceneId="s1" beat={scene.beats[0]} scene={scene} beatIndex={0} animate={false} />;
}
```

- [ ] **Step 3c: Verify the new sample did not perturb existing specs**

Run: `CI=1 npm run test:e2e`

`editor.spec.ts` opens `/editor` with no `?deck=` and expects the demo deck's 2 beats; `library.spec.ts` filters deck cards by title rather than counting. If either now fails because the default deck changed, fix it by pinning the spec to `/editor?deck=demo` (the pattern `layers-panel.spec.ts:8` already uses) — **do not** rename or remove the fixture.

- [ ] **Step 3d: Sync the docs**

In `docs/MM_MORGANA.md`, add to the design-docs bullet list under `docs/`:

```markdown
- **Tier 2 §7 is decomposed** into §7a (time-pure note particles — spec
  `docs/superpowers/specs/2026-07-27-time-pure-particles-7a-design.md`), §7b (the seekable
  transport surface) and §7c (canvas swap + parity gate + `seek.ts` deletion). §7a is the
  first landed. **Gotcha — `CinematicSlide`'s GSAP master is a callback scheduler with time
  spacers, not a seekable representation**: effects are scheduled via `master.add(fn)` (a
  `delayedCall`), so the timelines the effect builders return are orphaned and run on
  wall-clock, which is why durations are re-declared as `master.to({}, {duration})` spacers
  and why `seek.ts` carries a second copy of `introDuration`. `master.seek(t)` therefore
  does *not* work today — §7b is a restructure, not a control surface.
- **Note particles are pure functions of time** (`engine/components/effects/note-state.ts`).
  `NoteField` holds no time state: both `DeckCanvas` and `BeatStage` mount it and supply a
  clock. `CinematicRuntime` no longer carries `cue`/`emitter`/`noteCircle`/`stopNotes`/
  `stopCircles` — the `cue` *action kind* survives in `types.ts` for deck-format
  compatibility but is inert. Do not re-add per-sprite GSAP tweens: a second note animation
  implementation is exactly the drift liability §7 exists to remove.
```

In `docs/2026-06-29-morgana-end-state-design.md` §7, append a short note recording the
decomposition, the two findings above, and that `samples/notes.deck.json` seeds §7c's parity
corpus (partially closing the §18 residual "which decks and times").

- [ ] **Step 4: Run the full gate**

Run: `npm test && npx tsc --noEmit && CI=1 npm run test:e2e`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add samples/notes.deck.json app/dev/notefield/page.tsx e2e/notes.spec.ts docs/MM_MORGANA.md docs/2026-06-29-morgana-end-state-design.md
git commit -m "test(notes): fixture deck, dev route, e2e; sync docs

samples/notes.deck.json seeds itself into all three e2e data dirs and is
recorded as the starting corpus for §7c's parity gate."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §3.1 reducer location | 1 |
| §3.2 types & signature | 2, 4 |
| §3.3 coordinate model + 16:9 anchoring fix | 1 (constants), 6 (stage box, sprite sizing) |
| §3.4 fold + phase continuation | 4 |
| §3.5 emitter closed form + seeded jitter + ms units | 2 |
| §3.6 ring transcription | 3 |
| §3.7 bounds & pooling | 2 (per-source), 3 (ring), 4 (total), 6 (node reuse) |
| §3.8 degenerate inputs | 2, 3, 4 |
| §4 `NoteField` + `applyNoteState` | 6 |
| §5.1 DeckCanvas | 7 |
| §5.2 BeatStage | 8 |
| §5.3 deletions | 5 (`CinematicSlide`/`runtime.ts`), 6 (`NoteField`/`notes.ts`) |
| §5.4 `seekable` contract + 2 test updates | 9 |
| §5.5 descriptors + `hex` gap + `decay` default | 9 |
| §6 fixture + corpus + deck-count check | 10 |
| §7 unit / component / parity / e2e | 2–4 / 6 / 8 / 10 |
| §8 phases | 1–4 = phase 1; 5–6 = phase 2; 7–8 = phase 3; 9–10 = phase 4 |

No gaps.

**Placeholder scan:** every code step carries real code; no "TBD", no "similar to Task N", no "add error handling". The one deliberate conditional is Task 10 Step 3c, which states the exact fix (`/editor?deck=demo`) and the exact file pattern to copy.

**Type consistency:** `NoteSpriteState` (Task 2) is used verbatim in Tasks 3, 4, 6. `noteFieldStateAt(scene, beatIndex, tLocal)` (Task 4) is called with that arity in Tasks 6, 7, 8. `NoteFieldHandle.renderAt(scene, beatIndex, t)` (Task 6) matches its call sites in Tasks 7 and 8. `emitterDecaySeconds`, `MAX_SPRITES_PER_SOURCE`, `MAX_SPRITES_TOTAL`, `EMIT_SPEED_N`, `NOTE_SIZE_N`, `STAGE_ASPECT` are defined in Tasks 1-2 and referenced consistently thereafter. `randomGlyph` survives the Task 6 trim and is imported by `note-state.ts` from Task 2 onward.

**Every task is typecheck-green.** An earlier draft had the `NoteField` rewrite delete methods whose callers a later task removed, leaving a commit that failed `npx tsc --noEmit`. The runtime strip (Task 5) now runs *before* the rewrite (Task 6), so callers disappear before the methods do and every commit passes `npx vitest run && npx tsc --noEmit`.
