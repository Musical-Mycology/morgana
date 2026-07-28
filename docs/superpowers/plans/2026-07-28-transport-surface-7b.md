# §7b Seekable Transport Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Morgana's cinematic runtime a real transport (`seek`/`play`/`pause`/`duration`) so a beat's visual state becomes a function of time, replacing the callback-scheduler-plus-time-spacers design that makes `master.seek(t)` a no-op today.

**Architecture:** Extend §7a's "one renderer, two clocks" shape from note particles to the rest of the runtime. A pure `beat-clock.ts` owns the canonical time axis; `CinematicSlide` gains `renderAt(t)` that folds the beat's timeline to its state at `t`, building each action's *real* effect timeline paused and setting `.time(t - start)`; playback drives `t` from a ticker and the editor drives it from a scrub position. Sibling stages (`ArtStage`, `NoteField`, `ObjectStage`) are driven from that same `t`.

**Tech Stack:** TypeScript, React 19, Next.js 15, GSAP (+ `@gsap/react`, SplitText), Vitest (jsdom), Playwright.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-28-transport-surface-7b-design.md`. Decisions D1–D3 in spec §2 are locked; do not relitigate them mid-implementation.
- **Gates, every task:** `npm test` and `npx tsc --noEmit` must both be green before committing.
- **e2e:** run only as `npm run test:e2e`. Never a bare `npx playwright test` (it assumes a prepared build), and never add `--workers=1`. See `docs/MM_MORGANA.md`, "the e2e build step must not move into a Playwright globalSetup".
- **`beat-clock.ts` must never import a module that touches the DOM.** Task 1 adds a test that enforces this; do not weaken it to make later work pass.
- **`beatTimeline()` is the canonical clock (D2).** Never derive a duration by reading a built GSAP timeline.
- **Out of scope (these belong to §7c):** swapping `DeckCanvas` onto `CinematicSlide`, the parity gate, deleting `seek.ts`. Do not start them here.
- **Commit style:** conventional commits, matching repo history (`feat(transport):`, `refactor(transport):`, `test(transport):`).
- **Behaviour changes to call out in every PR description:** counter and media become scrubbable rather than wall-clock; `rotateList` becomes derived rather than tween-driven.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `engine/authoring/beat-clock.ts` | **Create.** Pure time axis: `INTRO_DUR`, `DOTFADE_TAIL`, `introDuration`, `actionDuration`, `isSeekable`, `Window`, `beatTimeline`, `beatDuration`, plus the new `foldAt` and `rebuildBoundary`. No DOM, no GSAP, no React. |
| `engine/authoring/seek.ts` | **Shrink.** Keeps only `SeekCtx`, `renderBeatAt`, `applyAt`; re-imports its time math from `beat-clock.ts`. Deleted in §7c. |
| `engine/components/layouts/CinematicSlide.tsx` | **Restructure.** Gains `renderAt(t)` + `SlideTransport`; loses its duplicate `introDuration`, its `segments`/`playSegment` machinery, and its `loopers` ref. |
| `engine/authoring/BeatStage.tsx` | **Modify.** Holds the transport, drives all three stages from one `t`; loses the proxy timeline and its KNOWN LIMITATION comment. |
| `app/dev/beatstage/page.tsx` | **Modify.** Gains transport controls and a gate-bearing fixture beat so e2e can drive scrubbing. |
| `tests/unit/beat-clock.test.ts` | **Create.** Time-axis unit tests (moved from `seek.test.ts`) plus `foldAt`/`rebuildBoundary`. |
| `tests/unit/pure-import-graph.test.ts` | **Create.** Asserts the pure reducers' runtime import graphs are DOM-free. |
| `tests/unit/slide-render-at.test.tsx` | **Create.** Seek symmetry and fold determinism. |
| `e2e/transport.spec.ts` | **Create.** Gate-sync regression + playback-still-gates. |

---

## Task 1: Extract the pure clock

Moves the time axis out of the DOM-touching `seek.ts` and enforces that it stays out. This is a pure move — no behaviour change anywhere.

**Files:**
- Create: `engine/authoring/beat-clock.ts`
- Create: `tests/unit/pure-import-graph.test.ts`
- Create: `tests/unit/beat-clock.test.ts`
- Modify: `engine/authoring/seek.ts` (delete lines 1–70's time math, import it instead)
- Modify: `engine/components/layouts/CinematicSlide.tsx:19-46` (delete the duplicated `INTRO_DUR`/`DOTFADE_TAIL`/`introDuration`)
- Modify: `engine/components/effects/note-state.ts:8`, `lib/editor/object-state.ts:3`, `engine/authoring/BeatStage.tsx:11`, `components/editor/Timeline.tsx:5`
- Modify: `tests/unit/seek.test.ts`, `tests/unit/action-duration-obj.test.ts`, `tests/unit/registry-notes.test.ts`, `tests/unit/note-parity.test.tsx`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `engine/authoring/beat-clock.ts` exporting `introDuration(a: { in: TextIn; value: string; dots?: true; speed?: number }): number`, `actionDuration(a: Action): number`, `isSeekable(a: Action): boolean`, `interface Window { action: Action; start: number; end: number }`, `beatTimeline(timeline: Action[]): Window[]`, `beatDuration(timeline: Action[]): number`.

- [ ] **Step 1: Write the failing purity test**

Create `tests/unit/pure-import-graph.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, test } from "vitest";

const ROOT = resolve(__dirname, "../..");
const DOM_TOKENS = /\bdocument\.|\.innerHTML\b|createElement\(/;

/** Resolve one import specifier to a repo file, or null for bare package imports. */
function resolveImport(spec: string, fromFile: string): string | null {
  const base = spec.startsWith("@/")
    ? resolve(ROOT, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(fromFile), spec)
      : null;
  if (!base) return null;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (existsSync(base + ext)) return base + ext;
  }
  return existsSync(base) ? base : null;
}

/** Every repo file reachable from `entry` by a RUNTIME import (`import type` is erased). */
function runtimeGraph(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const src = readFileSync(entry, "utf8");
  for (const m of src.matchAll(/^\s*import\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/gm)) {
    if (/^\s*import\s+type\s/.test(m[0])) continue; // type-only: no runtime edge
    const next = resolveImport(m[1], entry);
    if (next) runtimeGraph(next, seen);
  }
  return seen;
}

// The pure cores. Their contract is "no DOM" — and nothing in CI can see a violation
// except this test (see docs/MM_MORGANA.md, note-state purity import rule).
test.each([
  "engine/components/effects/note-state.ts",
  "lib/editor/object-state.ts",
])("%s has a DOM-free runtime import graph", (rel) => {
  const offenders = [...runtimeGraph(resolve(ROOT, rel))]
    .filter((f) => DOM_TOKENS.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(ROOT + "/", ""));
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/pure-import-graph.test.ts`
Expected: FAIL — both cases report `engine/authoring/seek.ts` as an offender, because it calls `document.createElement`.

- [ ] **Step 3: Create `engine/authoring/beat-clock.ts`**

Move, verbatim, from `engine/authoring/seek.ts` lines 1–70: the `INTRO_DUR` table, `DOTFADE_TAIL`, `introDuration`, `actionDuration`, `isSeekable`, `interface Window`, `beatTimeline`, `beatDuration`. Header:

```ts
/** The canonical beat time axis. Pure: no DOM, no GSAP, no React — the pure reducers
 *  (note-state.ts, object-state.ts) import this, and a test in
 *  tests/unit/pure-import-graph.test.ts enforces that it stays that way.
 *
 *  This is the single source of truth for when anything happens in a beat
 *  (design spec §7b D2). Never derive a duration by reading a built GSAP timeline. */
import type { Action, TextIn } from "@/engine/deck/types";
```

The only edit to the moved code is dropping `seek.ts`'s now-unused `ArtStageHandle` import.

- [ ] **Step 4: Shrink `seek.ts` to the renderer**

Replace its deleted time math with a re-import, keeping `SeekCtx`, `renderBeatAt`, `applyAt` unchanged:

```ts
import type { Action } from "@/engine/deck/types";
import type { ArtStageHandle } from "@/engine/components/ArtStage";
import { beatTimeline } from "@/engine/authoring/beat-clock";
```

Do **not** re-export the clock from `seek.ts` — importers must point at `beat-clock.ts` directly, or §7c's deletion breaks them.

- [ ] **Step 5: Repoint every clock importer**

| File | Change |
| --- | --- |
| `engine/components/effects/note-state.ts:8` | `from "@/engine/authoring/seek"` → `from "@/engine/authoring/beat-clock"` |
| `lib/editor/object-state.ts:3` | same |
| `engine/authoring/BeatStage.tsx:11` | same |
| `components/editor/Timeline.tsx:5` | same |
| `tests/unit/action-duration-obj.test.ts:3`, `tests/unit/registry-notes.test.ts:3`, `tests/unit/note-parity.test.tsx:7` | same |

Leave `components/editor/DeckCanvas.tsx`, `components/library/BeatThumbnail.tsx`, and `app/spike/page.tsx` importing `renderBeatAt`/`beatDuration` — `beatDuration` moves, `renderBeatAt` does not, so those files import from **both** modules until §7c.

- [ ] **Step 6: Delete CinematicSlide's duplicate clock**

Delete `engine/components/layouts/CinematicSlide.tsx:19-46` (`INTRO_DUR`, `DOTFADE_TAIL`, `introDuration`) and add to its imports:

```ts
import { introDuration } from "@/engine/authoring/beat-clock";
```

This is the duplication `docs/MM_MORGANA.md` flags. Its call site at line 471 needs no change.

- [ ] **Step 7: Split the clock tests out**

Create `tests/unit/beat-clock.test.ts` and move into it, unchanged, the first three tests from `tests/unit/seek.test.ts` (`actionDuration mirrors...`, `seekability...`, `beatTimeline assigns...`), repointing the import to `@/engine/authoring/beat-clock`. Leave the fourth test (`a text action with pos renders...`) in `seek.test.ts`, which now imports only `renderBeatAt`.

- [ ] **Step 8: Run the gates**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — including `pure-import-graph.test.ts`, which now finds no offenders.

- [ ] **Step 9: Commit**

```bash
git add engine/authoring/beat-clock.ts engine/authoring/seek.ts engine/components/layouts/CinematicSlide.tsx engine/components/effects/note-state.ts lib/editor/object-state.ts engine/authoring/BeatStage.tsx components/editor/Timeline.tsx tests/unit/
git commit -m "refactor(transport): extract the pure beat clock from seek.ts"
```

---

## Task 2: `foldAt` and `rebuildBoundary`

The pure core of `renderAt(t)`: given a timeline and a time, which actions are settled, which one is in flight, and where must a backward seek rebuild from. No DOM, so it is cheap to test exhaustively.

**Files:**
- Modify: `engine/authoring/beat-clock.ts`
- Modify: `tests/unit/beat-clock.test.ts`

**Interfaces:**
- Consumes: `beatTimeline` from Task 1.
- Produces: `type FoldPhase = "settled" | "in-flight"`; `interface FoldEntry { index: number; action: Action; start: number; phase: FoldPhase; p: number }`; `foldAt(timeline: Action[], t: number): FoldEntry[]`; `rebuildBoundary(timeline: Action[], t: number): number`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/beat-clock.test.ts`:

```ts
import { foldAt, rebuildBoundary } from "@/engine/authoring/beat-clock";

const TL: Action[] = [
  { kind: "text", value: "a", in: "fade" },   // dur 0.8 → [0, 0.8)
  { kind: "wait", ms: 200 },                  // dur 0.2 → [0.8, 1.0)
  { kind: "clear" },                          // dur 0   → at 1.0
  { kind: "text", value: "b", in: "fade" },   // dur 0.8 → [1.0, 1.8)
];

test("foldAt reports at most one in-flight action, and never one not yet reached", () => {
  const fold = foldAt(TL, 0.4);
  expect(fold.map((f) => f.index)).toEqual([0]);
  expect(fold[0].phase).toBe("in-flight");
  expect(fold[0].p).toBeCloseTo(0.5, 2);
});

test("foldAt settles everything at or past the end", () => {
  const fold = foldAt(TL, 99);
  expect(fold.map((f) => f.index)).toEqual([0, 1, 2, 3]);
  expect(fold.every((f) => f.phase === "settled" && f.p === 1)).toBe(true);
});

test("foldAt treats a zero-duration action as settled the instant it is reached", () => {
  const fold = foldAt(TL, 1.0);
  expect(fold.find((f) => f.index === 2)!.phase).toBe("settled");
});

test("rebuildBoundary finds the last destructive action at or before t", () => {
  expect(rebuildBoundary(TL, 0.5)).toBe(-1);  // nothing destructive yet
  expect(rebuildBoundary(TL, 1.4)).toBe(2);   // the clear at 1.0
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/beat-clock.test.ts`
Expected: FAIL — `foldAt is not a function`.

- [ ] **Step 3: Implement both in `beat-clock.ts`**

```ts
export type FoldPhase = "settled" | "in-flight";

/** One reached action's state at time t. `p` is local progress 0–1. */
export interface FoldEntry {
  index: number;
  action: Action;
  start: number;
  phase: FoldPhase;
  p: number;
}

/** Every action reached by time `t`, with its local progress. At most one entry is
 *  "in-flight", because beatTimeline lays actions out sequentially. */
export function foldAt(timeline: Action[], t: number): FoldEntry[] {
  const out: FoldEntry[] = [];
  const windows = beatTimeline(timeline);
  for (let index = 0; index < windows.length; index++) {
    const { action, start, end } = windows[index];
    if (start > t) break;                       // not reached yet (strictly after t)
    const dur = end - start;
    const p = dur <= 0 ? 1 : Math.min(1, (t - start) / dur);
    out.push({ index, action, start, phase: p >= 1 ? "settled" : "in-flight", p });
  }
  return out;
}

/** Actions that DELETE nodes. Seeking backwards past one cannot be undone by
 *  rewinding a tween, so it forces a rebuild (design spec §7b §4.3). */
const DESTRUCTIVE = new Set<Action["kind"]>(["clear", "fade_out"]);

/** Index of the last destructive action at or before `t`; -1 if there is none.
 *  A rebuild may start here rather than at 0 — a clear wipes all prior text state
 *  by definition, so nothing before it is observable. */
export function rebuildBoundary(timeline: Action[], t: number): number {
  let idx = -1;
  const windows = beatTimeline(timeline);
  for (let index = 0; index < windows.length; index++) {
    const { action, start } = windows[index];
    if (start > t) break;
    if (DESTRUCTIVE.has(action.kind)) idx = index;
  }
  return idx;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/beat-clock.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/authoring/beat-clock.ts tests/unit/beat-clock.test.ts
git commit -m "feat(transport): foldAt and rebuildBoundary, the pure core of renderAt"
```

---

## Task 3: `renderAt(t)` for text

The first half of the restructure. Text only — every other kind keeps its current scheduled path, so the suite stays green throughout.

**Files:**
- Modify: `engine/components/layouts/CinematicSlide.tsx`
- Create: `tests/unit/slide-render-at.test.tsx`

**Interfaces:**
- Consumes: `foldAt`, `FoldEntry`, `rebuildBoundary` (Task 2).
- Produces: an internal `renderAt(t: number): void` closure inside `CinematicSlide`, plus a `built` cache of type `Map<number, { el: HTMLElement; tl: gsap.core.Timeline | null }>` keyed by action index. Task 4 adds the rebuild path; Task 9 exposes the transport.

- [ ] **Step 1: Write the failing seek-symmetry test**

Create `tests/unit/slide-render-at.test.tsx`. This is §7b's load-bearing property (spec §7.1).

```tsx
import { expect, test } from "vitest";
import { render } from "@testing-library/react";
import { CinematicSlide } from "@/engine/components/layouts/CinematicSlide";
import type { Action, Beat } from "@/engine/deck/types";

const noopRuntime = {
  art: () => {}, applyArt: () => {}, setNightlight: () => {}, onGate: () => {},
  revealArrows: () => {}, pulseArrow: () => {}, onWaiting: () => {},
  resolveEntry: () => [], resolveEnd: () => [], jumpTo: () => {},
};

const timeline: Action[] = [
  { kind: "text", value: "first", in: "fade" },
  { kind: "text", value: "second", in: "fade" },
];
const beat: Beat = { id: "b", timeline };

/** Mount and return a handle that exposes renderAt via the transport ref (Task 9)
 *  — until then, via the test-only `__renderAt` escape hatch on the DOM node. */
function mountSlide() {
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat }} animate runtime={noopRuntime} />,
  );
  const host = container.querySelector<HTMLElement & { __renderAt?: (t: number) => void }>(".cin")!;
  return { host, renderAt: (t: number) => host.__renderAt!(t) };
}

const textAt = (host: HTMLElement) =>
  [...host.querySelectorAll("p.cin__line")].map((p) => p.textContent);

test("renderAt is deterministic: the same t twice yields the same DOM", () => {
  const { host, renderAt } = mountSlide();
  renderAt(1.0);
  const once = host.innerHTML;
  renderAt(1.0);
  expect(host.innerHTML).toBe(once);
});

test("SEEK SYMMETRY: forward play, backward seek, and direct jump agree at the same t", () => {
  const target = 1.0;

  const fwd = mountSlide();
  for (const t of [0, 0.25, 0.5, 0.75, target]) fwd.renderAt(t);

  const back = mountSlide();
  back.renderAt(1.8);
  back.renderAt(target);

  const jump = mountSlide();
  jump.renderAt(target);

  expect(textAt(back.host)).toEqual(textAt(fwd.host));
  expect(textAt(jump.host)).toEqual(textAt(fwd.host));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/slide-render-at.test.tsx`
Expected: FAIL — `host.__renderAt is not a function`.

- [ ] **Step 3: Add the cache and `renderAt` for text**

Inside `CinematicSlide`, alongside the existing refs:

```ts
// Built, PAUSED effect timelines keyed by action index. Nothing here ever runs on
// wall-clock — renderAt is the only thing that advances them (design spec §7b §4.2).
const built = useRef<Map<number, { el: HTMLElement; tl: gsap.core.Timeline | null }>>(new Map());
const lastT = useRef(0);
```

Add a `buildText` helper that reuses the existing effect-builder switch from `scheduleAction`'s
`text` case, but returns the timeline **paused** instead of letting it play:

```ts
/** Build one text action's element + its real reveal timeline, paused at 0. */
function buildText(a: Extract<Action, { kind: "text" }>, host: HTMLElement) {
  const perPiece: TextIn[] = ["letterFly", "letterUp", "wordUp", "blurIn", "typewriter", "cursive"];
  const effIn: TextIn = hasInlineMarkup(a.value) && perPiece.includes(a.in) ? "fade" : a.in;
  const el = a.append
    ? appendFragment(a.value)
    : appendText(a.pos ? makeLineBox(a.pos, a.align) : host, a.value, a.size, a.align, a.dots, false, a.tone);
  if (a.in === "cursive") el.classList.add("cin__line--cursive");
  // instantText / no-reveal lines have no entrance: they render at rest.
  if (instantText && !a.reveal) return { el, tl: null };
  const dir = a.align === "right" ? "right" : "left";
  const tl =
    effIn === "flyUp" ? flyUp(el, a.speed) :
    effIn === "fadeSide" ? fadeSide(el, a.speed) :
    effIn === "cursive" ? typewriter(el, a.speed ?? 0.2) :
    effIn === "letterFly" ? letterFly(el, dir, a.speed) :
    effIn === "letterUp" ? letterUp(el, a.speed) :
    effIn === "wordUp" ? wordUp(el, a.speed, !a.append) :
    effIn === "blurIn" ? blurIn(el, a.speed) :
    effIn === "typewriter" ? typewriter(el, a.speed) : fadeIn(el, a.speed);
  if (a.dots) { const d = el.querySelector<HTMLElement>(".dots"); if (d) tl.add(dotFade(d)); }
  tl.pause(0);
  return { el, tl };
}
```

Then `renderAt`:

```ts
/** Paint the beat's visual state at beat-local time `t`. */
function renderAt(t: number) {
  const host = scope.current?.querySelector<HTMLElement>(".cin__text");
  if (!host) return;
  for (const f of foldAt(slots.beat.timeline, t)) {
    if (f.action.kind !== "text") continue;               // other kinds: Tasks 5-8
    let entry = built.current.get(f.index);
    if (!entry) { entry = buildText(f.action, host); built.current.set(f.index, entry); }
    if (!entry.tl) continue;                              // rendered at rest
    entry.tl.time(f.phase === "settled" ? entry.tl.duration() : t - f.start);
  }
  lastT.current = t;
}
```

- [ ] **Step 4: Expose the test escape hatch**

Until Task 9 adds the real transport, let the test reach `renderAt`. In the same `useGSAP` body, after defining `renderAt`:

```ts
// Test-only handle; Task 9 replaces this with the SlideTransport ref.
(host.closest(".cin") as HTMLElement & { __renderAt?: (t: number) => void }).__renderAt = renderAt;
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/unit/slide-render-at.test.tsx && npx tsc --noEmit`
Expected: PASS — determinism passes because building is idempotent per index; symmetry passes because this timeline has no destructive action (Task 4 handles that case).

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS — playback is untouched; `renderAt` has no caller yet outside the test.

- [ ] **Step 7: Commit**

```bash
git add engine/components/layouts/CinematicSlide.tsx tests/unit/slide-render-at.test.tsx
git commit -m "feat(transport): renderAt(t) folds a beat's text to its state at t"
```

---

## Task 4: Backward seek across destructive actions

`clear` and `fade_out` delete nodes. Seeking back past one must rebuild.

**Files:**
- Modify: `engine/components/layouts/CinematicSlide.tsx`
- Modify: `tests/unit/slide-render-at.test.tsx`

**Interfaces:**
- Consumes: `rebuildBoundary` (Task 2), `built`/`renderAt` (Task 3).
- Produces: `resetFrom(index: number): void` — tears down cached entries with index ≥ `index`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/slide-render-at.test.tsx`:

```tsx
const clearing: Action[] = [
  { kind: "text", value: "before", in: "fade" },   // [0, 0.8)
  { kind: "clear" },                                // at 0.8
  { kind: "text", value: "after", in: "fade" },    // [0.8, 1.6)
];

test("SEEK SYMMETRY across a clear: seeking back re-shows the cleared line", () => {
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "c", timeline: clearing } }} animate runtime={noopRuntime} />,
  );
  const host = container.querySelector<HTMLElement & { __renderAt?: (t: number) => void }>(".cin")!;
  const renderAt = (t: number) => host.__renderAt!(t);

  renderAt(0.4);
  expect(textAt(host)).toEqual(["before"]);

  renderAt(1.2);                       // past the clear
  expect(textAt(host)).toEqual(["after"]);

  renderAt(0.4);                       // BACK past the clear — must rebuild
  expect(textAt(host)).toEqual(["before"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/slide-render-at.test.tsx -t "across a clear"`
Expected: FAIL — the final assertion sees `["after"]` (or both lines); nothing rebuilds.

- [ ] **Step 3: Implement teardown + rebuild**

Add to `CinematicSlide`:

```ts
/** Drop every cached entry from `index` onward, removing its DOM. A rebuild then
 *  re-runs those actions from scratch on the next renderAt. */
function resetFrom(index: number) {
  for (const [i, entry] of built.current) {
    if (i < index) continue;
    entry.tl?.kill();
    entry.el.remove();
    built.current.delete(i);
  }
}
```

And handle the destructive kinds plus the backward case in `renderAt`, replacing its body's opening:

```ts
function renderAt(t: number) {
  const host = scope.current?.querySelector<HTMLElement>(".cin__text");
  if (!host) return;
  // Backward seek: rebuild from the last destructive boundary at or before t.
  // Everything before that boundary was wiped by a clear anyway, so it is unobservable.
  if (t < lastT.current) {
    const boundary = rebuildBoundary(slots.beat.timeline, t);
    resetFrom(boundary + 1);
    if (boundary < 0) { host.innerHTML = ""; clearLineBoxes(); }
  }
  for (const f of foldAt(slots.beat.timeline, t)) {
    if (f.action.kind === "clear") {
      // Settled clear: drop everything built before it.
      resetFrom(0);
      host.innerHTML = "";
      clearLineBoxes();
      continue;
    }
    if (f.action.kind !== "text") continue;
    // ...unchanged from Task 3
  }
  lastT.current = t;
}
```

> **Ordering note:** `resetFrom(0)` inside the `clear` branch runs while iterating the fold, but it
> only mutates `built`, not the fold array — the fold was computed up front. Actions *after* the
> clear rebuild on the same pass, because the loop continues past it.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/slide-render-at.test.tsx && npx tsc --noEmit`
Expected: PASS, all four tests.

- [ ] **Step 5: Commit**

```bash
git add engine/components/layouts/CinematicSlide.tsx tests/unit/slide-render-at.test.tsx
git commit -m "feat(transport): rebuild on backward seek across clear/fade_out"
```

---

## Task 5: Scrubbable counters

**Behaviour change** — counters animate on wall-clock today.

**Files:**
- Modify: `engine/components/layouts/CinematicSlide.tsx:295-350`
- Create: `tests/unit/counter-at.test.ts`

**Interfaces:**
- Consumes: `foldAt` (Task 2), `renderAt`/`built` (Tasks 3–4).
- Produces: `counterValueAt(from: number, to: number, p: number): number` exported from `engine/deck/counter.ts` for direct unit testing.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/counter-at.test.ts`:

```ts
import { expect, test } from "vitest";
import { counterValueAt } from "@/engine/deck/counter";

test("counterValueAt eases from `from` to `to` across local progress", () => {
  expect(counterValueAt(0, 100, 0)).toBeCloseTo(0);
  expect(counterValueAt(0, 100, 1)).toBeCloseTo(100);
  // power2.out: fast start, so the midpoint is past halfway.
  expect(counterValueAt(0, 100, 0.5)).toBeGreaterThan(50);
});

test("counterValueAt is exact at the endpoints regardless of easing", () => {
  expect(counterValueAt(42, 42, 0.37)).toBeCloseTo(42);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/counter-at.test.ts`
Expected: FAIL — `counterValueAt` is not exported.

- [ ] **Step 3: Add the pure easing helper**

Append to `engine/deck/counter.ts`:

```ts
/** GSAP "power2.out" (cubic out) — the ease tweenCounter uses. */
const powerOut2 = (p: number): number => 1 - Math.pow(1 - p, 3);

/** A counter's displayed value at local progress `p` (0–1). Pure: this is what makes
 *  a counter scrubbable rather than wall-clock-animated (design spec §7b §5). */
export function counterValueAt(from: number, to: number, p: number): number {
  const c = p < 0 ? 0 : p > 1 ? 1 : p;
  return from + (to - from) * powerOut2(c);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/counter-at.test.ts`
Expected: PASS.

- [ ] **Step 5: Drive counters from `renderAt`**

In `renderAt`'s fold loop, add cases before the `text` case. Track the running value across the fold, because `counter_add` is relative:

```ts
// Counter state is a fold over the reached actions — the same shape staticMode uses.
let counter: { a: Extract<Action, { kind: "counter_show" }>; from: number; to: number } | null = null;
for (const f of foldAt(slots.beat.timeline, t)) {
  if (f.action.kind === "counter_show") { counter = { a: f.action, from: f.action.value ?? 0, to: f.action.value ?? 0 }; continue; }
  if (f.action.kind === "counter_to")  { if (counter) counter = { ...counter, from: counter.to, to: f.action.value }; continue; }
  if (f.action.kind === "counter_add") { if (counter) counter = { ...counter, from: counter.to, to: counter.to + f.action.delta }; continue; }
  if (f.action.kind === "counter_hide") { counter = null; continue; }
  // ...text, clear as before
}
// After the loop, paint the counter at the in-flight action's progress.
```

Replace `showCounter`'s `gsap.from(box, ...)` entrance and `tweenCounter`'s `gsap.to(proxy, ...)`
with direct writes driven by `counterValueAt(from, to, p)`, and delete `tweenCounter`'s proxy
tween entirely. `hideCounter` becomes an opacity write at `1 - p` rather than a tween.

- [ ] **Step 6: Run the gates**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add engine/deck/counter.ts engine/components/layouts/CinematicSlide.tsx tests/unit/counter-at.test.ts
git commit -m "feat(transport): counters render at t instead of animating on wall-clock"
```

---

## Task 6: Scrubbable media

**Behaviour change**, same shape as Task 5. `media`, `media_move`, `media_out` fire wall-clock tweens today.

**Files:**
- Modify: `engine/components/layouts/CinematicSlide.tsx:352-428`
- Create: `tests/unit/media-at.test.ts`

**Interfaces:**
- Consumes: `foldAt`, `renderAt`.
- Produces: `mediaStateAt(entries: MediaFold[], t: number): Map<string, MediaRenderState>` in a new pure module `engine/deck/media-state.ts`, where `interface MediaRenderState { x: number; y: number; scale: number; opacity: number }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/media-at.test.ts`:

```ts
import { expect, test } from "vitest";
import { mediaStateAt } from "@/engine/deck/media-state";
import type { Action } from "@/engine/deck/types";

const show: Extract<Action, { kind: "media" }> = { kind: "media", id: "m", pos: { x: 0.2, y: 0.3 } };
const move: Extract<Action, { kind: "media_move" }> = { kind: "media_move", id: "m", to: { x: 0.8, y: 0.3 }, durationMs: 1000 };

test("a shown tile fades in over its duration", () => {
  expect(mediaStateAt([{ action: show, p: 0 }], 0).get("m")!.opacity).toBeCloseTo(0);
  expect(mediaStateAt([{ action: show, p: 1 }], 0).get("m")!.opacity).toBeCloseTo(1);
});

test("media_move interpolates position at local progress", () => {
  const s = mediaStateAt([{ action: show, p: 1 }, { action: move, p: 0.5 }], 0).get("m")!;
  expect(s.x).toBeGreaterThan(0.2);
  expect(s.x).toBeLessThan(0.8);
});

// moveMedia uses ease "power3.inOut", which is SYMMETRIC — exactly half-way at p=0.5.
// An ease-out curve would put the midpoint well past halfway, so this pins the shape,
// not just the endpoints, and would catch the power2/power3 off-by-one in GSAP's naming.
test("media_move's ease is symmetric in-out, matching playback", () => {
  const s = mediaStateAt([{ action: show, p: 1 }, { action: move, p: 0.5 }], 0).get("m")!;
  expect(s.x).toBeCloseTo(0.5, 4);
});

test("media_out drives opacity to zero", () => {
  const out: Extract<Action, { kind: "media_out" }> = { kind: "media_out", id: "m" };
  expect(mediaStateAt([{ action: show, p: 1 }, { action: out, p: 1 }], 0).get("m")!.opacity).toBeCloseTo(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/media-at.test.ts`
Expected: FAIL — module `engine/deck/media-state.ts` does not exist.

- [ ] **Step 3: Create the pure media reducer**

Create `engine/deck/media-state.ts`. Keep it pure (no DOM) so it can be unit-tested and, later, shared with §7c's parity gate:

```ts
import type { Action } from "@/engine/deck/types";

export interface MediaRenderState { x: number; y: number; scale: number; opacity: number }
export interface MediaFold { action: Action; p: number }

// GSAP's power names are one ahead of their exponent: power1 = quad (^2),
// power2 = cubic (^3), power3 = quart (^4). engine/components/effects/note-state.ts's
// powerOut1 being quadratic is the in-repo confirmation. Getting this wrong makes a
// scrubbed frame disagree with playback — exactly the drift §7b exists to remove.
const powerOut2 = (p: number): number => 1 - Math.pow(1 - p, 3);        // showMedia fade/fadeSide
const powerOut3 = (p: number): number => 1 - Math.pow(1 - p, 4);        // showMedia flyUp
const backOut2 = (p: number): number => { const q = p - 1; return q * q * (3 * q + 2) + 1; }; // showMedia pop
/** GSAP "power3.inOut" (quart in-out) — the ease moveMedia actually uses. */
const powerInOut3 = (p: number): number =>
  p < 0.5 ? 8 * Math.pow(p, 4) : 1 - Math.pow(-2 * p + 2, 4) / 2;

/** Entrance ease per `media.in` mode, mirroring showMedia's per-mode gsap.from calls. */
const ENTRANCE: Record<string, (p: number) => number> = {
  flyUp: powerOut3, pop: backOut2, fadeSide: powerOut2, fade: powerOut2,
};

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** Fold reached media actions to each tile's render state. Pure. */
export function mediaStateAt(entries: MediaFold[], _t: number): Map<string, MediaRenderState> {
  const out = new Map<string, MediaRenderState>();
  for (const { action: a, p } of entries) {
    if (a.kind === "media") {
      const ease = ENTRANCE[a.in ?? "fade"] ?? powerOut2;
      out.set(a.id, { x: a.pos.x, y: a.pos.y, scale: 1, opacity: ease(p) });
    } else if (a.kind === "media_move") {
      const cur = out.get(a.id);
      if (!cur) continue;
      const e = powerInOut3(p);
      out.set(a.id, {
        ...cur,
        x: lerp(cur.x, a.to.x, e),
        y: lerp(cur.y, a.to.y, e),
        scale: a.scale != null ? lerp(cur.scale, a.scale, e) : cur.scale,
      });
    } else if (a.kind === "media_out") {
      const ids = a.id ? [a.id] : [...out.keys()];
      for (const id of ids) {
        const cur = out.get(id);
        if (cur) out.set(id, { ...cur, opacity: 1 - p });
      }
    }
  }
  return out;
}
```

> **Note on `media_move` chaining:** folding `cur.x` as the origin means a second `media_move` on the
> same tile starts from wherever the first one *ended*, which matches playback. Do not "optimise"
> this to read the original `pos`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/media-at.test.ts`
Expected: PASS.

- [ ] **Step 5: Drive media from `renderAt`**

Collect media actions from the fold into `MediaFold[]`, call `mediaStateAt`, then write each
tile's `left`/`top`/`scale`/`opacity` from the result. `makeMediaEl` stays as-is (it only builds the
node); delete the `gsap.from`/`gsap.to` calls in `showMedia`, `moveMedia`, and `outMedia`.

- [ ] **Step 6: Run the gates**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add engine/deck/media-state.ts engine/components/layouts/CinematicSlide.tsx tests/unit/media-at.test.ts
git commit -m "feat(transport): media tiles render at t via a pure reducer"
```

---

## Task 7: Art and nightlight diffing

`ArtStage.show()` runs its own crossfade, so calling it every scrub frame would restart it constantly.

**Files:**
- Modify: `engine/components/layouts/CinematicSlide.tsx`
- Modify: `tests/unit/slide-render-at.test.tsx`

**Interfaces:**
- Consumes: `foldAt`, `renderAt`. `CinematicRuntime.applyArt(transition, durationMs?)` and `setNightlight(to, ms?)` are unchanged (`CinematicSlide.tsx:61-80`).
- Produces: `appliedArt` / `appliedNight` refs inside `CinematicSlide` holding the last-issued runtime state.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/slide-render-at.test.tsx`:

```tsx
test("scrubbing within one art window issues no repeated runtime calls", () => {
  const calls: string[] = [];
  const runtime = { ...noopRuntime, applyArt: () => calls.push("art"), setNightlight: () => calls.push("night") };
  const tl: Action[] = [
    { kind: "text", value: "x", in: "fade" },
    { kind: "art", art: { to: "3.02", mode: "fade" } },
    { kind: "nightlight", to: 0.4 },
    { kind: "wait", ms: 2000 },
  ];
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "a", timeline: tl } }} animate runtime={runtime} />,
  );
  const host = container.querySelector<HTMLElement & { __renderAt?: (t: number) => void }>(".cin")!;
  for (const t of [1.0, 1.2, 1.4, 1.6, 1.8, 2.0]) host.__renderAt!(t);
  expect(calls).toEqual(["art", "night"]);   // once each, not once per frame
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/slide-render-at.test.tsx -t "art window"`
Expected: FAIL — art/nightlight are not handled in `renderAt` yet, so `calls` is `[]`.

- [ ] **Step 3: Implement diffing**

Add refs and handle both kinds in `renderAt`'s fold loop:

```ts
const appliedArt = useRef<string | null>(null);      // JSON of the last-issued transition
const appliedNight = useRef<number | null>(null);
```

```ts
if (f.action.kind === "art") {
  const key = JSON.stringify(f.action.art);
  if (appliedArt.current !== key) {
    appliedArt.current = key;
    // Settled → snap; in-flight → let ArtStage run its own crossfade once.
    runtime.applyArt(f.action.art, f.phase === "settled" ? 0 : f.action.art.durationMs);
  }
  continue;
}
if (f.action.kind === "nightlight") {
  if (appliedNight.current !== f.action.to) {
    appliedNight.current = f.action.to;
    runtime.setNightlight(f.action.to, f.phase === "settled" ? 0 : f.action.durationMs);
  }
  continue;
}
```

`resetFrom` must also clear both refs when it resets index 0, so a backward seek re-issues art.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/slide-render-at.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/components/layouts/CinematicSlide.tsx tests/unit/slide-render-at.test.tsx
git commit -m "feat(transport): issue art/nightlight only when the folded state changes"
```

---

## Task 8: Derived `rotateList`

**Behaviour change** — an infinite `repeat: -1` loop becomes a derived item index.

**Files:**
- Modify: `engine/components/effects/cinematic-anim.ts:44-52`
- Modify: `engine/components/layouts/CinematicSlide.tsx` (delete the `loopers` ref)
- Create: `tests/unit/rotate-list-at.test.ts`

**Interfaces:**
- Consumes: `foldAt`.
- Produces: `export const ROTATE_STEP = 2.05` and `rotateItemAt(items: string[], elapsed: number): string` in `engine/components/effects/cinematic-anim.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/rotate-list-at.test.ts`:

```ts
import { expect, test } from "vitest";
import { ROTATE_STEP, rotateItemAt } from "@/engine/components/effects/cinematic-anim";

const items = ["alpha", "beta", "gamma"];

test("ROTATE_STEP matches the dwell rotateList's tweens actually occupy", () => {
  // fromTo 0.5 + "+=1.1" gap + out 0.45 (cinematic-anim.ts rotateList)
  expect(ROTATE_STEP).toBeCloseTo(2.05, 2);
});

test("rotateItemAt cycles items on ROTATE_STEP and wraps", () => {
  expect(rotateItemAt(items, 0)).toBe("alpha");
  expect(rotateItemAt(items, ROTATE_STEP * 1.5)).toBe("beta");
  expect(rotateItemAt(items, ROTATE_STEP * 3.2)).toBe("alpha");   // wrapped
});

test("rotateItemAt clamps a negative elapsed to the first item", () => {
  expect(rotateItemAt(items, -5)).toBe("alpha");
});

test("rotateItemAt tolerates an empty list", () => {
  expect(rotateItemAt([], 3)).toBe("");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/rotate-list-at.test.ts`
Expected: FAIL — `ROTATE_STEP` is not exported.

- [ ] **Step 3: Add the derived helper**

In `engine/components/effects/cinematic-anim.ts`, above `rotateList`:

```ts
/** Seconds one rotateList item occupies: in 0.5 + dwell 1.1 + out 0.45.
 *  rotateList() below builds exactly this shape; the two must not drift. */
export const ROTATE_STEP = 0.5 + 1.1 + 0.45;

/** The item visible `elapsed` seconds after a rotateList started. Deterministic —
 *  an infinite GSAP loop is not seekable, so the item is derived instead
 *  (design spec §7b §5, mirroring §7a's treatment of notes). */
export function rotateItemAt(items: string[], elapsed: number): string {
  if (!items.length) return "";
  const e = elapsed > 0 ? elapsed : 0;
  return items[Math.floor(e / ROTATE_STEP) % items.length];
}
```

Rewrite `rotateList`'s body to build its per-item timings from `ROTATE_STEP`'s three components so
the constant stays the single source.

- [ ] **Step 4: Render it from `renderAt`**

Add to the fold loop:

```ts
if (f.action.kind === "rotateList") {
  let entry = built.current.get(f.index);
  if (!entry) {
    const slot = document.createElement("span");
    slot.className = `cin__rotslot cin__line--${f.action.size ?? "md"}`;
    host.appendChild(slot);
    entry = { el: slot, tl: null };
    built.current.set(f.index, entry);
  }
  entry.el.textContent = rotateItemAt(f.action.items, t - f.start);
  continue;
}
```

Delete the `loopers` ref and every `loopers.current` reference in `CinematicSlide` — the `clear`
and `fade_out` handlers no longer need to kill loops, because there are none.

- [ ] **Step 5: Run the gates**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add engine/components/effects/cinematic-anim.ts engine/components/layouts/CinematicSlide.tsx tests/unit/rotate-list-at.test.ts
git commit -m "feat(transport): derive the rotateList item from t, dropping the infinite loop"
```

---

## Task 9: `SlideTransport` replaces segments

**Files:**
- Modify: `engine/components/layouts/CinematicSlide.tsx:107-203` (the `useGSAP` body)
- Modify: `tests/unit/slide-render-at.test.tsx` (swap the `__renderAt` hatch for the real ref)

**Interfaces:**
- Consumes: `renderAt` (Tasks 3–8), `beatDuration` (Task 1).
- Produces: `export interface SlideTransport { seek(t: number): void; play(): void; pause(): void; duration(): number }`, exposed via a new optional `transport?: React.Ref<SlideTransport>` prop on `CinematicSlide`.

- [ ] **Step 1: Write the failing test**

Replace `mountSlide`'s escape hatch in `tests/unit/slide-render-at.test.tsx` with the real ref, and add:

```tsx
import { createRef } from "react";
import type { SlideTransport } from "@/engine/components/layouts/CinematicSlide";

test("duration() is the canonical beatDuration, not a GSAP reading", () => {
  const ref = createRef<SlideTransport>();
  render(<CinematicSlide slots={{ sceneId: "s", beat }} animate runtime={noopRuntime} transport={ref} />);
  expect(ref.current!.duration()).toBeCloseTo(1.6, 1);   // two fade lines at 0.8
});

test("seek clamps to [0, duration]", () => {
  const ref = createRef<SlideTransport>();
  render(<CinematicSlide slots={{ sceneId: "s", beat }} animate runtime={noopRuntime} transport={ref} />);
  ref.current!.seek(-5);
  ref.current!.seek(999);              // must not throw
  expect(textAt(document.querySelector(".cin")!)).toEqual(["first", "second"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/slide-render-at.test.tsx`
Expected: FAIL — `transport` is not a prop; `SlideTransport` is not exported.

- [ ] **Step 3: Add the transport and delete the segment machinery**

Export the interface, add the prop, and replace `segments`/`playSegment`/`segIdx` with one axis:

```ts
export interface SlideTransport {
  seek(t: number): void;
  play(): void;
  pause(): void;
  duration(): number;
}
```

```ts
// Gate boundaries as TIMES on the single axis. Playback pauses at each; the editor
// scrubs straight through (design spec §7b D1, §4.4).
const gates = beatTimeline(slots.beat.timeline)
  .filter((w) => w.action.kind === "click_gate")
  .map((w) => w.start);

const duration = () => beatDuration(slots.beat.timeline);
const seek = (to: number) => renderAt(Math.max(0, Math.min(duration(), to)));

let ticker: ((time: number, delta: number) => void) | null = null;
const pause = () => { if (ticker) { gsap.ticker.remove(ticker); ticker = null; } };
const play = () => {
  pause();
  const nextGate = gates.find((g) => g > lastT.current);
  ticker = (_time, delta) => {
    const t = lastT.current + delta / 1000;
    if (nextGate != null && t >= nextGate) { renderAt(nextGate); pause(); runtime.onGate(play); return; }
    if (t >= duration()) { renderAt(duration()); pause(); runtime.onWaiting(true); return; }
    renderAt(t);
  };
  gsap.ticker.add(ticker);
};
```

Wire it with `useImperativeHandle(transport, () => ({ seek, play, pause, duration }))`. Delete the
`__renderAt` escape hatch from Task 3, and delete `masterRef` along with the segment code. Keep the
cleanup path calling `pause()` on unmount.

- [ ] **Step 4: Run the gates**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Verify playback in the browser before trusting the suite**

Run: `npm run test:e2e -- e2e/beatstage.spec.ts`
Expected: PASS — the existing playback assertions still hold.

- [ ] **Step 6: Commit**

```bash
git add engine/components/layouts/CinematicSlide.tsx tests/unit/slide-render-at.test.tsx
git commit -m "feat(transport): SlideTransport over one time axis, replacing segment timelines"
```

---

## Task 10: One clock for three stages

Earns the deletion of `BeatStage.tsx:42-54`'s KNOWN LIMITATION comment.

**Files:**
- Modify: `engine/authoring/BeatStage.tsx:38-72`
- Modify: `app/dev/beatstage/page.tsx`
- Create: `e2e/transport.spec.ts`

**Interfaces:**
- Consumes: `SlideTransport` (Task 9); `NoteFieldHandle.renderAt(scene, beatIndex, t)`; `ObjectStageHandle.renderAt(scene, beatIndex, t)`.
- Produces: `BeatStage` accepting an optional `transport?: React.Ref<SlideTransport>` it forwards to `CinematicSlide`.

- [ ] **Step 1: Write the failing e2e**

Create `e2e/transport.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("notes and objects stay in sync with text across a click_gate", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/dev/beatstage");

  // Scrub to just before the gate: the pre-gate line shows, the post-gate line does not.
  await page.getByTestId("scrub").fill("0.5");
  await expect(page.getByText("before gate")).toBeVisible();
  await expect(page.getByText("after gate")).toHaveCount(0);

  // Past the gate: post-gate text AND its note sprites appear together.
  await page.getByTestId("scrub").fill("2.0");
  await expect(page.getByText("after gate")).toBeVisible();
  await expect(page.locator("[data-testid=notefield] span")).not.toHaveCount(0);

  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:e2e -- e2e/transport.spec.ts`
Expected: FAIL — no `scrub` testid on the dev route.

- [ ] **Step 3: Re-point `BeatStage`**

Delete the proxy-timeline `useEffect` at `BeatStage.tsx:55-72` **and** the KNOWN LIMITATION comment
at lines 42-54. Replace with a transport the component owns, driving all three stages from one `t`:

```ts
const slide = useRef<SlideTransport>(null);

/** The one clock. CinematicSlide advances it; the sibling stages read the same t. */
const paint = useCallback((t: number) => {
  if (scene) {
    objStage.current?.renderAt(scene, beatIndex, t);
    notes.current?.renderAt(scene, beatIndex, t);
  }
}, [scene, beatIndex]);
```

Pass `onTime={paint}` to `CinematicSlide` so every `renderAt` also paints the siblings — add that
callback prop in the same edit, invoked at the end of `renderAt`.

- [ ] **Step 4: Give the dev route a gate-bearing fixture and a scrub control**

Rewrite `app/dev/beatstage/page.tsx`:

```tsx
"use client";
import { useRef, useState } from "react";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import type { Beat, Scene } from "@/engine/deck/types";

const beat: Beat = {
  id: "demo",
  timeline: [
    { kind: "text", value: "Hello Morgana", in: "fade" },
    { kind: "text", value: "before gate", in: "fade" },
    { kind: "click_gate" },
    { kind: "text", value: "after gate", in: "fade" },
    { kind: "note_emitter", color: "#ffcc66", pos: { x: 0.5, y: 0.5 }, dir: 0, decay: 1500, freq: 6 },
    { kind: "wait", ms: 2000 },
  ],
};
const scene: Scene = { id: "demo", beats: [beat] };

export default function Page() {
  const transport = useRef<SlideTransport>(null);
  const [t, setT] = useState(0);
  return (
    <>
      <BeatStage sceneId="demo" beat={beat} scene={scene} beatIndex={0} transport={transport} />
      <input
        data-testid="scrub" type="range" min={0} max={5} step={0.1} value={t}
        onChange={(e) => { const v = Number(e.target.value); setT(v); transport.current?.seek(v); }}
        style={{ position: "fixed", bottom: 12, left: 12, right: 12, zIndex: 10 }}
      />
    </>
  );
}
```

Keep "Hello Morgana" — `e2e/beatstage.spec.ts` asserts it.

- [ ] **Step 5: Run both suites**

Run: `npx vitest run && npx tsc --noEmit && npm run test:e2e`
Expected: PASS — including the existing `beatstage.spec.ts`.

- [ ] **Step 6: Commit**

```bash
git add engine/authoring/BeatStage.tsx app/dev/beatstage/page.tsx e2e/transport.spec.ts
git commit -m "feat(transport): drive text, notes, and objects from one clock"
```

---

## Task 11: Fold static mode in (optional)

Spec §4.5 marks this separable. **If Tasks 5–8 surfaced risk on the counter/media paths, skip it and say so in the PR** — nothing else depends on it.

**Files:**
- Modify: `engine/components/layouts/CinematicSlide.tsx:127-160`
- Modify: `tests/unit/slide-render-at.test.tsx`

**Interfaces:**
- Consumes: `renderAt`, `duration()`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```tsx
test("static mode renders the settled end state", () => {
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat }} animate={false} runtime={noopRuntime} />,
  );
  expect(textAt(container.querySelector(".cin")!)).toEqual(["first", "second"]);
});
```

- [ ] **Step 2: Run to verify it fails or passes**

Run: `npx vitest run tests/unit/slide-render-at.test.tsx -t "static mode"`
Expected: PASS already (the hand-written fold works). This test is the **safety net** for step 3, not a red test — write it first so the replacement is verified against existing behaviour.

- [ ] **Step 3: Replace the hand-written fold**

Delete `CinematicSlide.tsx:131-160` and replace the `staticMode` branch with:

```ts
if (staticMode) {
  runtime.art(runtime.resolveEnd(), "cut");
  renderAt(duration());        // the settled state IS the fold at the end of the axis
  runtime.onWaiting(true);
  return;
}
```

- [ ] **Step 4: Run everything**

Run: `npx vitest run && npx tsc --noEmit && npm run test:e2e`
Expected: PASS. Pay attention to any print/PDF e2e — this path feeds it.

- [ ] **Step 5: Commit**

```bash
git add engine/components/layouts/CinematicSlide.tsx tests/unit/slide-render-at.test.tsx
git commit -m "refactor(transport): static mode is renderAt(duration), not a second fold"
```

---

## Task 12: Sync the deep-dive and close out

**Files:**
- Modify: `docs/MM_MORGANA.md`

- [ ] **Step 1: Update the deep-dive**

The note-particles bullet records the purity import rule. Extend that section with: the canonical
clock now lives in `engine/authoring/beat-clock.ts`; `CinematicSlide` is seekable via
`SlideTransport`; the "GSAP master is a callback scheduler with time spacers" gotcha is **resolved**
and should be rewritten as history, not as a live constraint. Note the three behaviour changes
(counter/media scrubbable, `rotateList` derived).

- [ ] **Step 2: Commit**

```bash
git add docs/MM_MORGANA.md
git commit -m "docs(morgana): record the seekable transport and the resolved scheduler gotcha"
```

- [ ] **Step 3: Full gate before the PR**

Run: `npx vitest run && npx tsc --noEmit && npm run test:e2e`
Expected: all green.

- [ ] **Step 4: Open the PR**

Body must call out the three behaviour changes from §5 explicitly, and state that §7c's parity gate
does not exist yet (spec §9's accepted risk).

---

## Self-Review

**Spec coverage.** §3 clock extraction → Task 1. §4.2 fold → Tasks 2–3. §4.3 cache/boundaries →
Task 4. §4.4 gates replace segments → Task 9. §4.5 static mode → Task 11. §5 per-action table →
Tasks 3, 5, 6, 7, 8 (`wait` needs no work; `reveal_arrows`/`pulse_arrow`/`reveal_again` fire once
when crossed, which Task 9's forward ticker gives for free; `note_*`/`cue` untouched by design).
§6 BeatStage → Task 10. §7.1 seek symmetry → Tasks 3–4. §7.2 unit tests → Tasks 1, 2, 5, 6, 7, 8.
§7.3 e2e → Tasks 9–10. §8 phases 1–6 → Tasks 1–11. No gaps.

**Placeholder scan.** No TBD/TODO. Every code step carries real code. Task 11 step 2 deliberately
expects PASS and says why (characterisation test, not a red test).

**Type consistency.** `renderAt(t: number): void`, `foldAt(timeline, t): FoldEntry[]`,
`rebuildBoundary(timeline, t): number`, `resetFrom(index): void`, `SlideTransport.{seek,play,pause,duration}`,
`counterValueAt(from, to, p)`, `mediaStateAt(entries, t)`, `rotateItemAt(items, elapsed)`,
`ROTATE_STEP` — each defined once and used with the same signature everywhere after.

**Known soft spot.** Task 5 step 5 and Task 6 step 5 describe the `renderAt` integration in prose
rather than a complete diff, because both depend on the exact shape `renderAt` has after Tasks 3–4.
Implementers should expect to write that glue themselves; the pure helpers they call are fully
specified and tested.
