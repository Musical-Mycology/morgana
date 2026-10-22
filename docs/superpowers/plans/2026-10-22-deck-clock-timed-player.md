# Deck Clock + Timed Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Morgana a deck-wide time axis — pinned scene lengths, a fullscreen timed Player with a count-up clock and whole-deck scrubber, and a deck-time ruler in the editor — as sub-project 1 of the timed-video roadmap.

**Architecture:** A new pure module `engine/authoring/deck-clock.ts` maps deck time `T` to `(beat, localT)` on top of `beat-clock.ts`. The Player keeps ONE `BeatStage` mounted with `autoplay={false}`, swaps its `beat` prop as `T` crosses beat boundaries, and drives it with `transport.seek(localT)` every frame — so preview is the same seek loop the future MP4 export will step frame by frame. The editor gets a ruler built on a shared `TimeBar` component that selects the right beat and seeks the existing canvas.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, GSAP (vendored engine), Zustand editor store, Vitest + @testing-library/react (jsdom), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-22-deck-clock-timed-player-design.md` — read it before starting any task.

## Global Constraints

- Format additions are **optional fields under `version: 1`** — no version bump, no migration (`docs/superpowers/specs/deck-format-version-policy.md`).
- `engine/authoring/deck-clock.ts` and `lib/timing/clock-format.ts` are **pure**: no DOM, no GSAP, no React. Only `import type` from non-pure modules. Both are added to `tests/unit/pure-import-graph.test.ts`.
- Durations are **always** derived from `beatDuration` / `actionDuration` in `beat-clock.ts` — never read from a built GSAP timeline.
- In `lintDeck`, severity `"error"` means "the server will reject this save". New timing rules are **warnings**.
- Every hand-built URL goes through `withBasePath()` (`lib/base-path.ts`) or Next `<Link>`; `tests/unit/base-path-callsites.test.ts` must stay green.
- MCP tool descriptions are the only contract a remote model reads — describe semantics fully.
- Run unit tests with `npx vitest run <file>`; full suite `npm test`. E2E must be run as `npm run test:e2e` (it builds first) — never a bare `npx playwright test` without a prior build. To run one e2e spec after the build exists: `npx playwright test e2e/<name>.spec.ts --project=default`.
- Baseline before Task 1: `npm test` → 106 files / 556 tests passing.

## Review Focus

1. **Scrubbing into the middle of a beat after a beat change** — the first painted frame must be the seeked `localT`, not a blank/`t=0` frame (Task 7 seeks in a `useLayoutEffect` keyed on the beat; test pins it).
2. **Seeking backwards across a beat boundary** restores the earlier beat's inherited nightlight (Task 1 `entryNight` re-applied on beat change; test pins it).
3. **An empty-but-pinned scene, and a scene with only zero-length beats** — locate must not crash or return a beat that never plays (Task 3 tests).
4. **Turning "Timed deck" off** must leave a deck that still validates and saves (`meta.timing` removed, not `null`) (Task 8 test).
5. **Space/arrow keys typed into an input** (the Deck Settings target field, the scene Length field) must not trigger player/editor shortcuts — Player keys only on `/play`, and the editor ignores keys from inputs as it already does (Task 7 test for the player's own guard).

---

### Task 1: Seek-slaved BeatStage (`autoplay`, `entryNight`) + per-frame seek benchmark gate

**Files:**
- Modify: `engine/components/layouts/CinematicSlide.tsx` (Props interface ~line 78–98; mount effect: the `play();` call at ~line 239)
- Modify: `engine/authoring/BeatStage.tsx`
- Create: `app/dev/seekbench/page.tsx`
- Create: `e2e/seek-bench.spec.ts`
- Test: `tests/unit/beatstage-autoplay.test.tsx`

**Interfaces:**
- Produces: `CinematicSlide` prop `autoplay?: boolean` (default `true`). `BeatStage` props `autoplay?: boolean` (default `true`, forwarded) and `entryNight?: number`.

- [ ] **Step 1: Write the failing test** — `tests/unit/beatstage-autoplay.test.tsx`. Model the render setup on `tests/unit/beatstage-objects.test.tsx` (read it first; copy its GSAP/jsdom mocks verbatim if it has any).

```tsx
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import gsap from "gsap";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import type { Beat } from "@/engine/deck/types";

afterEach(cleanup);

const beat: Beat = { id: "b", timeline: [{ kind: "text", value: "hello", in: "fade" }, { kind: "wait", ms: 1000 }] };

test("autoplay={false} never registers a gsap ticker; seek still renders", () => {
  const add = vi.spyOn(gsap.ticker, "add");
  const transport = createRef<SlideTransport>();
  render(<BeatStage sceneId="s" beat={beat} autoplay={false} transport={transport} contained />);
  expect(add).not.toHaveBeenCalled();
  transport.current!.seek(1.5);
  expect(document.body.textContent).toContain("hello");
  add.mockRestore();
});

test("default autoplay still registers the ticker (unchanged behaviour)", () => {
  const add = vi.spyOn(gsap.ticker, "add");
  render(<BeatStage sceneId="s" beat={beat} contained />);
  expect(add).toHaveBeenCalled();
  add.mockRestore();
});
```

Note: jsdom's `document.visibilityState` is `"visible"` by default; if the existing BeatStage tests stub it, follow their pattern.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/beatstage-autoplay.test.tsx`
Expected: FAIL — `autoplay` is not a known prop / ticker is added.

- [ ] **Step 3: Implement `autoplay` in `CinematicSlide`**

Add to `Props`:

```ts
  /** false = never start the autoplay ticker on mount; the host drives time via
   *  `transport.seek` (the timed Player). Entry art is still issued. Default true. */
  autoplay?: boolean;
```

Destructure `autoplay = true` in the component signature. Replace the mount effect's bare `play();` (the one directly after the "Autoplay from t=0" comment) with:

```ts
    if (autoplay) play();
    else renderAt(0); // host-driven: paint t=0 and wait for transport.seek
```

Add `autoplay` to the `useGSAP` `dependencies` array next to `animate`.

- [ ] **Step 4: Implement `autoplay` + `entryNight` in `BeatStage`**

Add props `autoplay = true` and `entryNight?: number` to the destructure and the prop type (with doc comments). Forward `autoplay={autoplay}` to `<CinematicSlide>`. Replace the nightlight state:

```tsx
  const [night, setNight] = useState(entryNight ?? beat.nightlight ?? 0);
  // CinematicSlide only issues nightlight for `nightlight` ACTIONS, never the beat's inherited
  // entry value. A host that swaps `beat` on a mounted stage (the timed Player) passes the
  // flattened entry nightlight here, and it must be re-applied on every beat change — including
  // a backward seek into an earlier beat.
  useLayoutEffect(() => {
    if (entryNight != null) setNight(entryNight);
  }, [entryNight, sceneId, beat.id]);
```

(import `useLayoutEffect` from react). Add a third test to the Step 1 file:

```tsx
test("entryNight is re-applied when the beat changes", () => {
  // ArtStage renders `.artstage__glow` with opacity 0.15 + 0.45 * min(1, nightlight):
  // nightlight 1 → 0.6, nightlight 0 → 0.15.
  const glow = (c: HTMLElement) => (c.querySelector(".artstage__glow") as HTMLElement).style.opacity;
  const b2: Beat = { id: "b2", timeline: [{ kind: "wait", ms: 500 }] };
  const { rerender, container } = render(<BeatStage sceneId="s" beat={beat} autoplay={false} entryNight={1} contained />);
  expect(Number(glow(container))).toBeCloseTo(0.6);
  rerender(<BeatStage sceneId="s" beat={b2} autoplay={false} entryNight={0} contained />);
  expect(Number(glow(container))).toBeCloseTo(0.15);
  rerender(<BeatStage sceneId="s" beat={beat} autoplay={false} entryNight={1} contained />); // backward swap
  expect(Number(glow(container))).toBeCloseTo(0.6);
});
```

- [ ] **Step 5: Run unit tests**

Run: `npx vitest run tests/unit/beatstage-autoplay.test.tsx tests/unit/beatstage-objects.test.tsx`
Expected: PASS.

- [ ] **Step 6: Benchmark page** — `app/dev/seekbench/page.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import type { Action, Beat, Scene } from "@/engine/deck/types";
import { beatDuration } from "@/engine/authoring/beat-clock";

// A deliberately busy beat: SplitText-heavy lines, a counter, a moving media tile, and a dense
// note emitter — the worst case for the timed Player's per-frame forward seek (spec §1 gate).
const INS = ["letterFly", "wordUp", "typewriter", "blurIn"] as const;
const timeline: Action[] = [
  ...Array.from({ length: 8 }, (_, i): Action => ({ kind: "text", value: `Line ${i} of a fairly long benchmarking sentence`, in: INS[i % 4] })),
  { kind: "counter_show", pos: { x: 0.7, y: 0.2 }, value: 0, prefix: "$" },
  { kind: "counter_to", value: 1000000, durationMs: 2000 },
  { kind: "media", id: "m1", pos: { x: 0.8, y: 0.6 }, label: "Tile", durationMs: 600 },
  { kind: "media_move", id: "m1", to: { x: 0.3, y: 0.6 }, durationMs: 1500 },
  { kind: "note_emitter", color: "#ffcc66", pos: { x: 0.5, y: 0.8 }, dir: 0, var: 40, decay: 2000, freq: 12 },
  { kind: "wait", ms: 3000 },
];
const beat: Beat = { id: "bench", timeline };
const scene: Scene = { id: "bench", beats: [beat] };
const FRAMES = 600; // 10s at 60fps

export default function Page() {
  const transport = useRef<SlideTransport>(null);
  const [result, setResult] = useState("running");
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const dur = beatDuration(timeline);
      let total = 0, max = 0;
      for (let i = 0; i <= FRAMES; i++) {
        const t0 = performance.now();
        transport.current?.seek((i / FRAMES) * dur);
        const dt = performance.now() - t0;
        total += dt; max = Math.max(max, dt);
      }
      setResult(`mean=${(total / (FRAMES + 1)).toFixed(3)} max=${max.toFixed(3)}`);
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <>
      <BeatStage sceneId="bench" beat={beat} scene={scene} beatIndex={0} autoplay={false} transport={transport} />
      <output data-testid="bench-result" style={{ position: "fixed", bottom: 8, left: 8, zIndex: 10, color: "#fff" }}>{result}</output>
    </>
  );
}
```

- [ ] **Step 7: Benchmark gate e2e** — `e2e/seek-bench.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

// Spec §1 gate: the timed Player seeks the mounted beat once per frame. A forward seek must
// cost well under one 60fps frame (16.7ms) on a busy beat, or the seek-slaved design is wrong.
test("per-frame forward seek on a busy beat stays under half a frame", async ({ page }) => {
  await page.goto("/dev/seekbench");
  const out = page.getByTestId("bench-result");
  await expect(out).toContainText("mean=");
  const text = await out.textContent();
  const mean = Number(/mean=([\d.]+)/.exec(text!)![1]);
  console.log(`[seek-bench] ${text}`);
  expect(mean).toBeLessThan(8);
});
```

- [ ] **Step 8: Run the gate**

Run: `npm run test:e2e -- e2e/seek-bench.spec.ts --project=default`
Expected: PASS, and the `[seek-bench]` log line printed. **Record the mean/max numbers in your report.** If mean ≥ 8ms: STOP, do not continue to later tasks, report BLOCKED with the numbers — the approach needs revisiting with the user.

- [ ] **Step 9: Full unit suite + commit**

Run: `npm test` → all pass.

```bash
git add engine/components/layouts/CinematicSlide.tsx engine/authoring/BeatStage.tsx app/dev/seekbench/page.tsx e2e/seek-bench.spec.ts tests/unit/beatstage-autoplay.test.tsx
git commit -m "feat(engine): host-driven BeatStage (autoplay=false, entryNight) + per-frame seek gate"
```

---

### Task 2: Timing fields in the deck format + validation

**Files:**
- Modify: `engine/deck-doc.ts` (`DeckMeta`, `validateDeckDoc`)
- Modify: `engine/deck/types.ts` (`Scene`)
- Test: `tests/unit/deck-doc-timing.test.ts`

**Interfaces:**
- Produces: `DeckMeta.timing?: { targetSec: number }`; `Scene.durationSec?: number`. Validation messages exactly: `"meta.timing.targetSec must be a finite number > 0"` and `` `scenes[${i}].durationSec must be a finite number > 0` ``.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s", beats: [] }] });

test("timing and durationSec are optional", () => {
  expect(validateDeckDoc(base()).ok).toBe(true);
});

test("valid timing + durationSec pass", () => {
  const d = base(); d.meta.timing = { targetSec: 120 }; d.scenes[0].durationSec = 15;
  expect(validateDeckDoc(d)).toEqual({ ok: true, errors: [] });
});

test("an explicitly-undefined timing (Timed deck toggled off) passes", () => {
  const d = base(); d.meta.timing = undefined;
  expect(validateDeckDoc(d).ok).toBe(true);
});

test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, "120", null])("targetSec %p is rejected", (v) => {
  const d = base(); (d.meta as unknown as Record<string, unknown>).timing = { targetSec: v };
  expect(validateDeckDoc(d).errors).toContain("meta.timing.targetSec must be a finite number > 0");
});

test("timing: null is rejected", () => {
  const d = base(); (d.meta as unknown as Record<string, unknown>).timing = null;
  expect(validateDeckDoc(d).errors).toContain("meta.timing.targetSec must be a finite number > 0");
});

test.each([0, -3, Number.NaN, "15"])("durationSec %p is rejected with a scene-located message", (v) => {
  const d = base(); (d.scenes[0] as unknown as Record<string, unknown>).durationSec = v;
  expect(validateDeckDoc(d).errors).toContain("scenes[0].durationSec must be a finite number > 0");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/deck-doc-timing.test.ts` → FAIL (type errors on `timing`/`durationSec`, missing messages).

- [ ] **Step 3: Implement**

In `engine/deck/types.ts` `Scene`, after `objects?`:

```ts
  /** Pinned scene length in seconds (timed decks). Omit = length follows content.
   *  Content shorter than this holds its last frame; longer is cut at the boundary. */
  durationSec?: number;
```

In `engine/deck-doc.ts` `DeckMeta`, after `chrome?`:

```ts
  /** Present = a timed deck (video). `targetSec` is the intended total length, e.g. 120. */
  timing?: { targetSec: number };
```

Add a helper above `validateDeckDoc`:

```ts
const isPositiveFinite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
```

Inside `validateDeckDoc`, in the `else` branch that checks `meta.id`/`meta.title`, append:

```ts
    const timing = (d.meta as { timing?: unknown }).timing;
    if (timing !== undefined && (timing === null || typeof timing !== "object" || !isPositiveFinite((timing as { targetSec?: unknown }).targetSec))) {
      e.push("meta.timing.targetSec must be a finite number > 0");
    }
```

Inside the `d.scenes.forEach`, after the `beats` check:

```ts
    if (s?.durationSec !== undefined && !isPositiveFinite(s.durationSec)) e.push(`scenes[${i}].durationSec must be a finite number > 0`);
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/deck-doc-timing.test.ts tests/unit/deck-doc.test.ts` → PASS. Then `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add engine/deck-doc.ts engine/deck/types.ts tests/unit/deck-doc-timing.test.ts
git commit -m "feat(format): optional meta.timing.targetSec and scene durationSec"
```

---

### Task 3: The pure deck clock + clock formatting

**Files:**
- Create: `engine/authoring/deck-clock.ts`
- Create: `lib/timing/clock-format.ts`
- Modify: `tests/unit/pure-import-graph.test.ts` (add both files to the `test.each` list)
- Test: `tests/unit/deck-clock.test.ts`, `tests/unit/clock-format.test.ts`

**Interfaces:**
- Consumes: `beatDuration(timeline: Action[]): number` from `engine/authoring/beat-clock.ts`; `DeckDoc` type.
- Produces (exact):

```ts
// engine/authoring/deck-clock.ts
export interface BeatSpan { beatIdx: number; flatIdx: number; start: number; duration: number } // start is scene-local
export interface SceneSpan { sceneIdx: number; start: number; length: number; contentLength: number; pinned: boolean; beats: BeatSpan[] }
export interface DeckLayout { scenes: SceneSpan[]; total: number }
export type LocatePhase = "play" | "hold" | "empty";
export interface Located { sceneIdx: number; beatIdx: number | null; flatIdx: number | null; localT: number; phase: LocatePhase }
export function deckLayout(doc: DeckDoc): DeckLayout;
export function locate(layout: DeckLayout, T: number): Located | null; // null iff total === 0
export function deckTimeOf(layout: DeckLayout, flatIdx: number, localT: number): number;
export function sceneOverrun(span: SceneSpan): number; // seconds over the pinned length; 0 if unpinned or within

// lib/timing/clock-format.ts
export function formatClock(sec: number, opts?: { tenths?: boolean }): string; // 47.34 → "0:47.3"; tenths:false → "0:47"
export function parseClock(text: string): number | null;                       // "2:00"→120, "90"→90, "1:30.5"→90.5, bad→null
```

- [ ] **Step 1: Write the failing deck-clock test** — `tests/unit/deck-clock.test.ts`. `wait` actions give exact durations (`ms/1000`); `art` is zero-length.

```ts
import { expect, test } from "vitest";
import { deckLayout, locate, deckTimeOf, sceneOverrun } from "@/engine/authoring/deck-clock";
import type { DeckDoc } from "@/engine/deck-doc";
import type { Beat, Scene } from "@/engine/deck/types";

const w = (id: string, ms: number): Beat => ({ id, timeline: [{ kind: "wait", ms }] });
const zero = (id: string): Beat => ({ id, timeline: [{ kind: "art", art: { to: "3.02", mode: "cut" } }] });
const doc = (scenes: Scene[]): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes });

// s0 pinned 5s with 3s content (2s hold); s1 unpinned 2+1=3s; s2 empty pinned 2s; s3 pinned 1s with 2.5s content (overrun)
const D = doc([
  { id: "s0", durationSec: 5, beats: [w("a", 1000), w("b", 2000)] },
  { id: "s1", beats: [w("c", 2000), w("d", 1000)] },
  { id: "s2", durationSec: 2, beats: [] },
  { id: "s3", durationSec: 1, beats: [w("e", 2500)] },
]);

test("deckLayout: starts, lengths, content, flat indices", () => {
  const L = deckLayout(D);
  expect(L.scenes.map((s) => [s.start, s.length, s.contentLength, s.pinned])).toEqual([
    [0, 5, 3, true], [5, 3, 3, false], [8, 2, 0, true], [10, 1, 2.5, true],
  ]);
  expect(L.total).toBe(11);
  expect(L.scenes[1].beats.map((b) => [b.flatIdx, b.start, b.duration])).toEqual([[2, 0, 2], [3, 2, 1]]);
});

test("play phase maps T into the right beat", () => {
  expect(locate(deckLayout(D), 0.5)).toEqual({ sceneIdx: 0, beatIdx: 0, flatIdx: 0, localT: 0.5, phase: "play" });
  expect(locate(deckLayout(D), 1.5)).toEqual({ sceneIdx: 0, beatIdx: 1, flatIdx: 1, localT: 0.5, phase: "play" });
});

test("hold phase: content ended before the pinned end → last beat, settled", () => {
  expect(locate(deckLayout(D), 4)).toEqual({ sceneIdx: 0, beatIdx: 1, flatIdx: 1, localT: 2, phase: "hold" });
});

test("scenes are half-open: exactly on a boundary belongs to the next scene", () => {
  expect(locate(deckLayout(D), 5)).toMatchObject({ sceneIdx: 1, beatIdx: 0, localT: 0, phase: "play" });
});

test("empty pinned scene", () => {
  expect(locate(deckLayout(D), 9)).toEqual({ sceneIdx: 2, beatIdx: null, flatIdx: null, localT: 0, phase: "empty" });
});

test("overrun is cut at the boundary; later scenes never move", () => {
  const L = deckLayout(D);
  expect(sceneOverrun(L.scenes[3])).toBeCloseTo(1.5);
  expect(sceneOverrun(L.scenes[0])).toBe(0);
  expect(sceneOverrun(L.scenes[1])).toBe(0);
  expect(locate(L, 10.5)).toMatchObject({ sceneIdx: 3, localT: 0.5, phase: "play" });
});

test("T is clamped; T === total is the final end state", () => {
  const L = deckLayout(D);
  expect(locate(L, -4)).toMatchObject({ sceneIdx: 0, localT: 0 });
  expect(locate(L, 999)).toMatchObject({ sceneIdx: 3, beatIdx: 0, localT: 1 });
});

test("zero-length beats are never the located beat", () => {
  const L = deckLayout(doc([{ id: "s", beats: [zero("z"), w("a", 1000), zero("y")] }]));
  expect(locate(L, 0)).toMatchObject({ beatIdx: 1, localT: 0, phase: "play" });
  expect(locate(L, 1)).toMatchObject({ beatIdx: 1, localT: 1 });
});

test("a pinned scene whose beats are all zero-length holds its last beat", () => {
  const L = deckLayout(doc([{ id: "s", durationSec: 3, beats: [zero("z"), zero("y")] }]));
  expect(locate(L, 1)).toEqual({ sceneIdx: 0, beatIdx: 1, flatIdx: 1, localT: 0, phase: "hold" });
});

test("zero-length scenes are skipped", () => {
  const L = deckLayout(doc([{ id: "gap", beats: [] }, { id: "s", beats: [w("a", 1000)] }]));
  expect(L.total).toBe(1);
  expect(locate(L, 0)).toMatchObject({ sceneIdx: 1, beatIdx: 0 });
});

test("nothing to play → null", () => {
  expect(locate(deckLayout(doc([{ id: "gap", beats: [] }])), 0)).toBeNull();
  expect(locate(deckLayout(doc([])), 0)).toBeNull();
});

test("deckTimeOf is the inverse of locate inside content", () => {
  const L = deckLayout(D);
  for (const T of [0.25, 1.5, 6.2, 7.9, 10.4]) {
    const l = locate(L, T)!;
    expect(deckTimeOf(L, l.flatIdx!, l.localT)).toBeCloseTo(T);
  }
  expect(deckTimeOf(L, 99, 0)).toBe(0); // unknown flat index
  expect(deckTimeOf(L, 4, 9)).toBe(11); // clamped to the scene's (cut) end
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/deck-clock.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `engine/authoring/deck-clock.ts`**

```ts
/** The deck-wide time axis (timed decks). Pure: no DOM, no GSAP, no React — enforced by
 *  tests/unit/pure-import-graph.test.ts. Built on beat-clock.ts, the single source of truth
 *  for beat durations; nothing here reads a built GSAP timeline.
 *
 *  Scenes are laid end to end. A scene's length is its pinned `durationSec` if set, else its
 *  content length. Pinned scenes HOLD their last frame when content ends early and CUT content
 *  that runs past the boundary — so later scenes (and their music cue points) never move. */
import type { DeckDoc } from "@/engine/deck-doc";
import { beatDuration } from "./beat-clock";

export interface BeatSpan { beatIdx: number; flatIdx: number; start: number; duration: number }
export interface SceneSpan { sceneIdx: number; start: number; length: number; contentLength: number; pinned: boolean; beats: BeatSpan[] }
export interface DeckLayout { scenes: SceneSpan[]; total: number }
export type LocatePhase = "play" | "hold" | "empty";
export interface Located { sceneIdx: number; beatIdx: number | null; flatIdx: number | null; localT: number; phase: LocatePhase }

export function deckLayout(doc: DeckDoc): DeckLayout {
  const scenes: SceneSpan[] = [];
  let cursor = 0;
  let flatIdx = 0;
  doc.scenes.forEach((scene, sceneIdx) => {
    let local = 0;
    const beats = scene.beats.map((beat, beatIdx): BeatSpan => {
      const duration = beatDuration(beat.timeline);
      const span = { beatIdx, flatIdx: flatIdx++, start: local, duration };
      local += duration;
      return span;
    });
    const pinned = typeof scene.durationSec === "number";
    const length = pinned ? scene.durationSec! : local;
    scenes.push({ sceneIdx, start: cursor, length, contentLength: local, pinned, beats });
    cursor += length;
  });
  return { scenes, total: cursor };
}

/** Seconds of content past the pinned boundary (cut off in playback); 0 when unpinned or within. */
export function sceneOverrun(span: SceneSpan): number {
  return span.pinned ? Math.max(0, span.contentLength - span.length) : 0;
}

/** Where deck time `T` lands. `null` iff there is nothing to play (total === 0). */
export function locate(layout: DeckLayout, T: number): Located | null {
  if (layout.total <= 0) return null;
  const t = Math.max(0, Math.min(layout.total, T));
  let scene: SceneSpan | undefined;
  for (const s of layout.scenes) {
    if (s.length <= 0) continue;          // zero-length scenes occupy no time
    if (s.start <= t) scene = s; else break; // half-open: a boundary belongs to the next scene
  }
  const s = scene!;
  const local = Math.min(t - s.start, s.length);
  if (s.beats.length === 0) return { sceneIdx: s.sceneIdx, beatIdx: null, flatIdx: null, localT: 0, phase: "empty" };

  // Only beats that take time and start before the (possibly cut) boundary can be on screen.
  const reachable = s.beats.filter((b) => b.duration > 0 && b.start < s.length);
  if (reachable.length === 0) {
    const last = s.beats[s.beats.length - 1];
    return { sceneIdx: s.sceneIdx, beatIdx: last.beatIdx, flatIdx: last.flatIdx, localT: 0, phase: "hold" };
  }
  let beat = reachable[0];
  for (const b of reachable) { if (b.start <= local) beat = b; else break; }
  const into = local - beat.start;
  const isLast = beat === reachable[reachable.length - 1];
  const phase: LocatePhase = isLast && into >= beat.duration && local < s.length ? "hold" : "play";
  return { sceneIdx: s.sceneIdx, beatIdx: beat.beatIdx, flatIdx: beat.flatIdx, localT: Math.min(into, beat.duration), phase };
}

/** Deck time of (`flatIdx`, beat-local `localT`) — the inverse of `locate`, for the editor
 *  playhead. Clamped to the scene's (possibly cut) end; 0 for an unknown index. */
export function deckTimeOf(layout: DeckLayout, flatIdx: number, localT: number): number {
  for (const s of layout.scenes) {
    const b = s.beats.find((x) => x.flatIdx === flatIdx);
    if (b) return s.start + Math.min(b.start + Math.max(0, Math.min(localT, b.duration)), s.length);
  }
  return 0;
}
```

Check the hold test: at T=4, scene s0 local=4, reachable=[a(0,1), b(1,2)], beat=b, into=3 ≥ 2, isLast, local(4) < 5 → "hold", localT=min(3,2)=2 ✓. At T=999 → t=11, scene s3, local=min(1,1)=1, beat e, into=1 < 2.5 → "play", localT=1 ✓ (test only checks `localT: 1`).

- [ ] **Step 4: Run deck-clock tests** → `npx vitest run tests/unit/deck-clock.test.ts` → PASS. Fix the implementation (not the tests) on any failure.

- [ ] **Step 5: Write the failing clock-format test** — `tests/unit/clock-format.test.ts`:

```ts
import { expect, test } from "vitest";
import { formatClock, parseClock } from "@/lib/timing/clock-format";

test("formatClock", () => {
  expect(formatClock(0)).toBe("0:00.0");
  expect(formatClock(47.34)).toBe("0:47.3");
  expect(formatClock(59.96)).toBe("1:00.0");   // rounding carries into minutes
  expect(formatClock(120, { tenths: false })).toBe("2:00");
  expect(formatClock(75.9, { tenths: false })).toBe("1:15"); // tenths:false floors, never shows 1:16 early
  expect(formatClock(-3)).toBe("0:00.0");
});

test("parseClock", () => {
  expect(parseClock("2:00")).toBe(120);
  expect(parseClock("1:30.5")).toBe(90.5);
  expect(parseClock("90")).toBe(90);
  expect(parseClock(" 0:15 ")).toBe(15);
  for (const bad of ["", "abc", "1:75", "-1", "1:2:3", "0", "0:00"]) expect(parseClock(bad)).toBeNull();
});
```

- [ ] **Step 6: Implement `lib/timing/clock-format.ts`**

```ts
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

/** "m:ss[.f]" or plain seconds → seconds > 0; anything else (incl. 0) → null. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  const m = /^(?:(\d+):([0-5]\d(?:\.\d+)?)|(\d+(?:\.\d+)?))$/.exec(t);
  if (!m) return null;
  const v = m[3] !== undefined ? Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(v) && v > 0 ? v : null;
}
```

- [ ] **Step 7: Add both modules to the purity test** — in `tests/unit/pure-import-graph.test.ts`, extend the `test.each` array:

```ts
  "engine/authoring/deck-clock.ts",
  "lib/timing/clock-format.ts",
```

- [ ] **Step 8: Run** `npx vitest run tests/unit/deck-clock.test.ts tests/unit/clock-format.test.ts tests/unit/pure-import-graph.test.ts` → PASS; `npm test` → all pass.

- [ ] **Step 9: Commit**

```bash
git add engine/authoring/deck-clock.ts lib/timing/clock-format.ts tests/unit/deck-clock.test.ts tests/unit/clock-format.test.ts tests/unit/pure-import-graph.test.ts
git commit -m "feat(engine): pure deck clock — pinned scene lengths, hold, overrun, locate"
```

---

### Task 4: Timing lint rules

**Files:**
- Modify: `lib/editor/lint.ts` (`lintDeck`)
- Test: `tests/unit/lint-timing.test.ts`

**Interfaces:**
- Consumes: `deckLayout`, `sceneOverrun` (Task 3); `formatClock` (Task 3); `parseInlineLinks` from `engine/deck/inline-links.ts` (returns segments; a jump link has `kind: "link"` and `link: "jump"`).
- Produces: lint rules `scene-overrun`, `deck-length-mismatch`, `timed-interactive` — all `severity: "warning"`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { lintDeck } from "@/lib/editor/lint";
import type { DeckDoc } from "@/engine/deck-doc";

const deck = (over: Partial<DeckDoc> = {}): DeckDoc => ({
  version: 1, meta: { id: "d", title: "D", timing: { targetSec: 10 } },
  scenes: [
    { id: "opening", durationSec: 2, beats: [{ id: "a", timeline: [{ kind: "wait", ms: 3200 }] }] },
    { id: "credits", beats: [{ id: "b", timeline: [{ kind: "text", value: "see [slide 1](jump:1)", in: "fade" }, { kind: "click_gate" }, { kind: "wait", ms: 1000 }] }] },
  ],
  ...over,
});
const byRule = (d: DeckDoc, rule: string) => lintDeck(d).filter((i) => i.rule === rule);

test("scene-overrun is a warning located to the scene", () => {
  const [i] = byRule(deck(), "scene-overrun");
  expect(i).toMatchObject({ severity: "warning", at: { sceneIdx: 0 } });
  expect(i.message).toBe('scene "opening" runs 1.2s over its 2s');
});

test("deck-length-mismatch reports short/long against the target", () => {
  const [i] = byRule(deck(), "deck-length-mismatch"); // total = 2 + ~(0.8+1) ≈ 3.8 vs 10
  expect(i.severity).toBe("warning");
  expect(i.message).toMatch(/^deck is 0:0\d of 0:10 — \d+\.\ds short$/);
  expect(i.at).toBeUndefined();
});

test("timed-interactive flags gates and jump links per action", () => {
  const issues = byRule(deck(), "timed-interactive");
  expect(issues.map((i) => i.at)).toEqual([
    { sceneIdx: 1, beatIdx: 0, actionIdx: 0 },
    { sceneIdx: 1, beatIdx: 0, actionIdx: 1 },
  ]);
  expect(issues.every((i) => i.severity === "warning")).toBe(true);
});

test("untimed decks get no deck-length or interactive warnings (overrun still applies)", () => {
  const d = deck(); d.meta = { id: "d", title: "D" };
  expect(byRule(d, "deck-length-mismatch")).toEqual([]);
  expect(byRule(d, "timed-interactive")).toEqual([]);
  expect(byRule(d, "scene-overrun")).toHaveLength(1);
});

test("a deck exactly on target has no mismatch", () => {
  const d = deck({ scenes: [{ id: "s", durationSec: 10, beats: [{ id: "a", timeline: [{ kind: "wait", ms: 1000 }] }] }] });
  expect(byRule(d, "deck-length-mismatch")).toEqual([]);
});

test("timing lint never runs on a structurally invalid deck", () => {
  const d = deck(); (d.scenes[0] as unknown as Record<string, unknown>).durationSec = -1;
  expect(byRule(d, "scene-overrun")).toEqual([]);
  expect(lintDeck(d).some((i) => i.rule === "structure")).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/lint-timing.test.ts` → FAIL.

- [ ] **Step 3: Implement** — in `lib/editor/lint.ts` add imports:

```ts
import { deckLayout, sceneOverrun } from "@/engine/authoring/deck-clock";
import { formatClock } from "@/lib/timing/clock-format";
import { parseInlineLinks } from "@/engine/deck/inline-links";
import type { Action } from "@/engine/deck/types";
```

Add, above `lintDeck`:

```ts
const INTERACTIVE_KINDS = new Set<Action["kind"]>(["click_gate", "reveal_arrows", "pulse_arrow", "reveal_again"]);

function isInteractive(a: Action): boolean {
  if (INTERACTIVE_KINDS.has(a.kind)) return true;
  return a.kind === "text" && parseInlineLinks(a.value).some((seg) => seg.kind === "link" && seg.link === "jump");
}

/** Timing warnings (timed-video decks). Runs only on a structurally valid deck. */
function timingWarnings(doc: DeckDoc): LintIssue[] {
  const out: LintIssue[] = [];
  const layout = deckLayout(doc);
  for (const s of layout.scenes) {
    const over = sceneOverrun(s);
    if (over > 0) {
      out.push({ rule: "scene-overrun", severity: "warning", at: { sceneIdx: s.sceneIdx },
        message: `scene "${doc.scenes[s.sceneIdx].id}" runs ${over.toFixed(1)}s over its ${s.length}s` });
    }
  }
  const target = doc.meta.timing?.targetSec;
  if (target === undefined) return out;
  const diff = layout.total - target;
  if (Math.abs(diff) >= 0.05) {
    out.push({ rule: "deck-length-mismatch", severity: "warning",
      message: `deck is ${formatClock(layout.total, { tenths: false })} of ${formatClock(target, { tenths: false })} — ${Math.abs(diff).toFixed(1)}s ${diff < 0 ? "short" : "over"}` });
  }
  doc.scenes.forEach((s, sceneIdx) => s.beats.forEach((b, beatIdx) => b.timeline.forEach((a, actionIdx) => {
    if (isInteractive(a)) {
      out.push({ rule: "timed-interactive", severity: "warning", at: { sceneIdx, beatIdx, actionIdx },
        message: `${a.kind} is interactive and is ignored in timed playback` });
    }
  })));
  return out;
}
```

In `lintDeck`, inside the existing `if (errors.length === 0) {` block, before the `try`, add:

```ts
    warnings.push(...timingWarnings(doc));
```

Confirm `parseInlineLinks` is the exported name and the segment shape by reading `engine/deck/inline-links.ts` (the type there is `{ kind: "link"; ...; link: LinkKind }`).

- [ ] **Step 4: Run** `npx vitest run tests/unit/lint-timing.test.ts tests/unit/lint.test.ts tests/unit/lint-panel.test.tsx` → PASS; `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/editor/lint.ts tests/unit/lint-timing.test.ts
git commit -m "feat(lint): scene-overrun, deck-length-mismatch, timed-interactive warnings"
```

---

### Task 5: `setSceneDuration` mutation, store action, and MCP tools

**Files:**
- Modify: `lib/editor/mutations.ts`, `lib/editor/store.ts`
- Modify: `lib/mcp/tool-defs.ts`, `lib/mcp/tool-handlers.ts`
- Modify: `README.md` (MCP tool list, ~line 225–240)
- Test: `tests/unit/mutations.test.ts` (append), `tests/unit/mcp-tool-handlers.test.ts` (append), `tests/unit/mcp-tool-defs.test.ts` (append), `tests/unit/deck-store-scene-duration.test.ts`

**Interfaces:**
- Consumes: `deckLayout`, `sceneOverrun` (Task 3).
- Produces: `setSceneDuration(doc: DeckDoc, sceneIdx: number, seconds: number | null): DeckDoc` (out-of-range → same reference; `null` deletes the key). Store action `setSceneDuration: (sceneIdx: number, seconds: number | null) => void`. MCP tools `set_scene_duration`, `read_deck_timing`.

- [ ] **Step 1: Write failing tests.** Read the top of each existing test file first and reuse its fixtures/mocks (the MCP handler test mocks `@/lib/store/deck-store`; follow that pattern exactly).

`tests/unit/mutations.test.ts` (append):

```ts
import { setSceneDuration } from "@/lib/editor/mutations";

test("setSceneDuration pins, unpins, and no-ops out of range", () => {
  const d: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s", beats: [] }] };
  const pinned = setSceneDuration(d, 0, 15);
  expect(pinned.scenes[0].durationSec).toBe(15);
  const unpinned = setSceneDuration(pinned, 0, null);
  expect("durationSec" in unpinned.scenes[0]).toBe(false);
  expect(setSceneDuration(d, 5, 3)).toBe(d);
});
```

(Adjust the import line to merge with the file's existing imports.)

`tests/unit/deck-store-scene-duration.test.ts`:

```ts
import { beforeEach, expect, test } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

beforeEach(() => useEditor.getState().load({ version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s", beats: [{ id: "a", timeline: [] }] }] } as DeckDoc));

test("setSceneDuration commits an undoable edit", () => {
  useEditor.getState().setSceneDuration(0, 12);
  expect(useEditor.getState().doc!.scenes[0].durationSec).toBe(12);
  useEditor.getState().undo();
  expect(useEditor.getState().doc!.scenes[0].durationSec).toBeUndefined();
});
```

`tests/unit/mcp-tool-defs.test.ts` (append):

```ts
test("includes the timing tools", () => {
  const names = TOOL_DEFS.map((t) => t.name);
  expect(names).toEqual(expect.arrayContaining(["set_scene_duration", "read_deck_timing"]));
  const upd = TOOL_DEFS.find((t) => t.name === "update_meta")!;
  expect(upd.description).toContain("timing.targetSec");
});
```

`tests/unit/mcp-tool-handlers.test.ts` (append — this file runs against the REAL filesystem store in a temp `MORGANA_DATA_DIR`; it already imports `createDeck`, `loadDeck`, `callTool`. Add `saveDeck` to the existing `@/lib/store/deck-store` import):

```ts
async function timedFixture(): Promise<void> {
  await createDeck({ id: "demo", title: "Demo" });
  const doc = await loadDeck("demo");
  await saveDeck({ ...doc, meta: { ...doc.meta, timing: { targetSec: 10 } },
    scenes: [{ id: "s", durationSec: 0.5, beats: [{ id: "a", timeline: [{ kind: "wait", ms: 1000 }] }] }] });
}

test("set_scene_duration pins and clears a scene length", async () => {
  await timedFixture();
  await callTool("set_scene_duration", { deck_id: "demo", scene_index: 0, seconds: 15 });
  expect((await loadDeck("demo")).scenes[0].durationSec).toBe(15);
  await callTool("set_scene_duration", { deck_id: "demo", scene_index: 0, seconds: null });
  expect((await loadDeck("demo")).scenes[0].durationSec).toBeUndefined();
});

test("set_scene_duration rejects a non-positive length", async () => {
  await timedFixture();
  await expect(callTool("set_scene_duration", { deck_id: "demo", scene_index: 0, seconds: 0 })).rejects.toThrow(/durationSec/);
});

test("read_deck_timing returns layout, target, and overruns", async () => {
  await timedFixture();
  const r = await callTool("read_deck_timing", { deck_id: "demo" }) as { targetSec: number | null; total: number; scenes: { id: string; overrunSec: number; beats: { id: string }[] }[] };
  expect(r.targetSec).toBe(10);
  expect(r.total).toBeCloseTo(0.5);
  expect(r.scenes[0]).toMatchObject({ id: "s", overrunSec: 0.5, beats: [{ id: "a" }] });
});

test("update_meta with path timing and value null makes the deck untimed", async () => {
  await timedFixture();
  await callTool("update_meta", { deck_id: "demo", path: "timing", value: null });
  expect((await loadDeck("demo")).meta.timing).toBeUndefined();
});
```

If `createDeck`'s signature differs from `{ id, title }`, match the existing tests in this file.

- [ ] **Step 2: Run to verify failures** — `npx vitest run tests/unit/mutations.test.ts tests/unit/deck-store-scene-duration.test.ts tests/unit/mcp-tool-defs.test.ts tests/unit/mcp-tool-handlers.test.ts` → FAIL.

- [ ] **Step 3: Implement the mutation** — `lib/editor/mutations.ts`, after `appendBeatToScene`:

```ts
/** Pin (`seconds`) or un-pin (`null`) a scene's length for timed playback. Out of range → no-op
 *  (same reference). Validation of the value is validateDeckDoc's job. */
export function setSceneDuration(doc: DeckDoc, sceneIdx: number, seconds: number | null): DeckDoc {
  if (sceneIdx < 0 || sceneIdx >= doc.scenes.length) return doc;
  return mapScene(doc, sceneIdx, (s) => {
    if (seconds === null) { const { durationSec: _drop, ...rest } = s; return rest; }
    return { ...s, durationSec: seconds };
  });
}
```

- [ ] **Step 4: Store action** — `lib/editor/store.ts`: add `setSceneDuration` to the mutations import, to `EditorState` (`setSceneDuration: (sceneIdx: number, seconds: number | null) => void;`), and to the store body next to `moveScene`:

```ts
  setSceneDuration: (sceneIdx, seconds) => set((s) => commit(s, (doc) => setSceneDuration(doc, sceneIdx, seconds))),
```

- [ ] **Step 5: MCP tool defs** — `lib/mcp/tool-defs.ts`. Change `update_meta`'s description to:

```ts
    description: "Set a single field on the deck's metadata, addressed by a dot-path (e.g. \"title\", \"chrome.wordmark\"). To make a timed (video) deck, set \"timing.targetSec\" to the intended total length in seconds (e.g. 120); set \"timing\" to null to make it untimed again.",
```

Append two tools to `TOOL_DEFS`:

```ts
  {
    name: "set_scene_duration",
    description: "Pin a scene's length in seconds for timed playback, or pass seconds: null to un-pin it (length then follows the scene's content). A pinned scene always occupies exactly that long, so later scenes never move: if its beats finish early the last frame holds until the boundary; if they run longer, playback cuts them at the boundary (read_deck_timing reports the overrun).",
    inputSchema: schema({
      ...DECK_ID, ...SCENE_INDEX,
      seconds: { type: ["number", "null"], description: "Length in seconds (> 0), or null to un-pin." },
    }, ["deck_id", "scene_index", "seconds"]),
  },
  {
    name: "read_deck_timing",
    description: "Read-only. Returns the deck's computed time layout: targetSec (null if untimed), total seconds, and per scene its id, start, length, contentLength, pinned flag, overrunSec (content cut off past a pinned boundary), and each beat's flat index, id, scene-local start and duration. Use this instead of summing action durations yourself.",
    inputSchema: schema({ ...DECK_ID }, ["deck_id"]),
  },
```

- [ ] **Step 6: MCP handlers** — `lib/mcp/tool-handlers.ts`: import `setSceneDuration` with the other mutations and `deckLayout, sceneOverrun` from `@/engine/authoring/deck-clock`. Make `update_meta` accept `null` to delete: change its body to

```ts
    case "update_meta": {
      const path = requireString(a, "path");
      assertSafePath(path);
      return mutate(deckId, (doc) => ({ ...doc, meta: setPath(doc.meta, path, a.value === null && path === "timing" ? undefined : a.value) }));
    }
```

Add cases before `default`:

```ts
    case "set_scene_duration": {
      const v = a.seconds;
      if (v !== null && typeof v !== "number") throw new ToolCallError('"seconds" must be a number or null');
      return mutate(deckId, (doc) => setSceneDuration(doc, requireNumber(a, "scene_index"), v));
    }
    case "read_deck_timing": {
      const doc = await loadDeck(deckId);
      const layout = deckLayout(doc);
      return {
        targetSec: doc.meta.timing?.targetSec ?? null,
        total: layout.total,
        scenes: layout.scenes.map((s) => ({
          index: s.sceneIdx, id: doc.scenes[s.sceneIdx].id, start: s.start, length: s.length,
          contentLength: s.contentLength, pinned: s.pinned, overrunSec: sceneOverrun(s),
          beats: s.beats.map((b) => ({ flatIndex: b.flatIdx, id: doc.scenes[s.sceneIdx].beats[b.beatIdx].id, start: b.start, duration: b.duration })),
        })),
      };
    }
```

(If the handler function is not `async`, follow how `read_deck` returns `loadDeck(deckId)` and chain with `.then` instead.)

- [ ] **Step 7: README** — in the MCP section's tool list (~line 229–231) add a sentence: "Timed (video) decks: `set_scene_duration` pins a scene's length, `read_deck_timing` reports the computed layout and overruns, and `update_meta` with path `timing.targetSec` sets the target length."

- [ ] **Step 8: Run** the four test files → PASS; `npm test` → all pass.

- [ ] **Step 9: Commit**

```bash
git add lib/editor/mutations.ts lib/editor/store.ts lib/mcp/tool-defs.ts lib/mcp/tool-handlers.ts README.md tests/unit/mutations.test.ts tests/unit/deck-store-scene-duration.test.ts tests/unit/mcp-tool-defs.test.ts tests/unit/mcp-tool-handlers.test.ts
git commit -m "feat(mcp,editor): set_scene_duration + read_deck_timing; scene-length store action"
```

---

### Task 6: `TimeBar` — the shared whole-deck scrubber

**Files:**
- Create: `components/timing/TimeBar.tsx`
- Test: `tests/unit/time-bar.test.tsx`

**Interfaces:**
- Consumes: `DeckLayout`, `sceneOverrun` (Task 3).
- Produces:

```ts
export interface TimeBarProps {
  layout: DeckLayout;
  sceneIds: string[];          // label per scene, indexed by sceneIdx
  value: number;               // deck time of the playhead
  targetSec?: number;
  onScrub: (T: number) => void;
  testId: string;              // data-testid on the bar root
}
export function TimeBar(props: TimeBarProps): JSX.Element;
export function timeBarScale(layout: DeckLayout, targetSec?: number): number; // max(total, target, 1e-6)
```

Rendering contract (tests rely on these test ids): root `data-testid={testId}`; one `[data-testid=timebar-scene]` per scene with `length > 0` (attribute `data-scene-idx`, inline `left`/`width` as % of scale, text = scene id); `[data-testid=timebar-hold]` inside a scene for pinned `contentLength < length`; `[data-testid=timebar-overrun]` inside a scene when `sceneOverrun > 0` (with `title="X.Xs over"`); `[data-testid=timebar-target]` at `targetSec`; `[data-testid=timebar-playhead]` at `value`. Pointer down / move (with pointer capture) on the root calls `onScrub(clamp((x / width) * scale, 0, layout.total))`.

- [ ] **Step 1: Write the failing test**

```tsx
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TimeBar, timeBarScale } from "@/components/timing/TimeBar";
import type { DeckLayout } from "@/engine/authoring/deck-clock";

afterEach(cleanup);

const layout: DeckLayout = { total: 10, scenes: [
  { sceneIdx: 0, start: 0, length: 4, contentLength: 3, pinned: true, beats: [] },
  { sceneIdx: 1, start: 4, length: 0, contentLength: 0, pinned: false, beats: [] },
  { sceneIdx: 2, start: 4, length: 6, contentLength: 7.5, pinned: true, beats: [] },
] };

test("segments, hold, overrun, target, playhead", () => {
  render(<TimeBar layout={layout} sceneIds={["opening", "gap", "credits"]} value={5} targetSec={12} onScrub={() => {}} testId="tb" />);
  const segs = screen.getAllByTestId("timebar-scene");
  expect(segs.map((s) => s.textContent)).toEqual(["opening", "credits"]); // zero-length scene not drawn
  expect(segs[0].style.width).toBe(`${(4 / 12) * 100}%`);
  expect(screen.getAllByTestId("timebar-hold")).toHaveLength(1);
  expect(screen.getByTestId("timebar-overrun").getAttribute("title")).toBe("1.5s over");
  expect(screen.getByTestId("timebar-target").style.left).toBe("100%");
  expect(screen.getByTestId("timebar-playhead").style.left).toBe(`${(5 / 12) * 100}%`);
});

test("pointer scrubs in deck time, clamped to total", () => {
  const onScrub = vi.fn();
  render(<TimeBar layout={layout} sceneIds={["a", "b", "c"]} value={0} targetSec={12} onScrub={onScrub} testId="tb" />);
  const bar = screen.getByTestId("tb");
  bar.getBoundingClientRect = () => ({ left: 0, width: 120, top: 0, height: 20, right: 120, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
  bar.setPointerCapture = () => {};
  fireEvent.pointerDown(bar, { clientX: 30, pointerId: 1, buttons: 1 });
  expect(onScrub).toHaveBeenLastCalledWith(3);
  fireEvent.pointerMove(bar, { clientX: 115, pointerId: 1, buttons: 1 });
  expect(onScrub).toHaveBeenLastCalledWith(10); // 11.5 clamped to total
});

test("timeBarScale", () => {
  expect(timeBarScale(layout, 12)).toBe(12);
  expect(timeBarScale(layout)).toBe(10);
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/time-bar.test.tsx` → FAIL.

- [ ] **Step 3: Implement `components/timing/TimeBar.tsx`**

```tsx
"use client";
import type { PointerEvent } from "react";
import { sceneOverrun, type DeckLayout } from "@/engine/authoring/deck-clock";

export interface TimeBarProps {
  layout: DeckLayout;
  sceneIds: string[];
  value: number;
  targetSec?: number;
  onScrub: (T: number) => void;
  testId: string;
}

export function timeBarScale(layout: DeckLayout, targetSec?: number): number {
  return Math.max(layout.total, targetSec ?? 0, 1e-6);
}

const pct = (v: number, scale: number) => `${(v / scale) * 100}%`;

/** Whole-deck scrubber shared by the timed Player HUD and the editor's deck ruler. Scene
 *  segments are drawn to scale; a pinned scene's held tail is shaded and content cut off past
 *  its boundary is flagged red. Purely presentational — the caller owns the clock. */
export function TimeBar({ layout, sceneIds, value, targetSec, onScrub, testId }: TimeBarProps) {
  const scale = timeBarScale(layout, targetSec);
  const scrubFrom = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    onScrub(Math.max(0, Math.min(layout.total, ((e.clientX - r.left) / r.width) * scale)));
  };
  return (
    <div
      data-testid={testId}
      className="timebar"
      role="slider"
      aria-valuemin={0}
      aria-valuemax={layout.total}
      aria-valuenow={value}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrubFrom(e); }}
      onPointerMove={(e) => { if (e.buttons & 1) scrubFrom(e); }}
      style={{ position: "relative", height: 26, borderRadius: 4, background: "rgba(255,255,255,0.06)", cursor: "pointer", touchAction: "none", userSelect: "none" }}
    >
      {layout.scenes.filter((s) => s.length > 0).map((s) => {
        const over = sceneOverrun(s);
        return (
          <div key={s.sceneIdx} data-testid="timebar-scene" data-scene-idx={s.sceneIdx}
            style={{ position: "absolute", top: 0, bottom: 0, left: pct(s.start, scale), width: pct(s.length, scale), borderRight: "1px solid rgba(255,255,255,0.25)", overflow: "hidden", fontSize: 10, lineHeight: "26px", paddingLeft: 4, whiteSpace: "nowrap", color: "rgba(255,255,255,0.75)" }}>
            {sceneIds[s.sceneIdx]}
            {s.pinned && s.contentLength < s.length && (
              <span data-testid="timebar-hold" style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: `${((s.length - s.contentLength) / s.length) * 100}%`, background: "rgba(255,255,255,0.08)" }} />
            )}
            {over > 0 && (
              <span data-testid="timebar-overrun" title={`${over.toFixed(1)}s over`} style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 6, background: "repeating-linear-gradient(45deg, #c0392b 0 3px, transparent 3px 6px)" }} />
            )}
          </div>
        );
      })}
      {targetSec !== undefined && (
        <div data-testid="timebar-target" style={{ position: "absolute", top: -3, bottom: -3, left: pct(targetSec, scale), width: 2, marginLeft: -1, background: "#d4a843" }} />
      )}
      <div data-testid="timebar-playhead" style={{ position: "absolute", top: -4, bottom: -4, left: pct(value, scale), width: 2, marginLeft: -1, background: "#fff", pointerEvents: "none" }} />
    </div>
  );
}
```

- [ ] **Step 4: Run** `npx vitest run tests/unit/time-bar.test.tsx` → PASS (if jsdom lacks `setPointerCapture` on the element during the real handler, the test stub covers it; keep the stub).

- [ ] **Step 5: Commit**

```bash
git add components/timing/TimeBar.tsx tests/unit/time-bar.test.tsx
git commit -m "feat(ui): TimeBar — shared whole-deck scrubber with hold/overrun/target"
```

---

### Task 7: The timed Player (`/play`)

**Files:**
- Create: `components/player/TimedPlayer.tsx`
- Create: `app/play/page.tsx`
- Create: `app/play/play.css`
- Test: `tests/unit/timed-player.test.tsx`, `e2e/play.spec.ts`

**Interfaces:**
- Consumes: `BeatStage` with `autoplay`, `entryNight`, `transport`, `contained` (Task 1); `deckLayout`, `locate`, `Located` (Task 3); `formatClock` (Task 3); `TimeBar` (Task 6); `flattenStory`, `resolveEntryArt`, `resolveBeatArt` from `engine/deck/flatten.ts` (flat indices align with `deckLayout`'s `flatIdx` — both iterate scenes then beats); `loadDeck(id): Promise<DeckDoc>` from `lib/api/decks-client.ts`.
- Produces: `TimedPlayer({ doc, initialT }: { doc: DeckDoc; initialT?: number })`. Test ids: `play-stage`, `play-clock` (with `data-over="true"` past target), `play-scene`, `play-scrub` (TimeBar), `play-hud`, `play-empty`, `play-error`.

- [ ] **Step 1: Write the failing unit test** — `tests/unit/timed-player.test.tsx`. This pins behaviour that doesn't need real time: initial seek, keyboard seeking, the input-focus guard, and empty decks.

```tsx
import { afterEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TimedPlayer } from "@/components/player/TimedPlayer";
import type { DeckDoc } from "@/engine/deck-doc";

afterEach(cleanup);

const doc: DeckDoc = { version: 1, meta: { id: "p", title: "P", timing: { targetSec: 12 } }, scenes: [
  { id: "opening", durationSec: 4, beats: [{ id: "a", timeline: [{ kind: "text", value: "Opening line", in: "fade" }, { kind: "wait", ms: 1000 }] }] },
  { id: "middle", durationSec: 6, beats: [{ id: "b", timeline: [{ kind: "text", value: "Second scene", in: "fade" }, { kind: "wait", ms: 2000 }] }] },
  { id: "credits", beats: [{ id: "c", timeline: [{ kind: "text", value: "Credits", in: "fade" }, { kind: "wait", ms: 1000 }] }] },
] };

test("initialT lands in the right scene and shows the clock against the target", () => {
  render(<TimedPlayer doc={doc} initialT={5} />);
  expect(screen.getByTestId("play-clock").textContent).toBe("0:05.0 / 0:12");
  expect(screen.getByTestId("play-scene").textContent).toBe("middle");
  expect(screen.getByTestId("play-stage").textContent).toContain("Second scene");
  expect(screen.getByTestId("play-stage").textContent).not.toContain("Opening line");
});

test("arrow keys seek ±1s / ±5s, Home returns to 0, and backward across a beat swaps back", () => {
  render(<TimedPlayer doc={doc} initialT={5} />);
  act(() => { fireEvent.keyDown(window, { key: "ArrowRight" }); });
  expect(screen.getByTestId("play-clock").textContent).toBe("0:06.0 / 0:12");
  act(() => { fireEvent.keyDown(window, { key: "ArrowLeft", shiftKey: true }); });
  expect(screen.getByTestId("play-clock").textContent).toBe("0:01.0 / 0:12");
  expect(screen.getByTestId("play-scene").textContent).toBe("opening");
  expect(screen.getByTestId("play-stage").textContent).toContain("Opening line");
  act(() => { fireEvent.keyDown(window, { key: "Home" }); });
  expect(screen.getByTestId("play-clock").textContent).toBe("0:00.0 / 0:12");
});

test("keys typed into an input are ignored", () => {
  render(<><input data-testid="other" /><TimedPlayer doc={doc} initialT={5} /></>);
  const input = screen.getByTestId("other");
  input.focus();
  act(() => { fireEvent.keyDown(input, { key: "ArrowRight" }); });
  expect(screen.getByTestId("play-clock").textContent).toBe("0:05.0 / 0:12");
});

test("past the target the clock is flagged", () => {
  const long: DeckDoc = { ...doc, meta: { ...doc.meta, timing: { targetSec: 3 } } };
  render(<TimedPlayer doc={long} initialT={5} />);
  expect(screen.getByTestId("play-clock").getAttribute("data-over")).toBe("true");
});

test("untimed decks show elapsed / total", () => {
  const untimed: DeckDoc = { ...doc, meta: { id: "p", title: "P" } };
  render(<TimedPlayer doc={untimed} initialT={0} />);
  expect(screen.getByTestId("play-clock").textContent).toBe("0:00.0 / 0:11"); // 4 + 6 + 1.8 = 11.8 → floor
});

test("a deck with nothing to play shows the empty message", () => {
  render(<TimedPlayer doc={{ ...doc, scenes: [{ id: "gap", beats: [] }] }} />);
  expect(screen.getByTestId("play-empty").textContent).toContain("Nothing to play");
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/timed-player.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement `components/player/TimedPlayer.tsx`**

```tsx
"use client";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DeckDoc } from "@/engine/deck-doc";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import { flattenStory, resolveBeatArt, resolveEntryArt } from "@/engine/deck/flatten";
import { deckLayout, locate, type Located } from "@/engine/authoring/deck-clock";
import { formatClock } from "@/lib/timing/clock-format";
import { TimeBar } from "@/components/timing/TimeBar";

const HUD_IDLE_MS = 2000;

/** One mounted BeatStage for the whole deck. Memoised on the beat so the per-frame clock
 *  re-render never re-renders the stage; only a beat change does. */
const Stage = memo(function Stage({ doc, flatIdx, transport }: { doc: DeckDoc; flatIdx: number; transport: React.RefObject<SlideTransport | null> }) {
  const slides = useMemo(() => flattenStory(doc.scenes), [doc]);
  const slide = slides[flatIdx];
  const entryLayers = useMemo(() => resolveEntryArt(slides, flatIdx).layers, [slides, flatIdx]);
  const endLayers = useMemo(() => resolveBeatArt(slides, flatIdx).layers, [slides, flatIdx]);
  if (!slide || slide.layout !== "cinematic") return null;
  const scene = doc.scenes.find((s) => s.id === slide.slots.sceneId)!;
  const beatIndex = scene.beats.indexOf(slide.slots.beat);
  return (
    <BeatStage
      sceneId={slide.slots.sceneId} beat={slide.slots.beat} scene={scene} beatIndex={beatIndex}
      entryLayers={entryLayers} endLayers={endLayers} entryNight={slide.nightlight}
      chrome={doc.meta.chrome} autoplay={false} transport={transport} contained
    />
  );
});

export function TimedPlayer({ doc, initialT = 0 }: { doc: DeckDoc; initialT?: number }) {
  const layout = useMemo(() => deckLayout(doc), [doc]);
  const target = doc.meta.timing?.targetSec;
  const transport = useRef<SlideTransport>(null);
  const T = useRef(Math.max(0, Math.min(layout.total, initialT)));
  const [displayT, setDisplayT] = useState(T.current);
  const [loc, setLoc] = useState<Located | null>(() => locate(layout, T.current));
  const locRef = useRef(loc);
  const [playing, setPlaying] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [hudPinned, setHudPinned] = useState(true); // H toggles; when false the HUD stays hidden
  const idle = useRef<number | null>(null);

  /** Move the deck clock to `to` and paint. A beat change re-renders <Stage>; the seek for the
   *  new beat happens in the layout effect below so the first painted frame is already at localT. */
  const apply = useCallback((to: number) => {
    T.current = Math.max(0, Math.min(layout.total, to));
    const next = locate(layout, T.current);
    const prev = locRef.current;
    locRef.current = next;
    if (next?.flatIdx !== prev?.flatIdx || next?.phase !== prev?.phase) setLoc(next);
    else if (next && next.flatIdx != null) transport.current?.seek(next.localT);
    setDisplayT(T.current);
  }, [layout]);

  // Children's layout effects (CinematicSlide's beat setup) run before this one, so the seek
  // lands on the freshly-mounted beat before the browser paints.
  useLayoutEffect(() => {
    if (loc && loc.flatIdx != null) transport.current?.seek(locRef.current?.localT ?? loc.localT);
  }, [loc]);

  // The one clock: a single rAF loop while playing.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let id = requestAnimationFrame(function step(now) {
      apply(T.current + (now - last) / 1000);
      last = now;
      if (T.current >= layout.total) { setPlaying(false); return; }
      id = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(id);
  }, [playing, apply, layout.total]);

  // A hidden tab pauses rather than jumping ahead when it comes back.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState !== "visible") setPlaying(false); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const step = e.shiftKey ? 5 : 1;
      switch (e.key) {
        case " ": e.preventDefault(); setPlaying((p) => (T.current >= layout.total ? (apply(0), true) : !p)); break;
        case "ArrowRight": e.preventDefault(); apply(T.current + step); break;
        case "ArrowLeft": e.preventDefault(); apply(T.current - step); break;
        case "Home": e.preventDefault(); apply(0); break;
        case "f": case "F": void document.documentElement.requestFullscreen?.(); break;
        case "h": case "H": setHudPinned((v) => !v); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apply, layout.total]);

  // HUD: always visible while paused; fades 2s after the last pointer move while playing.
  const wake = () => {
    setHudVisible(true);
    if (idle.current != null) clearTimeout(idle.current);
    idle.current = window.setTimeout(() => setHudVisible(false), HUD_IDLE_MS);
  };
  useEffect(() => { if (!playing) setHudVisible(true); else wake(); }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (layout.total <= 0) {
    return <div className="play play--empty" data-testid="play-empty">Nothing to play — add beats or pin a scene length.</div>;
  }

  const over = target !== undefined && displayT > target;
  const sceneId = loc ? doc.scenes[loc.sceneIdx].id : "";
  return (
    <div className="play" onPointerMove={wake}>
      <div className="play__frame" data-testid="play-stage">
        {loc && loc.flatIdx != null && <Stage doc={doc} flatIdx={loc.flatIdx} transport={transport} />}
      </div>
      {hudPinned && (
        <div className={`play__hud${hudVisible ? "" : " play__hud--hidden"}`} data-testid="play-hud">
          <button className="play__btn" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
          <span className="play__clock" data-testid="play-clock" data-over={over ? "true" : undefined}>
            {formatClock(displayT)} / {formatClock(target ?? layout.total, { tenths: false })}
          </span>
          <span className="play__scene" data-testid="play-scene">{sceneId}</span>
          <div className="play__bar">
            <TimeBar layout={layout} sceneIds={doc.scenes.map((s) => s.id)} value={displayT} targetSec={target}
              onScrub={(to) => { setPlaying(false); apply(to); }} testId="play-scrub" />
          </div>
        </div>
      )}
    </div>
  );
}
```

Notes for the implementer: the `Space` handler restarts from 0 when at the end. If `react-hooks/exhaustive-deps` is not configured in this repo, drop the eslint comment. Keep `apply` as the only writer of `T`.

- [ ] **Step 4: Styles** — `app/play/play.css`:

```css
.play { position: fixed; inset: 0; background: #000; display: grid; place-items: center; overflow: hidden; }
.play--empty { color: #ccc; font-family: system-ui, sans-serif; font-size: 16px; }
.play__frame { position: relative; width: min(100vw, calc(100vh * 16 / 9)); aspect-ratio: 16 / 9; container-type: size; overflow: hidden; }
.play__hud { position: fixed; left: 16px; right: 16px; bottom: 16px; display: grid; grid-template-columns: auto auto 1fr; grid-template-rows: auto auto; gap: 8px 12px; align-items: center;
  padding: 10px 12px; border-radius: 8px; background: rgba(0,0,0,0.6); color: #fff; font-family: system-ui, sans-serif; transition: opacity 300ms; z-index: 50; }
.play__hud--hidden { opacity: 0; pointer-events: none; }
.play__btn { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,0.4); border-radius: 4px; padding: 2px 10px; cursor: pointer; }
.play__clock { font-family: ui-monospace, monospace; font-size: 15px; }
.play__clock[data-over="true"] { color: #e8a33d; }
.play__scene { font-size: 12px; opacity: 0.75; }
.play__bar { grid-column: 1 / -1; }
```

- [ ] **Step 5: The route** — `app/play/page.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import "./play.css";
import type { DeckDoc } from "@/engine/deck-doc";
import { loadDeck } from "@/lib/api/decks-client";
import { TimedPlayer } from "@/components/player/TimedPlayer";

export default function PlayPage() {
  const [state, setState] = useState<{ doc: DeckDoc; t: number } | "loading" | "error">("loading");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("deck") ?? "demo";
    const t = Number(q.get("t") ?? 0);
    loadDeck(id)
      .then((doc) => setState({ doc, t: Number.isFinite(t) ? t : 0 }))
      .catch((e) => { console.error("failed to load deck", e); setState("error"); });
  }, []);
  if (state === "loading") return <div className="play" />;
  if (state === "error") return <div className="play play--empty" data-testid="play-error">Couldn&apos;t load deck.</div>;
  return <TimedPlayer doc={state.doc} initialT={state.t} />;
}
```

- [ ] **Step 6: Run unit tests** — `npx vitest run tests/unit/timed-player.test.tsx` → PASS. If "Second scene" is not in `play-stage` text after `initialT=5`, the Stage-mount seek ordering is wrong — debug that (Review Focus #1), do not loosen the test.

- [ ] **Step 7: e2e** — `e2e/play.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

const id = "e2e-play";
const doc = { version: 1, meta: { id, title: "Play", timing: { targetSec: 12 } }, scenes: [
  { id: "opening", durationSec: 4, beats: [{ id: "a", timeline: [{ kind: "text", value: "Opening line", in: "fade" }, { kind: "wait", ms: 1000 }] }] },
  { id: "middle", durationSec: 6, beats: [{ id: "b", timeline: [{ kind: "text", value: "Second scene", in: "fade" }, { kind: "wait", ms: 2000 }] }] },
  { id: "credits", beats: [{ id: "c", timeline: [{ kind: "text", value: "Credits", in: "fade" }, { kind: "wait", ms: 1000 }] }] },
] };

test.beforeEach(async ({ request }) => {
  await request.delete(`/api/decks/${id}`).catch(() => {});
  await request.post("/api/decks", { data: { id, title: "Play" } });
  await request.put(`/api/decks/${id}`, { data: doc });
});
test.afterEach(async ({ request }) => { await request.delete(`/api/decks/${id}`); });

test("?t= deep-link starts at that time in the right scene", async ({ page }) => {
  await page.goto(`/play?deck=${id}&t=5`);
  await expect(page.getByTestId("play-clock")).toHaveText("0:05.0 / 0:12");
  await expect(page.getByTestId("play-stage")).toContainText("Second scene");
});

test("Space plays and pauses; a paused clock does not move", async ({ page }) => {
  await page.goto(`/play?deck=${id}`);
  await expect(page.getByTestId("play-clock")).toHaveText("0:00.0 / 0:12");
  await page.keyboard.press(" ");
  await expect(page.getByTestId("play-clock")).not.toHaveText("0:00.0 / 0:12");
  await page.keyboard.press(" ");
  const frozen = await page.getByTestId("play-clock").textContent();
  await page.waitForTimeout(500);
  await expect(page.getByTestId("play-clock")).toHaveText(frozen!);
});

test("scrubbing the bar jumps in deck time", async ({ page }) => {
  await page.goto(`/play?deck=${id}`);
  const bar = page.getByTestId("play-scrub");
  const box = (await bar.boundingBox())!;
  await page.mouse.click(box.x + box.width * (7 / 12), box.y + box.height / 2);
  await expect(page.getByTestId("play-scene")).toHaveText("middle");
  await expect(page.getByTestId("play-stage")).toContainText("Second scene");
});

test("unknown deck shows the load error", async ({ page }) => {
  await page.goto(`/play?deck=e2e-does-not-exist`);
  await expect(page.getByTestId("play-error")).toBeVisible();
});
```

- [ ] **Step 8: Run** `npm run test:e2e -- e2e/play.spec.ts --project=default` → PASS; `npm test` → all pass.

- [ ] **Step 9: Commit**

```bash
git add components/player/TimedPlayer.tsx app/play/page.tsx app/play/play.css tests/unit/timed-player.test.tsx e2e/play.spec.ts
git commit -m "feat(player): /play timed player — deck clock, count-up HUD, seek-slaved stage"
```

---

### Task 8: Editor timing inputs — Deck Settings target + scene Length

**Files:**
- Modify: `components/editor/DeckSettings.tsx`
- Modify: `components/editor/Filmstrip.tsx` (scene header row)
- Modify: `app/editor/editor.css`
- Test: `tests/unit/deck-settings-timing.test.tsx`, `tests/unit/filmstrip-scene-length.test.tsx`

**Interfaces:**
- Consumes: store `updateMeta(path, value)`, `setSceneDuration(sceneIdx, seconds|null)` (Task 5); `deckLayout`, `sceneOverrun` (Task 3); `formatClock`, `parseClock` (Task 3).
- Produces: test ids `timed-toggle` (checkbox), `target-length` (text input, `m:ss`), `scene-length` (number input per scene header, `data-scene-idx`), `scene-length-content` (muted content-length text, `data-over="true"` on overrun).

- [ ] **Step 1: Write failing tests**

`tests/unit/deck-settings-timing.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEditor } from "@/lib/editor/store";
import { DeckSettings } from "@/components/editor/DeckSettings";
import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";

const deck = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s", beats: [{ id: "a", timeline: [{ kind: "wait", ms: 90500 }] }] }] });
beforeEach(() => useEditor.getState().load(deck()));
afterEach(cleanup);

test("turning Timed deck on sets a target rounded up from the current total", () => {
  render(<DeckSettings />);
  fireEvent.click(screen.getByTestId("timed-toggle"));
  expect(useEditor.getState().doc!.meta.timing).toEqual({ targetSec: 91 });
  expect((screen.getByTestId("target-length") as HTMLInputElement).value).toBe("1:31");
});

test("editing the target accepts m:ss and ignores garbage", () => {
  render(<DeckSettings />);
  fireEvent.click(screen.getByTestId("timed-toggle"));
  const input = screen.getByTestId("target-length");
  fireEvent.change(input, { target: { value: "2:00" } });
  fireEvent.blur(input);
  expect(useEditor.getState().doc!.meta.timing).toEqual({ targetSec: 120 });
  fireEvent.change(input, { target: { value: "soon" } });
  fireEvent.blur(input);
  expect(useEditor.getState().doc!.meta.timing).toEqual({ targetSec: 120 });
  expect((input as HTMLInputElement).value).toBe("2:00"); // reverted
});

test("turning Timed deck off leaves a valid, saveable deck", () => {
  render(<DeckSettings />);
  fireEvent.click(screen.getByTestId("timed-toggle"));
  fireEvent.click(screen.getByTestId("timed-toggle"));
  const doc = useEditor.getState().doc!;
  expect(doc.meta.timing).toBeUndefined();
  expect(validateDeckDoc(JSON.parse(JSON.stringify(doc))).ok).toBe(true);
  expect(screen.queryByTestId("target-length")).toBeNull();
});
```

`tests/unit/filmstrip-scene-length.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEditor } from "@/lib/editor/store";
import { Filmstrip } from "@/components/editor/Filmstrip";
import type { DeckDoc } from "@/engine/deck-doc";

const deck = (timed: boolean): DeckDoc => ({ version: 1, meta: { id: "d", title: "D", ...(timed ? { timing: { targetSec: 10 } } : {}) }, scenes: [
  { id: "s1", durationSec: 2, beats: [{ id: "a", timeline: [{ kind: "wait", ms: 3000 }] }] },
  { id: "s2", beats: [{ id: "b", timeline: [{ kind: "wait", ms: 1000 }] }] },
] });
afterEach(cleanup);

test("timed decks show a Length field per scene with content length and overrun", () => {
  useEditor.getState().load(deck(true));
  render(<Filmstrip />);
  const inputs = screen.getAllByTestId("scene-length") as HTMLInputElement[];
  expect(inputs.map((i) => i.value)).toEqual(["2", ""]);
  const content = screen.getAllByTestId("scene-length-content");
  expect(content[0].textContent).toBe("content 3.0s");
  expect(content[0].getAttribute("data-over")).toBe("true");
  expect(content[1].getAttribute("data-over")).toBeNull();
});

test("editing Length pins; clearing it un-pins", () => {
  useEditor.getState().load(deck(true));
  render(<Filmstrip />);
  const second = (screen.getAllByTestId("scene-length") as HTMLInputElement[])[1];
  fireEvent.change(second, { target: { value: "4.5" } });
  fireEvent.blur(second);
  expect(useEditor.getState().doc!.scenes[1].durationSec).toBe(4.5);
  fireEvent.change(second, { target: { value: "" } });
  fireEvent.blur(second);
  expect(useEditor.getState().doc!.scenes[1].durationSec).toBeUndefined();
});

test("untimed decks hide Length unless a scene is already pinned", () => {
  useEditor.getState().load(deck(false));
  render(<Filmstrip />);
  expect(screen.getAllByTestId("scene-length")).toHaveLength(1); // only the pinned s1
});
```

- [ ] **Step 2: Run to verify failures** → FAIL.

- [ ] **Step 3: Implement Deck Settings** — in `components/editor/DeckSettings.tsx` add a `TimingFields` component rendered after the `FIELDS` map:

```tsx
import { useEffect, useMemo, useState } from "react";
import { deckLayout } from "@/engine/authoring/deck-clock";
import { formatClock, parseClock } from "@/lib/timing/clock-format";
import type { DeckDoc } from "@/engine/deck-doc";

function TimingFields({ doc, updateMeta }: { doc: DeckDoc; updateMeta: (path: string, value: unknown) => void }) {
  const target = doc.meta.timing?.targetSec;
  const total = useMemo(() => deckLayout(doc).total, [doc]);
  const [draft, setDraft] = useState(target !== undefined ? formatClock(target, { tenths: false }) : "");
  useEffect(() => { setDraft(target !== undefined ? formatClock(target, { tenths: false }) : ""); }, [target]);
  const commit = () => {
    const v = parseClock(draft);
    if (v === null) { setDraft(target !== undefined ? formatClock(target, { tenths: false }) : ""); return; }
    updateMeta("timing", { targetSec: v });
  };
  return (
    <div style={{ marginTop: 14 }}>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
        <input type="checkbox" data-testid="timed-toggle" checked={target !== undefined}
          onChange={(e) => updateMeta("timing", e.target.checked ? { targetSec: Math.max(1, Math.ceil(total)) } : undefined)} />
        Timed deck (video)
      </label>
      {target !== undefined && (
        <label style={{ display: "block", marginTop: 8, fontSize: 12 }}>
          Target length (m:ss)
          <input data-testid="target-length" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); }} style={{ display: "block", width: 80, marginTop: 4 }} />
        </label>
      )}
    </div>
  );
}
```

Render `<TimingFields doc={doc} updateMeta={updateMeta} />` inside the panel. Check whether `setPath(meta, "timing", undefined)` leaves an own `timing: undefined` key — that's fine for validation (Task 2 test) and JSON drops it on save; the test asserts `toBeUndefined()`.

- [ ] **Step 4: Implement Filmstrip Length** — in `components/editor/Filmstrip.tsx`, add `const setSceneDuration = useEditor((s) => s.setSceneDuration);`, compute `const layout = doc ? deckLayout(doc) : null; const timed = !!doc?.meta.timing;`, and inside the scene header row, after the scene id `<span>`, render `<SceneLength … />` when `timed || doc.scenes[g.sceneIdx].durationSec !== undefined`:

```tsx
function SceneLength({ sceneIdx, value, contentLength, over, onCommit }: { sceneIdx: number; value: number | undefined; contentLength: number; over: boolean; onCommit: (v: number | null) => void }) {
  const [draft, setDraft] = useState(value !== undefined ? String(value) : "");
  useEffect(() => { setDraft(value !== undefined ? String(value) : ""); }, [value]);
  const commit = () => {
    if (draft.trim() === "") { onCommit(null); return; }
    const v = Number(draft);
    if (Number.isFinite(v) && v > 0) onCommit(v); else setDraft(value !== undefined ? String(value) : "");
  };
  return (
    <span className="ed__scene-length">
      <input data-testid="scene-length" data-scene-idx={sceneIdx} inputMode="decimal" placeholder="auto" value={draft} title="Scene length (seconds)"
        onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      <span data-testid="scene-length-content" data-over={over ? "true" : undefined}>content {contentLength.toFixed(1)}s</span>
    </span>
  );
}
```

Props from the layout: `value={doc.scenes[g.sceneIdx].durationSec}`, `contentLength={layout.scenes[g.sceneIdx].contentLength}`, `over={sceneOverrun(layout.scenes[g.sceneIdx]) > 0}`, `onCommit={(v) => setSceneDuration(g.sceneIdx, v)}`. Import `useEffect, useState` from react, `deckLayout, sceneOverrun` from deck-clock. If the header row is too cramped, render `SceneLength` as a second line under the row (a `div` with the same class) — keep the test ids.

CSS (`app/editor/editor.css`):

```css
.ed__scene-length { display: flex; gap: 6px; align-items: center; padding: 0 8px 4px 12px; font-size: 10px; color: var(--ed-fg-muted); }
.ed__scene-length input { width: 44px; font-size: 11px; }
.ed__scene-length [data-over="true"] { color: #e0614f; }
```

- [ ] **Step 5: Run** both new test files plus `tests/unit/filmstrip.test.tsx` → PASS; `npm test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add components/editor/DeckSettings.tsx components/editor/Filmstrip.tsx app/editor/editor.css tests/unit/deck-settings-timing.test.tsx tests/unit/filmstrip-scene-length.test.tsx
git commit -m "feat(editor): timed-deck target length and per-scene Length fields"
```

---

### Task 9: Editor deck-time ruler + Play links

**Files:**
- Create: `components/editor/DeckRuler.tsx`
- Modify: `components/editor/Timeline.tsx` (render `<DeckRuler>` at the top)
- Modify: `app/editor/page.tsx` (top-bar "Play deck" link)
- Modify: `app/editor/editor.css` (timeline row height)
- Test: `tests/unit/deck-ruler.test.tsx`, `e2e/deck-ruler.spec.ts`

**Interfaces:**
- Consumes: `TimeBar` (Task 6); `deckLayout`, `locate`, `deckTimeOf` (Task 3); `formatClock` (Task 3); store `doc`, `selected`, `select(i)`; `CanvasHandle.seek(t)` from `components/editor/DeckCanvas.tsx`.
- Produces: `DeckRuler({ canvasRef, beatT }: { canvasRef: RefObject<CanvasHandle | null>; beatT: number })`. Test ids `deck-ruler` (TimeBar), `ruler-clock`, `play-from-here`, `ruler-hint`, `play-deck` (top bar).

- [ ] **Step 1: Write the failing unit test** — `tests/unit/deck-ruler.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { useEditor } from "@/lib/editor/store";
import { DeckRuler } from "@/components/editor/DeckRuler";
import type { CanvasHandle } from "@/components/editor/DeckCanvas";
import type { DeckDoc } from "@/engine/deck-doc";

const timed = (on: boolean): DeckDoc => ({ version: 1, meta: { id: "d", title: "D", ...(on ? { timing: { targetSec: 12 } } : {}) }, scenes: [
  { id: "opening", durationSec: 4, beats: [{ id: "a", timeline: [{ kind: "wait", ms: 1000 }] }] },
  { id: "middle", durationSec: 6, beats: [{ id: "b", timeline: [{ kind: "wait", ms: 2000 }] }, { id: "c", timeline: [{ kind: "wait", ms: 2000 }] }] },
] });
afterEach(cleanup);

test("untimed decks show a hint, not a ruler", () => {
  useEditor.getState().load(timed(false));
  render(<DeckRuler canvasRef={createRef()} beatT={0} />);
  expect(screen.getByTestId("ruler-hint")).toBeTruthy();
  expect(screen.queryByTestId("deck-ruler")).toBeNull();
});

test("playhead follows the selected beat and its local time", () => {
  useEditor.getState().load(timed(true));
  useEditor.getState().select(2); // beat c starts at 4 + 2 = 6
  render(<DeckRuler canvasRef={createRef()} beatT={0.5} />);
  expect(screen.getByTestId("ruler-clock").textContent).toBe("0:06.5 / 0:12");
  expect(screen.getByTestId("play-from-here").getAttribute("href")).toMatch(/\/play\?deck=d&t=6\.50$/);
});

test("scrubbing selects the beat under T and seeks the canvas to localT", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
  useEditor.getState().load(timed(true));
  const seek = vi.fn();
  const ref = createRef<CanvasHandle>() as { current: CanvasHandle | null };
  ref.current = { seek, play: () => {}, pause: () => {} };
  render(<DeckRuler canvasRef={ref} beatT={0} />);
  const bar = screen.getByTestId("deck-ruler");
  bar.getBoundingClientRect = () => ({ left: 0, width: 120, top: 0, height: 20, right: 120, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
  bar.setPointerCapture = () => {};
  fireEvent.pointerDown(bar, { clientX: 70, pointerId: 1, buttons: 1 }); // T = 7 → beat c (flat 2), localT 1
  act(() => { vi.advanceTimersToNextFrame(); });
  expect(useEditor.getState().selected).toBe(2);
  expect(seek).toHaveBeenLastCalledWith(1);
  vi.useRealTimers();
});
```

If `vi.advanceTimersToNextFrame` is unavailable in this Vitest version, use `vi.runAllTimers()` with the same `toFake` set.

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement `components/editor/DeckRuler.tsx`**

```tsx
"use client";
import type { RefObject } from "react";
import Link from "next/link";
import { useMemo } from "react";
import { useEditor } from "@/lib/editor/store";
import { deckLayout, deckTimeOf, locate } from "@/engine/authoring/deck-clock";
import { formatClock } from "@/lib/timing/clock-format";
import { TimeBar } from "@/components/timing/TimeBar";
import type { CanvasHandle } from "./DeckCanvas";

/** Deck-time ruler above the per-beat timeline (timed decks). Scrubbing selects the beat under
 *  T and seeks the editor canvas to its local time. Whole-deck continuous playback is the
 *  Player's job (/play) — the editor canvas uses the simpler seek.ts renderer. */
export function DeckRuler({ canvasRef, beatT }: { canvasRef: RefObject<CanvasHandle | null>; beatT: number }) {
  const doc = useEditor((s) => s.doc);
  const selected = useEditor((s) => s.selected);
  const select = useEditor((s) => s.select);
  const layout = useMemo(() => (doc ? deckLayout(doc) : null), [doc]);
  if (!doc || !layout) return null;
  const target = doc.meta.timing?.targetSec;
  if (target === undefined) {
    return <div className="ed__ruler-hint" data-testid="ruler-hint">Turn on “Timed deck” in Deck settings to time this deck.</div>;
  }
  const T = deckTimeOf(layout, selected, beatT);
  const onScrub = (to: number) => {
    const l = locate(layout, to);
    if (!l || l.flatIdx == null) return; // empty scene: nothing to select
    if (l.flatIdx !== selected) select(l.flatIdx);
    // DeckCanvas resets its time to 0 when the selected beat changes (its [flat] effect); seek
    // on the next frame so this seek lands after that reset.
    const localT = l.localT;
    requestAnimationFrame(() => canvasRef.current?.seek(localT));
  };
  return (
    <div className="ed__ruler">
      <span className="ed__ruler-clock" data-testid="ruler-clock">{formatClock(T)} / {formatClock(target, { tenths: false })}</span>
      <div className="ed__ruler-bar">
        <TimeBar layout={layout} sceneIds={doc.scenes.map((s) => s.id)} value={T} targetSec={target} onScrub={onScrub} testId="deck-ruler" />
      </div>
      <Link className="ed__pill ed__pill--ghost" data-testid="play-from-here" href={`/play?deck=${doc.meta.id}&t=${T.toFixed(2)}`} target="_blank">▶ Play from here</Link>
    </div>
  );
}
```

Note: Next `<Link>` adds the base path itself. The test asserts the `href` ends with `/play?deck=d&t=6.50` (with any base-path prefix allowed by the regex).

- [ ] **Step 4: Wire it in** — `components/editor/Timeline.tsx`: import `DeckRuler` and render `<DeckRuler canvasRef={canvasRef} beatT={time.t} />` as the first child inside `ed__timeline`. `app/editor/page.tsx`: import `Link from "next/link"` and add after the `lint-toggle` button:

```tsx
        {doc && <Link className="ed__pill ed__pill--ghost" data-testid="play-deck" href={`/play?deck=${doc.meta.id}`} target="_blank">▶ Play deck</Link>}
```

`app/editor/editor.css` — make room for the ruler: change `grid-template-rows: 48px 1fr 180px;` to `grid-template-rows: 48px 1fr 216px;` and add:

```css
.ed__ruler { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; margin-bottom: 8px; }
.ed__ruler-clock { font-family: var(--ed-mono); font-size: 12px; color: var(--ed-fg-muted); }
.ed__ruler-hint { font-size: 11px; color: var(--ed-fg-muted); margin-bottom: 6px; }
```

- [ ] **Step 5: Run unit tests** — `npx vitest run tests/unit/deck-ruler.test.tsx tests/unit/base-path-callsites.test.ts` → PASS; `npm test` → all pass.

- [ ] **Step 6: e2e** — `e2e/deck-ruler.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

const id = "e2e-deck-ruler";
const doc = { version: 1, meta: { id, title: "Ruler", timing: { targetSec: 12 } }, scenes: [
  { id: "opening", durationSec: 4, beats: [{ id: "a", timeline: [{ kind: "text", value: "Opening line", in: "fade" }, { kind: "wait", ms: 1000 }] }] },
  { id: "middle", durationSec: 6, beats: [{ id: "b", timeline: [{ kind: "text", value: "Second scene", in: "fade" }, { kind: "wait", ms: 2000 }] }] },
] };

test("clicking the deck ruler selects the beat at that time and shows it", async ({ page, request }) => {
  await request.delete(`/api/decks/${id}`).catch(() => {});
  await request.post("/api/decks", { data: { id, title: "Ruler" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const bar = page.getByTestId("deck-ruler");
  const box = (await bar.boundingBox())!;
  await page.mouse.click(box.x + box.width * (6 / 12), box.y + box.height / 2); // T = 6 → middle, localT 2
  await expect(page.getByTestId("canvas-text")).toContainText("Second scene");
  await expect(page.getByTestId("ruler-clock")).toHaveText("0:06.0 / 0:12");
  await expect(page.getByTestId("play-deck")).toHaveAttribute("href", new RegExp(`/play\\?deck=${id}$`));

  await request.delete(`/api/decks/${id}`);
});
```

- [ ] **Step 7: Run** `npm run test:e2e -- e2e/deck-ruler.spec.ts --project=default` → PASS. Then the **full** e2e suite once: `npm run test:e2e` → all pass (the timeline row height change can shift layouts other specs click on — fix any regression).

- [ ] **Step 8: Commit**

```bash
git add components/editor/DeckRuler.tsx components/editor/Timeline.tsx app/editor/page.tsx app/editor/editor.css tests/unit/deck-ruler.test.tsx e2e/deck-ruler.spec.ts
git commit -m "feat(editor): deck-time ruler, Play deck and Play-from-here links"
```

---

## Self-review notes (plan author)

- Spec coverage: §2 data model → T2; §3 deck clock → T3; §4 player incl. autoplay/entryNight → T1+T7; HUD/TimeBar → T6+T7; §5 Deck Settings/Length → T8, ruler/Play links → T9; §6 lint → T4; §7 MCP → T5; §8 testing spread across tasks; §1 benchmark gate → T1.
- Deviations from spec, already reflected in the spec: `scene-overrun` is a warning; `locate` returns `null` for an empty deck; `entryNight` replaces `initialNight`.
- Deep-dive (`docs/MM_MORGANA.md`) is synced at closeout via `mm-deepdive-sync`, not inside a task.
