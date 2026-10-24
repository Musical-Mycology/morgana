# Credits, Drawn Titles, Text Particles and Fade to Black Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A drawn ("draw") text style, music-note particles off any opted-in text line or credit line, an upward credits roll, and a deck-time fade to black. All four render identically in `/play`, the MP4 render and (approximately, as today) the editor canvas.

**Architecture:**
- Four small time-pure pieces, each in a pure module:
  - `draw-state.ts` (stroke and fill state per glyph);
  - `textSpritesAt` in `note-state.ts` (note sprites off measured word boxes);
  - `credits.ts` (roll offset and line visibility windows);
  - `fade-clock.ts` (`fadeEvents` / `fadeAt`, the nightlight model).
- CinematicSlide renders a draw line as an inline SVG with one `<tspan>` per glyph, driven by a paused GSAP proxy timeline. It also builds the credits block in the fixed text layer.
- CinematicSlide measures word boxes **at rest from layout offsets** (never the live, animated rects) after `document.fonts.ready`. It publishes them to BeatStage through a stable ref and exposes `transport.sourcesReady()`, which `/render` awaits.
- NoteField paints text sprites into a new fixed `.notefield__text` container that BeatStage owns outside the camera world.
- `useDeckStage.apply(T)` paints one `.deck__fade` overlay. DeckCanvas paints it capped at 50%.

**Tech Stack:** Next.js 15, React 19, TypeScript, GSAP (paused timelines only), Vitest (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-credits-particles-design.md`

## Global Constraints

- **Draw variant (recorded by Task 1):** `DRAW_VARIANT = "<pending>"`. Task 1 replaces `<pending>` with `"dash"` or `"mask"` plus the failing assertion, if any. Task 2 sets the constant from this line.
- `TextIn` gains `"draw"`. `introDuration` for `"draw"` = `(0.1 + chars·0.08 + 0.4) / speed`, where `speed` defaults to 1 and `chars = value.length`.
- Draw outline phase:
  - `stroke = currentColor`, `stroke-width` 1.5% of the font size (`0.015em`), `fill-opacity: 0`.
  - `stroke-dasharray: L` with `stroke-dashoffset` animating from `L` to `0`. `L = 12em` (a per-line, font-size-relative upper bound).
  - Glyphs are staggered 0.08 s per character.
- Draw fill phase: 0.4 s. `fill-opacity` 0 → 1 and `stroke-opacity` 1 → 0.
- `text.particles?: { color?: NoteColor | string; rate?: number; rise?: number }`.
  - `color` is a `NoteColor` name (resolved through `NOTE_TINTS[c].fill`) or any CSS hex. It defaults to `"cream"`.
  - `rate` defaults to 6 notes/s. Validation range is 1–30.
  - `rise` defaults to 1.
- Text sprites:
  - Note *i* is born at `i / rate` (beat-local seconds). It is only emitted while `start ≤ birth < end`.
  - The seed is `mulberry32(hash32(TEXT_SEED + srcIdx, i))`, with `TEXT_SEED = 0x10000`. Draw order: rect, x in the rect, spread, mult.
  - y is the rect's top. With `scroll`, add the offset at the **birth** time.
  - Keys are `t${srcIdx}:${i % P}`.
  - `dir` is 0 (up) ± 25°. The lifetime is 2.4 s. The distance is `EMIT_SPEED_N · 2.4 · mult · rise`. Bounce, travel and fade use the same curves as `emitterSpritesAt`.
  - The caps are `MAX_SPRITES_PER_SOURCE` and `MAX_SPRITES_TOTAL`.
- `credits` action shape: `{ kind: "credits"; items: { role?: string; names: string[] }[]; area?: { x; y; w; h }; durationMs: number; particles?: TextParticles }`.
  - The default area is `{ x: 0.2, y: 0.32, w: 0.6, h: 0.63 }`.
  - `actionDuration` = `durationMs / 1000`.
  - The edge mask is `linear-gradient(transparent, #000 8%, #000 92%, transparent)`.
  - `creditsOffset` is linear from `areaH` to `−blockH`.
- `screen_fade` action shape: `{ kind: "screen_fade"; to: number; color?: string; durationMs?: number }`.
  - `color` defaults to `"#000"` and `durationMs` to 1000. `actionDuration` is 0.
  - The level is linear from the value in effect when the fade starts. `durationMs: 0` is a cut.
  - The colour switches at the start of a fade.
  - It uses the same reach rule as `nightEvents`.
- Fade painting:
  - `.deck__fade` is the last child of the deck stage wrapper. `apply(T)` paints it, writing only when the painted value changes.
  - At level 0 it is `display: none`, so it paints nothing.
  - DeckCanvas paints `min(level, 0.5)`.
- `.notefield__text` sits in the fixed layer stack: z 2, after the notes and objects worlds and before the text wrapper. It is outside every `.beat__world` and never takes a camera transform.
- `/render`:
  - The full-raster gate is `hasCamera || hasNoteSources(doc)`.
  - `renderFrame` awaits `sourcesReady()` after `pendingVideoSeeks()` and before the image-decode step.
  - The note-deck hint-drop rules cover `.notefield__text > *` too.
- Lint rules:
  - `credits-fast`: the roll speed is above 90 px/s at 1080p. `blockH` is estimated from line counts × line height.
  - `fade-unfinished`: a `screen_fade` is still running at the deck total.
  - `draw-long`: a draw line's `introDuration` is above 8 s.
- **One-clock rule:** `apply(T)` in `useDeckStage` stays the only writer of deck time. No new ticker anywhere.
- **Render determinism:** a stepped frame must be byte-identical to the same frame jumped to. New render-page describes use `test.describe.configure({ retries: 0 })`.
- **Pure modules:** `draw-state.ts`, `credits.ts`, `fade-clock.ts` and `credits-text.ts` go in the pure-import-graph DOM list. `credits.ts` and `fade-clock.ts` also go in the node-builtin list, because `lint.ts` imports them.
- **Client imports:** client code never runtime-imports `@/lib/store/*`. Finish UI tasks with `npm run build`.
- **jsdom MutationObserver** ignores same-value writes. To test write-on-change, count setter calls (`watchStyle`, below).
- **Unit commands:** `npx vitest run <file>`, then `npm test` and `npx tsc --noEmit`.
- **E2E command:** `export LD_LIBRARY_PATH=/tmp/claude-1000/-home-chris-oltyan-projects-morgana--claude-worktrees-morgana-time-animation-78c764/7e066baf-f84a-45f2-ae64-4ba1724b162c/scratchpad/libs/usr/lib/x86_64-linux-gnu; npm run test:e2e -- e2e/<spec> --project=default`
- Commits are conventional and carry no attribution lines.

`watchStyle` (paste into any test that needs it; generalised from `tests/unit/camera-world.test.tsx`):
```ts
/** Calls to `el.style[prop]`'s setter since watching started, same-value writes included (jsdom
 *  queues no MutationObserver record for a same-value write). */
function watchStyle(el: HTMLElement, prop: "transform" | "opacity" | "display") {
  let desc: PropertyDescriptor | undefined;
  for (let p: object | null = el.style; p && !desc; p = Object.getPrototypeOf(p)) desc = Object.getOwnPropertyDescriptor(p, prop);
  if (!desc?.set || !desc.get) throw new Error(`style.${prop} has no accessor descriptor`);
  const { get, set } = desc;
  let n = 0;
  Object.defineProperty(el.style, prop, { set(v: string) { n++; set.call(this, v); }, get() { return get.call(this); }, configurable: true });
  return { count: () => n, stop: () => { delete (el.style as unknown as Record<string, unknown>)[prop]; } };
}
```

## Review Focus

1. **A beat swap while a word-box measurement is still pending** (a fast `/play` scrub across beats) must never publish the old beat's sources into the new beat. The new beat shows only its own particles (Task 10).
2. **Decks without any of the new features must render as before.** The overlay stays `display:none`, no text sources exist, and `.notefield__text` is empty. The existing render-page, play and notes e2e tests pass unchanged (Tasks 10, 12, 13).
3. **A backward scrub from after a fade to before it** returns the overlay to `display:none`. A fade level holds across a scene cut (Task 12).
4. **A particle line wiped by a later `clear`:** births stop at the clear. After the wipe the line's source is gone, both when stepped and when jumped to (Task 10).
5. **Draw inputs the SVG path does not handle** must fall back without an SVG and without a crash: inline markup, `append`, `instantText`, `dots`, an empty value (Task 9).

---

## File Structure

| File | Responsibility |
|---|---|
| `e2e/svg-draw-probe.spec.ts` (new) | Task 1 probe, kept as a regression test of the shipped draw CSS. |
| `engine/components/effects/draw-state.ts` (new, pure) | Draw constants, `DRAW_VARIANT`, `drawDuration`, `drawGlyphAt`, `drawSweepAt`, `drawText`, `wordRuns`. |
| `engine/deck/types.ts` | `TextIn` gains `draw`; `TextParticles`, `CreditItem`, `CreditsArea`; the `credits` and `screen_fade` actions; `text.particles`. |
| `engine/authoring/beat-clock.ts` | Draw `introDuration`; credits `actionDuration`. |
| `engine/deck-doc.ts` | `validateCreditsAndFades`. |
| `engine/components/effects/note-state.ts` | `TextRect`, `TextScroll`, `TextSource`, `textSpritesAt`, `scrollOffsetAt`, `textSourceEnd`, `textSourceIdx`, `resolveParticleColor`, `particleOpts`, `isTextSpriteKey`; `noteFieldStateAt` takes text sources. |
| `engine/deck/credits.ts` (new, pure) | Default area, line-height constants, `creditsOffset`, `creditsScroll`, `creditLineWindow`, `estimateCreditsBlockH`. |
| `lib/editor/credits-text.ts` (new, pure) | `parseCredits` / `formatCredits`. |
| `engine/authoring/fade-clock.ts` (new, pure) | `fadeEvents`, `fadeAt`. |
| `engine/authoring/camera-clock.ts` | `hasNoteActions` → `hasNoteSources`. |
| `engine/components/effects/cinematic-anim.ts` | `drawIn` (a paused proxy timeline). |
| `engine/components/text-sources.ts` (new, DOM) | `wrapWords`, `htmlLineRects`, `drawLineRects`, `creditLineRects`. |
| `engine/components/credits-block.ts` (new, DOM) | `buildCreditsBlock` (inline styles), shared by CinematicSlide and `seek.ts`. |
| `engine/components/fade-overlay.ts` (new, DOM) | `paintFadeOverlay` (write-on-change), shared by DeckStage and DeckCanvas. |
| `engine/components/layouts/CinematicSlide.tsx` | Draw lines; credits fold and paint; measurement; `sourcesReady`; `textSourcesRef`. |
| `engine/components/NoteField.tsx` | `renderAt(…, textSources?)`; `textHost` prop; `.notefield__text` CSS. |
| `engine/authoring/BeatStage.tsx` | Owns `.notefield__text` and the text-sources ref. |
| `engine/authoring/seek.ts` | Editor canvas credits roll. |
| `components/player/DeckStage.tsx` | `.deck__fade` overlay; `sourcesReady`; camera hint-drop covers `.notefield__text`. |
| `components/player/RenderStage.tsx` | `hasNoteSources`; awaits `sourcesReady`; hint-drop covers `.notefield__text`. |
| `components/editor/DeckCanvas.tsx` | Canvas fade overlay capped at 0.5. |
| `lib/editor/registry.ts`, `components/editor/Field.tsx`, `components/editor/Inspector.tsx` | `draw`, Particles, Credits and Screen fade fields. |
| `lib/editor/lint.ts` | `credits-fast`, `fade-unfinished`, `draw-long`. |
| `lib/mcp/tool-defs.ts` | Doc text. |

---

### Task 1: SVG draw probe (decides "dash" vs "mask")

**Files:**
- Create: `e2e/svg-draw-probe.spec.ts`
- Modify: this plan's Global Constraints line `Draw variant (recorded by Task 1)`

**Interfaces — Produces:** the recorded variant `"dash" | "mask"`, which Task 2 copies into `DRAW_VARIANT`.

The probe uses `page.setContent`, so it does not need any deck. Its CSS is exactly the CSS that Task 9 ships: a `--d` custom property per `<tspan>` scales a `12em` dash.

- [ ] **Step 1: Write the probe.**
```ts
import { expect, test, type Page } from "@playwright/test";

// Timed-video sub-project 6, Task 1 (kept as a regression test). The "draw" text style traces each
// glyph's outline with per-<tspan> stroke dashing, driven by the CSS below (the same rules
// CinematicSlide ships). This checks that Chromium dashes each glyph tspan independently and paints
// the same pixels for the same state however it got there. Its outcome sets DRAW_VARIANT in
// engine/components/effects/draw-state.ts: every "dash:" test passes -> "dash"; otherwise "mask" (the
// mask-image sweep, whose own determinism the "mask:" test checks).
const CSS = `
  html, body { margin: 0; background: #000; }
  svg { display: block; }
  text { font: 120px serif; letter-spacing: 48px; fill: #fff; stroke: #fff; stroke-width: 0.015em; white-space: pre; }
  tspan { stroke-dasharray: 12em; stroke-dashoffset: calc(var(--d, 1) * 12em); fill-opacity: var(--f, 0); stroke-opacity: var(--s, 1); }
  .gone text { visibility: hidden; }
  .mask { -webkit-mask-image: linear-gradient(90deg, #000 calc(var(--sweep, 0) * 108% - 8%), transparent calc(var(--sweep, 0) * 108%));
          mask-image: linear-gradient(90deg, #000 calc(var(--sweep, 0) * 108% - 8%), transparent calc(var(--sweep, 0) * 108%)); }
  .mask tspan { stroke-dasharray: none; stroke-dashoffset: 0; }
`;
const PAGE = `<!doctype html><html><head><style>${CSS}</style></head><body><svg id="s" width="720" height="220"><text x="24" y="24" dominant-baseline="text-before-edge"><tspan>H</tspan><tspan>O</tspan><tspan>M</tspan></text></svg></body></html>`;
const FULL = { x: 0, y: 0, width: 720, height: 220 };
type Box = typeof FULL;

/** Load the probe page; returns one padded screenshot clip per glyph (letter-spacing keeps them apart). */
async function open(page: Page): Promise<Box[]> {
  await page.setViewportSize({ width: 720, height: 220 });
  await page.setContent(PAGE);
  return page.evaluate(() => {
    const text = document.querySelector("text") as SVGTextElement;
    const svg = document.getElementById("s")!.getBoundingClientRect();
    return [0, 1, 2].map((i) => {
      const r = text.getExtentOfChar(i);
      return { x: Math.max(0, Math.floor(svg.left + r.x) - 3), y: Math.max(0, Math.floor(svg.top + r.y) - 3), width: Math.ceil(r.width) + 6, height: Math.ceil(r.height) + 6 };
    });
  });
}
/** Set each glyph's --d, plus the svg's class and --sweep. */
async function state(page: Page, d: number[], opts: { cls?: string; sweep?: number } = {}) {
  await page.evaluate(({ d, cls, sweep }) => {
    const svg = document.getElementById("s")!;
    svg.setAttribute("class", cls);
    svg.style.setProperty("--sweep", String(sweep));
    document.querySelectorAll<SVGTSpanElement>("tspan").forEach((t, i) => t.style.setProperty("--d", String(d[i])));
  }, { d, cls: opts.cls ?? "", sweep: opts.sweep ?? 0 });
}
const shots = (page: Page, boxes: Box[]) => Promise.all(boxes.map((clip) => page.screenshot({ clip })));

test("dash: a glyph at --d 1 paints nothing while its neighbour at 0 is stroked whole (each tspan is dashed on its own)", async ({ page }) => {
  const boxes = await open(page);
  await state(page, [1, 1, 1], { cls: "gone" });
  const blank = await shots(page, boxes);
  await state(page, [0, 0, 0]);
  const whole = await shots(page, boxes);
  for (let i = 0; i < 3; i++) expect(whole[i].equals(blank[i]), `glyph ${i} is stroked at --d 0`).toBe(false);
  await state(page, [1, 1, 1]);
  const hidden = await shots(page, boxes);
  for (let i = 0; i < 3; i++) expect(hidden[i].equals(blank[i]), `glyph ${i} at --d 1 paints nothing`).toBe(true);
  await state(page, [1, 0, 1]);
  const a = await shots(page, boxes);
  expect(a[0].equals(blank[0])).toBe(true);
  expect(a[1].equals(whole[1]), "glyph 1's stroke does not depend on glyph 0's offset").toBe(true);
  expect(a[2].equals(blank[2])).toBe(true);
  await state(page, [0, 1, 0]);
  const b = await shots(page, boxes);
  expect(b[0].equals(whole[0])).toBe(true);
  expect(b[1].equals(blank[1])).toBe(true);
  expect(b[2].equals(whole[2])).toBe(true);
});

test("dash: 12em bounds every glyph's outline, and a mid value draws part of it", async ({ page }) => {
  const boxes = await open(page);
  await state(page, [0, 0, 0]);
  const whole = await shots(page, boxes);
  await state(page, [0.05, 0.05, 0.05]); // offset 0.6em: whole iff the outline is ≤ 11.4em
  const nearly = await shots(page, boxes);
  for (let i = 0; i < 3; i++) expect(nearly[i].equals(whole[i]), `glyph ${i}'s outline fits in the dash`).toBe(true);
  await state(page, [1, 1, 1], { cls: "gone" });
  const blank = await shots(page, boxes);
  await state(page, [1, 1, 0.85]); // 1.8em of the M's outline
  const part = await shots(page, boxes);
  expect(part[2].equals(blank[2])).toBe(false);
  expect(part[2].equals(whole[2])).toBe(false);
});

test("dash: the same state paints the same pixels however it was reached", async ({ page }) => {
  await open(page);
  await state(page, [0.3, 0.6, 0.9]);
  const first = await page.screenshot({ clip: FULL });
  await state(page, [1, 0, 0.5]);
  await page.screenshot({ clip: FULL });
  await state(page, [0.3, 0.6, 0.9]);
  expect((await page.screenshot({ clip: FULL })).equals(first), "back to the same state").toBe(true);
  await open(page);
  await state(page, [0.3, 0.6, 0.9]);
  expect((await page.screenshot({ clip: FULL })).equals(first), "a fresh page, jumped straight there").toBe(true);
});

test("mask: the sweep fallback hides everything at 0, part at 0.4, and is deterministic", async ({ page }) => {
  await open(page);
  await state(page, [0, 0, 0], { cls: "gone" });
  const blank = await page.screenshot({ clip: FULL });
  await state(page, [0, 0, 0], { cls: "mask", sweep: 1 });
  const whole = await page.screenshot({ clip: FULL });
  await state(page, [0, 0, 0], { cls: "mask", sweep: 0 });
  expect((await page.screenshot({ clip: FULL })).equals(blank)).toBe(true);
  await state(page, [0, 0, 0], { cls: "mask", sweep: 0.4 });
  const mid = await page.screenshot({ clip: FULL });
  expect(mid.equals(blank)).toBe(false);
  expect(mid.equals(whole)).toBe(false);
  await state(page, [0, 0, 0], { cls: "mask", sweep: 0.9 });
  await state(page, [0, 0, 0], { cls: "mask", sweep: 0.4 });
  expect((await page.screenshot({ clip: FULL })).equals(mid)).toBe(true);
});
```
- [ ] **Step 2: Run it three times.** `E2E` with `e2e/svg-draw-probe.spec.ts --repeat-each=3`.
- [ ] **Step 3: Record the outcome. Pick exactly one branch.**
  - **Outcome "dash"** (every `dash:` test and the `mask:` test pass, all three runs): set the Global Constraints line to `DRAW_VARIANT = "dash"`. The probe file stays as it is.
  - **Outcome "mask"** (any `dash:` assertion fails, and the `mask:` test passes):
    - Set the line to `DRAW_VARIANT = "mask" (dash failed: <test title> — <assertion message>)`.
    - Add `test.fail();` as the first statement of each failing `dash:` test, with a one-line comment above it: `// Chromium <version>: <what it does instead> — the "mask" variant ships (plan Task 1).` The file then documents the behaviour and flags it if Chromium ever changes.
  - **Both fail:** stop. Report BLOCKED with the failing assertions; neither variant is deterministic.
- [ ] **Step 4: Commit.** `test(e2e): SVG draw probe — per-glyph dashing and determinism (draw variant: <dash|mask>)` with `git add e2e/svg-draw-probe.spec.ts docs/superpowers/plans/2026-10-23-credits-particles.md`.

---

### Task 2: Draw timing (pure) and `TextIn` `"draw"`

**Files:**
- Create: `engine/components/effects/draw-state.ts`, `tests/unit/draw-state.test.ts`
- Modify: `engine/deck/types.ts:94-98` (`TextIn`), `engine/authoring/beat-clock.ts:7-31`, `tests/unit/pure-import-graph.test.ts:37-48`

**Interfaces — Consumes:** the recorded `DRAW_VARIANT` (Task 1). **Produces:**
```ts
export const DRAW_VARIANT: "dash" | "mask";
export const DRAW_LEAD = 0.1, DRAW_STAGGER = 0.08, DRAW_FILL = 0.4, DRAW_DASH_EM = 12, DRAW_STROKE_EM = 0.015;
export function drawDuration(chars: number, speed?: number): number;
export interface DrawGlyphState { dash: number; fill: number; stroke: number } // dash: 1 = hidden … 0 = whole
export function drawGlyphAt(i: number, chars: number, t: number, speed?: number): DrawGlyphState;
export function drawSweepAt(chars: number, t: number, speed?: number): number;
export function drawText(value: string): string;           // "\n" → " " (same length)
export function wordRuns(s: string): [number, number][];   // [start, end) of each \S+ run
// types.ts: TextIn gains "draw"
```

Each glyph strokes over `DRAW_LEAD + DRAW_STAGGER` = 0.18 s, starting at `i · 0.08`. The last glyph therefore finishes at `0.1 + chars·0.08`, which is exactly where the fill phase starts.

- [ ] **Step 1: Failing tests** (`tests/unit/draw-state.test.ts`).
```ts
import { expect, test } from "vitest";
import { drawDuration, drawGlyphAt, drawSweepAt, drawText, wordRuns } from "@/engine/components/effects/draw-state";
import { introDuration } from "@/engine/authoring/beat-clock";

test("drawDuration = (0.1 + chars·0.08 + 0.4) / speed", () => {
  expect(drawDuration(3)).toBeCloseTo(0.74, 12);
  expect(drawDuration(3, 2)).toBeCloseTo(0.37, 12);
  expect(drawDuration(0)).toBeCloseTo(0.5, 12);
});

test("introDuration for draw follows drawDuration; dots add no tail (dots are not drawn)", () => {
  expect(introDuration({ in: "draw", value: "abc" })).toBeCloseTo(0.74, 12);
  expect(introDuration({ in: "draw", value: "abc", speed: 2 })).toBeCloseTo(0.37, 12);
  expect(introDuration({ in: "draw", value: "abc", dots: true })).toBeCloseTo(0.74, 12);
  expect(introDuration({ in: "fade", value: "abc" })).toBe(0.8); // other styles unchanged
});

test("drawGlyphAt: each glyph strokes over 0.18 s from i·0.08, then all glyphs fill together over 0.4 s", () => {
  expect(drawGlyphAt(0, 3, 0)).toEqual({ dash: 1, fill: 0, stroke: 1 });
  expect(drawGlyphAt(0, 3, 0.09).dash).toBeCloseTo(0.5, 12);
  expect(drawGlyphAt(1, 3, 0.09).dash).toBeCloseTo(1 - 0.01 / 0.18, 12);
  expect(drawGlyphAt(2, 3, 0.09).dash).toBe(1);
  const atFill = drawGlyphAt(2, 3, 0.34);
  expect(atFill.dash).toBeCloseTo(0, 12);
  expect(atFill.fill).toBeCloseTo(0, 12);
  const mid = drawGlyphAt(0, 3, 0.54);
  expect(mid.fill).toBeCloseTo(0.5, 12);
  expect(mid.stroke).toBeCloseTo(0.5, 12);
  expect(drawGlyphAt(1, 3, 0.74)).toEqual({ dash: 0, fill: 1, stroke: 0 });
  expect(drawGlyphAt(1, 3, 9)).toEqual({ dash: 0, fill: 1, stroke: 0 });
});

test("speed scales time: speed 2 at t is speed 1 at 2t", () => {
  expect(drawGlyphAt(0, 3, 0.045, 2)).toEqual(drawGlyphAt(0, 3, 0.09));
  expect(drawSweepAt(3, 0.085, 2)).toBeCloseTo(drawSweepAt(3, 0.17), 12);
});

test("drawSweepAt runs 0 → 1 over the outline phase (0.1 + chars·0.08)", () => {
  expect(drawSweepAt(3, 0)).toBe(0);
  expect(drawSweepAt(3, 0.17)).toBeCloseTo(0.5, 12);
  expect(drawSweepAt(3, 0.34)).toBeCloseTo(1, 12);
  expect(drawSweepAt(3, 5)).toBe(1);
});

test("drawText keeps length (newline → space); wordRuns finds each non-space run", () => {
  expect(drawText("A\nB c")).toBe("A B c");
  expect(wordRuns("  Hello  big world ")).toEqual([[2, 7], [9, 12], [13, 18]]);
  expect(wordRuns("   ")).toEqual([]);
});
```
- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/unit/draw-state.test.ts`
- [ ] **Step 3: Implement.**
  - **`engine/components/effects/draw-state.ts`.** Set `DRAW_VARIANT` to the value recorded in Global Constraints.
```ts
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
```
  - **`engine/deck/types.ts:94-98`:** add `| "draw"` to the line-level group, as `| "flyUp" | "fade" | "fadeSide" | "cursive" | "draw"`. Update the comment: `// draw: SVG outline stroke, then fill (sub-project 6)`.
  - **`engine/authoring/beat-clock.ts`:**
```ts
import type { Action, TextIn } from "@/engine/deck/types";
import { drawDuration } from "@/engine/components/effects/draw-state";

// Mirrors INTRO_DUR + introDuration() in CinematicSlide.tsx so windows match playback timing.
const INTRO_DUR: Record<Exclude<TextIn, "draw">, number> = {
  flyUp: 0.6, fade: 0.8, fadeSide: 0.7, cursive: 1.0,
  letterFly: 1.6, letterUp: 1.6, wordUp: 1.3, blurIn: 1.6, typewriter: 1.5,
};
```
  - In `introDuration`, insert this as the first line after `const sp = …`:
```ts
  // draw: per-character outline + one fill phase (draw-state.ts). Dots are not drawn, so no dot tail.
  if (a.in === "draw") return drawDuration(a.value.length, sp);
```
  - **`tests/unit/pure-import-graph.test.ts`:** add `"engine/components/effects/draw-state.ts",` to the first `test.each` list.
- [ ] **Step 4: Run** the tests, the pure-import-graph test, `npm test` and `npx tsc --noEmit`. Expect PASS. `registry.ts`'s `TEXT_INS: TextIn[]` is not exhaustive, so tsc stays clean; Task 14 adds `"draw"` to it.
- [ ] **Step 5: Commit.** `feat(engine): draw text timing (pure draw-state; introDuration for "draw")`

---

### Task 3: Credits, screen fade and particles: types, validation, beat timing

**Files:**
- Modify: `engine/deck/types.ts:68` (import), `:128` (text action), `:120-187` (Action union); `engine/deck-doc.ts:137-179`; `engine/authoring/beat-clock.ts:34-50`
- Test: `tests/unit/credits-action.test.ts` (new)

**Interfaces — Produces:**
```ts
// engine/deck/types.ts
export interface TextParticles { color?: NoteColor | string; rate?: number; rise?: number }
export interface CreditItem { role?: string; names: string[] }
export interface CreditsArea { x: number; y: number; w: number; h: number }
// text action gains:  particles?: TextParticles
// Action union gains:
| { kind: "credits"; items: CreditItem[]; area?: CreditsArea; durationMs: number; particles?: TextParticles }
| { kind: "screen_fade"; to: number; color?: string; durationMs?: number }
```

- [ ] **Step 1: Failing tests** (`tests/unit/credits-action.test.ts`).
```ts
import { describe, expect, test } from "vitest";
import { actionDuration, isSeekable } from "@/engine/authoring/beat-clock";
import { validateDeckDoc } from "@/engine/deck-doc";

const deckWith = (action: unknown) => ({ version: 1, meta: { id: "c", title: "C" },
  scenes: [{ id: "s0", beats: [{ id: "b0", timeline: [{ kind: "wait", ms: 10 }, action] }] }] });
const AT = "scenes[0].beats[0].timeline[1]";
const credits = { kind: "credits", items: [{ role: "Directed by", names: ["Ann Lee"] }, { names: ["Bo"] }], durationMs: 4000 };

describe("timing", () => {
  test("credits occupy durationMs on the beat; a screen fade occupies none", () => {
    expect(actionDuration({ kind: "credits", items: [{ names: ["A"] }], durationMs: 4000 })).toBe(4);
    expect(actionDuration({ kind: "screen_fade", to: 1 })).toBe(0);
    expect(actionDuration({ kind: "screen_fade", to: 1, durationMs: 3000 })).toBe(0);
    expect(isSeekable({ kind: "credits", items: [{ names: ["A"] }], durationMs: 1 })).toBe(true);
  });
});

describe("validation", () => {
  test.each([
    ["credits", credits],
    ["credits with area", { ...credits, area: { x: 0.1, y: 0.2, w: 0.8, h: 0.8 } }],
    ["credits with particles", { ...credits, particles: { color: "lime", rate: 30, rise: 2 } }],
    ["a role-only item", { ...credits, items: [{ role: "Thanks", names: [] }] }],
    ["screen_fade", { kind: "screen_fade", to: 1, color: "#fff", durationMs: 0 }],
    ["screen_fade at 0", { kind: "screen_fade", to: 0 }],
    ["text particles", { kind: "text", value: "Hi", in: "draw", particles: { rate: 1 } }],
  ])("accepts %s", (_n, action) => {
    expect(validateDeckDoc(deckWith(action)).errors).toEqual([]);
  });

  test.each([
    ["empty items", { ...credits, items: [] }, ".items must be a non-empty array"],
    ["missing items", { kind: "credits", durationMs: 1000 }, ".items must be a non-empty array"],
    ["names not strings", { ...credits, items: [{ names: [1] }] }, ".items[0].names must be an array of strings"],
    ["role not a string", { ...credits, items: [{ role: 3, names: ["A"] }] }, ".items[0].role must be a string"],
    ["durationMs 0", { ...credits, durationMs: 0 }, ".durationMs must be a finite number > 0"],
    ["durationMs missing", { kind: "credits", items: [{ names: ["A"] }] }, ".durationMs must be a finite number > 0"],
    ["area off the stage", { ...credits, area: { x: 0.5, y: 0.2, w: 0.6, h: 0.5 } }, ".area must lie within 0–1 with positive size"],
    ["area zero height", { ...credits, area: { x: 0, y: 0, w: 1, h: 0 } }, ".area must lie within 0–1 with positive size"],
    ["area negative", { ...credits, area: { x: -0.1, y: 0, w: 0.5, h: 0.5 } }, ".area must lie within 0–1 with positive size"],
    ["area NaN", { ...credits, area: { x: NaN, y: 0, w: 0.5, h: 0.5 } }, ".area must lie within 0–1 with positive size"],
    ["fade above 1", { kind: "screen_fade", to: 1.2 }, ".to must be 0–1"],
    ["fade missing to", { kind: "screen_fade" }, ".to must be 0–1"],
    ["fade negative duration", { kind: "screen_fade", to: 1, durationMs: -5 }, ".durationMs must be a finite number ≥ 0"],
    ["fade colour not a string", { kind: "screen_fade", to: 1, color: 0 }, ".color must be a string"],
    ["text particle rate 0", { kind: "text", value: "Hi", in: "fade", particles: { rate: 0 } }, ".particles.rate must be 1–30"],
    ["credits particle rate 31", { ...credits, particles: { rate: 31 } }, ".particles.rate must be 1–30"],
    ["particles not an object", { kind: "text", value: "Hi", in: "fade", particles: true }, ".particles must be an object"],
  ])("rejects %s", (_n, action, frag) => {
    const r = validateDeckDoc(deckWith(action));
    expect(r.ok).toBe(false);
    expect(r.errors.some((m) => m.startsWith(AT) && m.includes(frag)), r.errors.join("\n")).toBe(true);
  });
});
```
- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/unit/credits-action.test.ts`
- [ ] **Step 3: Implement.**
  - **`types.ts:68`:** `import type { NoteColor, StoryAsset } from "./story-assets";`
  - **`types.ts`, after `Framing` (line 117):**
```ts
/** Note particles off a text line or credit lines (sub-project 6). `color`: a NoteColor name
 *  (NOTE_TINTS[c].fill) or any CSS hex, default "cream"; `rate`: notes/sec, 1–30, default 6;
 *  `rise`: travel-distance multiplier, default 1. */
export interface TextParticles { color?: NoteColor | string; rate?: number; rise?: number }
/** One credit: an optional role line, then one line per name. */
export interface CreditItem { role?: string; names: string[] }
/** The credits roll's clip area on the stage, 0–1 (top-left x/y, size w/h). */
export interface CreditsArea { x: number; y: number; w: number; h: number }
```
  - **The text action (line 128):** append `; particles?: TextParticles` before the closing `}`.
  - **The Action union, before `| { kind: "reveal_again" };`:**
```ts
  // Credits roll (sub-project 6): one block in the fixed text layer, clipped to `area` (default
  // {0.2, 0.32, 0.6, 0.63}) with soft edges, rolling linearly from just below the area to just above
  // it over durationMs (the beat waits for it). particles: notes off each credit line.
  | { kind: "credits"; items: CreditItem[]; area?: CreditsArea; durationMs: number; particles?: TextParticles }
  // Fade the whole frame to `to` (0–1) in `color` (default #000) over durationMs (default 1000;
  // 0 = cut). Occupies no beat time; the level holds across beats and scenes until the next fade.
  | { kind: "screen_fade"; to: number; color?: string; durationMs?: number }
```
  - **`beat-clock.ts` `actionDuration`:** add `case "credits": return a.durationMs / 1000;` after `case "media"`. `screen_fade` falls to `default: return 0`; extend that comment to `art / notes / nightlight / camera / screen_fade / clear / gates`.
  - **`deck-doc.ts`, after `validateCameraActions`:**
```ts
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validate credits, screen_fade, and text/credits particles (sub-project 6). */
function validateCreditsAndFades(scene: Scene, si: number, e: string[]): void {
  scene?.beats?.forEach((b, bi) => {
    b?.timeline?.forEach((a: Record<string, unknown>, ai) => {
      const at = `scenes[${si}].beats[${bi}].timeline[${ai}]`;
      if (a?.kind === "credits") {
        const items = a.items;
        if (!Array.isArray(items) || items.length === 0) e.push(`${at}.items must be a non-empty array`);
        else items.forEach((it: Record<string, unknown>, k) => {
          if (!it || typeof it !== "object") { e.push(`${at}.items[${k}] must be an object`); return; }
          if (it.role !== undefined && typeof it.role !== "string") e.push(`${at}.items[${k}].role must be a string`);
          if (!Array.isArray(it.names) || !it.names.every((n) => typeof n === "string")) e.push(`${at}.items[${k}].names must be an array of strings`);
        });
        if (!finite(a.durationMs) || a.durationMs <= 0) e.push(`${at}.durationMs must be a finite number > 0`);
        if (a.area !== undefined) {
          const r = (a.area ?? {}) as Record<string, unknown>;
          const [x, y, w, h] = [r.x, r.y, r.w, r.h];
          const ok = finite(x) && finite(y) && finite(w) && finite(h)
            && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1 + 1e-9 && y + h <= 1 + 1e-9;
          if (!ok) e.push(`${at}.area must lie within 0–1 with positive size`);
        }
      }
      if (a?.kind === "screen_fade") {
        if (!finite(a.to) || a.to < 0 || a.to > 1) e.push(`${at}.to must be 0–1`);
        if (a.durationMs !== undefined && (!finite(a.durationMs) || a.durationMs < 0)) e.push(`${at}.durationMs must be a finite number ≥ 0`);
        if (a.color !== undefined && typeof a.color !== "string") e.push(`${at}.color must be a string`);
      }
      if ((a?.kind === "text" || a?.kind === "credits") && a.particles !== undefined) {
        const p = a.particles;
        if (!p || typeof p !== "object" || Array.isArray(p)) e.push(`${at}.particles must be an object`);
        else {
          const rate = (p as Record<string, unknown>).rate;
          if (rate !== undefined && (!finite(rate) || rate < 1 || rate > 30)) e.push(`${at}.particles.rate must be 1–30`);
        }
      }
    });
  });
}
```
  - Call it in `validateDeckDoc` after `validateCameraActions(s, i, e);`.
- [ ] **Step 4: Run** the tests, `npm test` and `npx tsc --noEmit`. Any switch on `action.kind` that tsc flags gets a no-op case.
- [ ] **Step 5: Commit.** `feat(engine): credits + screen_fade actions and text particles (types, validation, timing)`

---

### Task 4: Text sprites (pure) in `note-state.ts`

**Files:**
- Modify: `engine/components/effects/note-state.ts:6-8` (imports), new exports after `circleSpritesAt` (line 156), `noteFieldStateAt` (`:189-220`)
- Test: `tests/unit/text-sprites.test.ts` (new); `tests/unit/note-state.test.ts` must pass unchanged

**Interfaces — Consumes:** `TextParticles` (Task 3). **Produces:**
```ts
export interface TextRect { x: number; y: number; w: number; h: number }          // stage fractions
export interface TextScroll { t0: number; dur: number; from: number; to: number } // linear y offset, stage-height fractions
export interface TextSource {
  key: string;   // "a3" (text action 3) or "a5.2" (credit line 2 of action 5) — informational
  idx: number;   // stable source index: seeds and keys derive from it (textSourceIdx)
  start: number; end?: number;  // beat-local birth window [start, end)
  rects: TextRect[]; color: string; rate: number; rise: number;
  scroll?: TextScroll;          // credit lines only
}
export const TEXT_SEED = 0x10000, TEXT_LIFE = 2.4, TEXT_SPREAD = 25, DEFAULT_PARTICLE_RATE = 6, DEFAULT_PARTICLE_RISE = 1;
export function textSourceIdx(actionIdx: number, line?: number): number;
export function isTextSpriteKey(key: string): boolean;
export function resolveParticleColor(c: string | undefined): string;
export function particleOpts(p: TextParticles): Pick<TextSource, "color" | "rate" | "rise">;
export function scrollOffsetAt(s: TextScroll, t: number): number;
export function textSourceEnd(timeline: Action[], index: number): number | undefined;
export function textSpritesAt(src: TextSource, srcIdx: number, t: number): NoteSpriteState[];
export function noteFieldStateAt(scene: Scene, beatIndex: number, tLocal: number, textSources?: readonly TextSource[]): NoteSpriteState[];
```

`t` is **beat-local** seconds. The spec's `elapsed` is read as beat-local time, because births are at `i / rate` with `start ≤ birth < end` on the beat axis. `srcIdx` is the stable `src.idx`, never an array position: sources appear as lines are built, and array positions would make seeds depend on how a frame was reached.

- [ ] **Step 1: Failing tests** (`tests/unit/text-sprites.test.ts`).
```ts
import { describe, expect, test } from "vitest";
import {
  EMIT_SPEED_N, MAX_SPRITES_PER_SOURCE, MAX_SPRITES_TOTAL, STAGE_ASPECT, TEXT_LIFE, TEXT_SEED,
  hash32, isTextSpriteKey, mulberry32, noteFieldStateAt, particleOpts, resolveParticleColor,
  scrollOffsetAt, textSourceEnd, textSourceIdx, textSpritesAt, type TextSource,
} from "@/engine/components/effects/note-state";
import type { Action, Scene } from "@/engine/deck/types";

const R = [{ x: 0.2, y: 0.3, w: 0.1, h: 0.05 }, { x: 0.5, y: 0.3, w: 0.2, h: 0.05 }];
const src = (over: Partial<TextSource> = {}): TextSource =>
  ({ key: "a0", idx: 0, start: 0.5, end: 2, rects: R, color: "#F6E6D7", rate: 6, rise: 1, ...over });
const born = (s: TextSource, i: number) => textSpritesAt(s, s.idx, i / s.rate).find((n) => n.key === `t${s.idx}:${i % 16}`)!;

describe("textSpritesAt", () => {
  test("births at i/rate, clipped to [start, end); each lives 2.4 s", () => {
    expect(textSpritesAt(src(), 0, 0.4)).toEqual([]);                         // before start
    expect(textSpritesAt(src(), 0, 0.5).map((n) => n.key)).toEqual(["t0:3"]); // 3/6 = start
    expect(textSpritesAt(src(), 0, 1).map((n) => n.key)).toEqual(["t0:3", "t0:4", "t0:5", "t0:6"]);
    // t = 3: births < end (i ≤ 11) and alive (i/6 > 0.6 → i ≥ 4).
    expect(textSpritesAt(src(), 0, 3).map((n) => n.key)).toEqual([4, 5, 6, 7, 8, 9, 10, 11].map((i) => `t0:${i}`));
    expect(textSpritesAt(src(), 0, 4.5)).toEqual([]);                         // every note born before end has died
    expect(textSpritesAt(src({ end: undefined }), 0, 10).length).toBe(Math.ceil(TEXT_LIFE * 6)); // no end: steady state
  });

  test("a note is born inside one of the rects, at that rect's top, from the TEXT_SEED-offset seed", () => {
    for (const i of [3, 4, 7, 11]) {
      const n = born(src(), i);
      const rnd = mulberry32(hash32(TEXT_SEED + 0, i));
      const r = R[Math.floor(rnd() * R.length)];
      expect(n.x).toBeCloseTo(r.x + rnd() * r.w, 12);
      expect(n.y).toBe(r.y);
      expect(n.x).toBeGreaterThanOrEqual(r.x);
      expect(n.x).toBeLessThanOrEqual(r.x + r.w);
    }
  });

  test("with scroll, y is the rect top shifted by the offset at the BIRTH time; the note does not follow the scroll", () => {
    const scroll = { t0: 0, dur: 10, from: 0.6, to: -0.4 };
    const at = (s: TextSource, t: number) => textSpritesAt(s, s.idx, t).find((n) => n.key === "t0:3")!;
    const shifted = src({ rects: R.map((r) => ({ ...r, y: r.y + scrollOffsetAt(scroll, 0.5) })) });
    for (const t of [0.5, 1.5, 2.6]) {
      const a = at(src({ scroll }), t), b = at(shifted, t);
      expect(a.x).toBeCloseTo(b.x, 12);
      expect(a.y).toBeCloseTo(b.y, 12);
    }
  });

  test("travel is up ± 25°, scaled by rise", () => {
    const s1 = src({ end: undefined }), s2 = src({ end: undefined, rise: 2 });
    const a = textSpritesAt(s1, 0, 2), b = textSpritesAt(s2, 0, 2);
    for (let k = 0; k < a.length; k++) {
      const i = Number(a[k].key.split(":")[1]);
      const n0 = born(s1, i);
      const dx = a[k].x - n0.x, dy = a[k].y - n0.y;
      if (dx === 0 && dy === 0) continue;
      const deg = (Math.atan2(dx, -dy / STAGE_ASPECT) * 180) / Math.PI;
      expect(Math.abs(deg)).toBeLessThanOrEqual(25 + 1e-9);
      expect(b[k].x - n0.x).toBeCloseTo(2 * dx, 12);
      expect(b[k].y - n0.y).toBeCloseTo(2 * dy, 12);
      expect(Math.hypot(dx, dy / STAGE_ASPECT)).toBeLessThanOrEqual(EMIT_SPEED_N * TEXT_LIFE * 1.2 + 1e-12);
    }
  });

  test("per-source cap; deterministic; nothing for rate 0 or no rects", () => {
    const fast = src({ rate: 200, start: 0, end: undefined });
    const many = textSpritesAt(fast, 0, 5);
    expect(many.length).toBe(MAX_SPRITES_PER_SOURCE);
    expect(new Set(many.map((n) => n.key)).size).toBe(MAX_SPRITES_PER_SOURCE);
    expect(textSpritesAt(src(), 0, 1.3)).toEqual(textSpritesAt(src(), 0, 1.3));
    expect(textSpritesAt(src({ rate: 0 }), 0, 1)).toEqual([]);
    expect(textSpritesAt(src({ rects: [] }), 0, 1)).toEqual([]);
  });
});

describe("noteFieldStateAt with text sources", () => {
  const emitter: Action = { kind: "note_emitter", color: "#fff", pos: { x: 0.5, y: 0.5 }, dir: 0, decay: 1000, freq: 4 };
  const scene: Scene = { id: "s", beats: [{ id: "b", timeline: [emitter, { kind: "wait", ms: 5000 }] }] };

  test("no text sources = exactly today's output", () => {
    expect(noteFieldStateAt(scene, 0, 1.2, [])).toEqual(noteFieldStateAt(scene, 0, 1.2));
  });

  test("text sprites are appended; their keys never collide with emitter keys", () => {
    const out = noteFieldStateAt(scene, 0, 1.2, [src({ idx: textSourceIdx(0) }), src({ idx: textSourceIdx(1) })]);
    const emit = out.filter((n) => !isTextSpriteKey(n.key)), text = out.filter((n) => isTextSpriteKey(n.key));
    expect(emit).toEqual(noteFieldStateAt(scene, 0, 1.2));
    expect(text.length).toBeGreaterThan(0);
    for (const n of emit) expect(n.key).toMatch(/^\d+:\d+$/);
    for (const n of text) expect(n.key).toMatch(/^t\d+:\d+$/);
    expect(new Set(out.map((n) => n.key)).size).toBe(out.length);
  });

  test("the total cap drops whole trailing sources", () => {
    const fast = (k: number) => src({ idx: textSourceIdx(k), rate: 200, start: 0, end: undefined });
    const plain: Scene = { id: "p", beats: [{ id: "b", timeline: [{ kind: "wait", ms: 9000 }] }] };
    const out = noteFieldStateAt(plain, 0, 5, [fast(0), fast(1), fast(2)]);
    expect(out.length).toBe(MAX_SPRITES_TOTAL);
    expect(out.some((n) => n.key.startsWith(`t${textSourceIdx(2)}:`))).toBe(false);
  });
});

describe("helpers", () => {
  test("textSourceIdx: text action i → i<<12; credit line k → (i<<12)+1+k", () => {
    expect(textSourceIdx(0)).toBe(0);
    expect(textSourceIdx(3)).toBe(3 << 12);
    expect(textSourceIdx(3, 0)).toBe((3 << 12) + 1);
    expect(new Set([textSourceIdx(0), textSourceIdx(0, 0), textSourceIdx(1), textSourceIdx(1, 4)]).size).toBe(4);
  });
  test("resolveParticleColor / particleOpts", () => {
    expect(resolveParticleColor("cyan")).toBe("#3FFBFF");
    expect(resolveParticleColor(undefined)).toBe("#F6E6D7");
    expect(resolveParticleColor("#123456")).toBe("#123456");
    expect(particleOpts({})).toEqual({ color: "#F6E6D7", rate: 6, rise: 1 });
    expect(particleOpts({ color: "lime", rate: 12, rise: 1.5 })).toEqual({ color: "#E3F84F", rate: 12, rise: 1.5 });
  });
  test("scrollOffsetAt is linear and clamped", () => {
    const s = { t0: 1, dur: 4, from: 0.4, to: -0.8 };
    expect(scrollOffsetAt(s, 0)).toBeCloseTo(0.4, 12);
    expect(scrollOffsetAt(s, 3)).toBeCloseTo(-0.2, 12);
    expect(scrollOffsetAt(s, 9)).toBeCloseTo(-0.8, 12);
  });
  test("textSourceEnd: the first clear / fade_out / stop_notes after the line", () => {
    const tl: Action[] = [
      { kind: "text", value: "A", in: "fade" }, { kind: "wait", ms: 500 }, { kind: "stop_notes" },
      { kind: "wait", ms: 500 }, { kind: "clear" }, { kind: "text", value: "B", in: "fade" },
    ];
    expect(textSourceEnd(tl, 0)).toBeCloseTo(1.3, 12);
    expect(textSourceEnd(tl, 5)).toBeUndefined();
  });
});
```
- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/unit/text-sprites.test.ts`
- [ ] **Step 3: Implement** in `note-state.ts`.
  - **Imports:**
```ts
import type { Action, Scene, TextParticles } from "@/engine/deck/types";
import { NOTE_GLYPHS, NOTE_TINTS, type NoteColor, type NoteGlyph } from "@/engine/deck/story-assets";
```
  - **After `circleSpritesAt`:**
```ts
/** One measured word box, in 0–1 stage fractions. */
export interface TextRect { x: number; y: number; w: number; h: number }
/** A source's linear vertical offset over beat time (credit lines), in stage-height fractions. */
export interface TextScroll { t0: number; dur: number; from: number; to: number }
/** A text line (or credit line) that emits notes off its words (spec §2). Times are beat-local. */
export interface TextSource {
  /** Identity of the emitting line ("a3", or "a5.2" for credit line 2 of action 5); informational. */
  key: string;
  /** Stable source index (textSourceIdx): seeds and pool keys derive from it, so they never depend
   *  on which lines happen to be measured, or in what order. */
  idx: number;
  start: number;
  end?: number;
  rects: TextRect[];
  color: string;
  rate: number;
  rise: number;
  scroll?: TextScroll;
}

/** Text seeds start here: TEXT_SEED + idx never equals an emitter's per-scene srcIdx. */
export const TEXT_SEED = 0x10000;
export const TEXT_LIFE = 2.4;
export const TEXT_SPREAD = 25;
export const DEFAULT_PARTICLE_RATE = 6;
export const DEFAULT_PARTICLE_RISE = 1;
export const DEFAULT_PARTICLE_COLOR: NoteColor = "cream";
const EPS = 1e-9;

/** Text action i → i << 12; credit line k of action i → (i << 12) + 1 + k (k < 4095). */
export function textSourceIdx(actionIdx: number, line?: number): number {
  return (actionIdx << 12) + (line === undefined ? 0 : 1 + line);
}
/** Text-particle pool keys are `t${idx}:${slot}`; emitter/ring keys start with a digit. */
export const isTextSpriteKey = (key: string): boolean => key.startsWith("t");

export function resolveParticleColor(c: string | undefined): string {
  const k = c ?? DEFAULT_PARTICLE_COLOR;
  return Object.prototype.hasOwnProperty.call(NOTE_TINTS, k) ? NOTE_TINTS[k as NoteColor].fill : k;
}
export function particleOpts(p: TextParticles): Pick<TextSource, "color" | "rate" | "rise"> {
  return { color: resolveParticleColor(p.color), rate: p.rate ?? DEFAULT_PARTICLE_RATE, rise: p.rise ?? DEFAULT_PARTICLE_RISE };
}

export function scrollOffsetAt(s: TextScroll, t: number): number {
  const p = s.dur <= 0 ? 1 : clamp01((t - s.t0) / s.dur);
  return s.from + (s.to - s.from) * p;
}

const SOURCE_ENDERS = new Set<Action["kind"]>(["clear", "fade_out", "stop_notes"]);
/** Beat-local start of the first clear / fade_out / stop_notes after `index`, if any. */
export function textSourceEnd(timeline: Action[], index: number): number | undefined {
  const w = beatTimeline(timeline);
  for (let k = index + 1; k < w.length; k++) if (SOURCE_ENDERS.has(w[k].action.kind)) return w[k].start;
  return undefined;
}

/** Live note sprites off one text source at beat-local time `t` (spec §2). Same bounce, travel and
 *  fade curves as emitterSpritesAt, with dir 0 ± TEXT_SPREAD and a TEXT_LIFE lifetime. */
export function textSpritesAt(src: TextSource, srcIdx: number, t: number): NoteSpriteState[] {
  const rate = src.rate;
  if (!(rate > 0) || src.rects.length === 0 || t < src.start) return [];
  const D = TEXT_LIFE;
  const P = Math.min(Math.ceil(D * rate) + 1, MAX_SPRITES_PER_SOURCE);
  const first = Math.ceil(src.start * rate - EPS);                                         // birth ≥ start
  let last = Math.floor(t * rate + EPS);                                                    // birth ≤ t
  if (src.end !== undefined) last = Math.min(last, Math.ceil(src.end * rate - EPS) - 1);   // birth < end
  const iMin = Math.max(first, Math.floor((t - D) * rate) + 1, last - P + 1);              // alive, newest P
  const tIn = Math.min(0.4, D * 0.4);
  const fadeStart = 0.6 * D;
  const fadeSpan = 0.4 * D;

  const out: NoteSpriteState[] = [];
  for (let i = iMin; i <= last; i++) {
    const birth = i / rate;
    const age = t - birth;
    const rnd = mulberry32(hash32(TEXT_SEED + srcIdx, i));
    const r = src.rects[Math.min(src.rects.length - 1, Math.floor(rnd() * src.rects.length))];
    const x0 = r.x + rnd() * r.w;
    const y0 = r.y + (src.scroll ? scrollOffsetAt(src.scroll, birth) : 0);
    const spread = (rnd() * 2 - 1) * TEXT_SPREAD;
    const mult = 0.8 + rnd() * 0.4;
    const theta = (spread * Math.PI) / 180;
    const dist = EMIT_SPEED_N * D * mult * src.rise;

    const bounce = backOut2(clamp01(age / tIn));
    let opacity = clamp01(bounce);
    if (age >= fadeStart) opacity *= 1 - powerIn1(clamp01((age - fadeStart) / fadeSpan));
    const travel = powerOut1(clamp01(age / D));

    out.push({
      key: `t${srcIdx}:${i % P}`,
      x: x0 + Math.sin(theta) * dist * travel,
      y: y0 - Math.cos(theta) * dist * STAGE_ASPECT * travel,
      scale: 0.4 + 0.6 * bounce,
      opacity,
      hex: src.color,
      glyph: randomGlyph(i),
    });
  }
  return out;
}
```
  - **`noteFieldStateAt`:** change the signature to `(scene: Scene, beatIndex: number, tLocal: number, textSources?: readonly TextSource[])`. Replace the final `const out …; for … ; return out;` block with:
```ts
  const out: NoteSpriteState[] = [];
  // Total cap drops whole trailing sources (text sources come last), so one runaway source cannot
  // blank a scene's rings mid-source.
  let full = false;
  const add = (sprites: NoteSpriteState[]) => {
    if (full || out.length + sprites.length > MAX_SPRITES_TOTAL) { full = true; return; }
    out.push(...sprites);
  };
  for (const s of sources) {
    add(s.kind === "emitter" ? emitterSpritesAt(s.action, s.srcIdx, elapsedOf(s)) : circleSpritesAt(s.action, s.srcIdx, elapsedOf(s)));
  }
  for (const src of textSources ?? []) add(textSpritesAt(src, src.idx, tLocal));
  return out;
```
- [ ] **Step 4: Run** the new tests, `tests/unit/note-state.test.ts`, `tests/unit/note-field.test.tsx`, `tests/unit/note-parity.test.tsx`, the pure-import-graph test, `npm test` and tsc. Expect PASS, with the existing note tests unchanged.
- [ ] **Step 5: Commit.** `feat(engine): pure text-particle sprites (textSpritesAt; noteFieldStateAt takes text sources)`

---

### Task 5: Credits roll math (pure)

**Files:**
- Create: `engine/deck/credits.ts`, `tests/unit/credits-roll.test.ts`
- Modify: `tests/unit/pure-import-graph.test.ts` (both lists)

**Interfaces — Consumes:** `TextScroll` and `scrollOffsetAt` (Task 4), `CreditItem` and `CreditsArea` (Task 3). **Produces:**
```ts
export const DEFAULT_CREDITS_AREA: CreditsArea;  // { x: 0.2, y: 0.32, w: 0.6, h: 0.63 }
export const CREDITS_ROLE_FS = 0.02, CREDITS_ROLE_LH = 0.036, CREDITS_NAME_FS = 0.034, CREDITS_NAME_LH = 0.05, CREDITS_GAP = 0.03; // × stage height
export function creditsOffset(t: number, durationMs: number, blockH: number, areaH: number): number; // t: seconds since the roll started
export function creditsScroll(t0: number, durationMs: number, blockH: number, areaH: number): TextScroll;
export function creditLineWindow(lineTop: number, area: Pick<CreditsArea, "y" | "h">, s: TextScroll): { start: number; end: number } | null;
export function estimateCreditsBlockH(items: CreditItem[]): number; // stage-height fraction
```

`lineTop` is the line's top in stage fractions with the roll at offset 0 (block top = area top). Its top at time t is `lineTop + offset(t)`. The line emits while that top is in `[area.y, area.y + area.h)`.

- [ ] **Step 1: Failing tests.**
```ts
import { expect, test } from "vitest";
import {
  CREDITS_GAP, CREDITS_NAME_LH, CREDITS_ROLE_LH, DEFAULT_CREDITS_AREA,
  creditLineWindow, creditsOffset, creditsScroll, estimateCreditsBlockH,
} from "@/engine/deck/credits";
import { scrollOffsetAt } from "@/engine/components/effects/note-state";

test("the default area", () => {
  expect(DEFAULT_CREDITS_AREA).toEqual({ x: 0.2, y: 0.32, w: 0.6, h: 0.63 });
});

test("creditsOffset: areaH at the start, −blockH at the end, linear and clamped", () => {
  expect(creditsOffset(0, 4000, 300, 200)).toBe(200);
  expect(creditsOffset(4, 4000, 300, 200)).toBe(-300);
  expect(creditsOffset(2, 4000, 300, 200)).toBe(-50);
  expect(creditsOffset(-1, 4000, 300, 200)).toBe(200);
  expect(creditsOffset(9, 4000, 300, 200)).toBe(-300);
  expect(creditsOffset(1, 4000, 300, 200) - creditsOffset(0, 4000, 300, 200))
    .toBeCloseTo(creditsOffset(3, 4000, 300, 200) - creditsOffset(2, 4000, 300, 200), 12);
  expect(creditsOffset(0, 0, 300, 200)).toBe(-300);
});

test("creditsScroll agrees with creditsOffset at every t (one formula for paint and particles)", () => {
  const s = creditsScroll(1, 4000, 0.5, 0.63);
  expect(s).toEqual({ t0: 1, dur: 4, from: 0.63, to: -0.5 });
  for (const t of [0, 1, 1.7, 3, 5, 8]) expect(scrollOffsetAt(s, t)).toBeCloseTo(creditsOffset(t - 1, 4000, 0.5, 0.63), 12);
});

test("creditLineWindow: from the top edge entering the area's bottom to it leaving the area's top", () => {
  const area = { y: 0.32, h: 0.63 };
  const s = { t0: 1, dur: 10, from: 0.63, to: -0.5 };      // k = −0.113 per second
  const w = creditLineWindow(0.42, area, s)!;              // a line 0.1 below the block top
  expect(w.start).toBeCloseTo(1 + 0.1 / 0.113, 9);
  expect(w.end).toBeCloseTo(1 + 0.73 / 0.113, 9);
  const yAt = (t: number) => 0.42 + scrollOffsetAt(s, t);
  expect(yAt(w.start)).toBeCloseTo(0.95, 9);               // enters at the area's bottom
  expect(yAt(w.end)).toBeCloseTo(0.32, 9);                 // leaves at the area's top
});

test("creditLineWindow: the first line enters at once; clipped to the roll; null when not moving up", () => {
  const area = { y: 0.32, h: 0.63 };
  const s = { t0: 2, dur: 4, from: 0.63, to: -0.2 };
  expect(creditLineWindow(0.32, area, s)!.start).toBeCloseTo(2, 12);
  const lastLine = creditLineWindow(0.32 + 0.2, area, s)!; // its top only reaches 0.32 + 0.2 − 0.2 = area.y at the end
  expect(lastLine.end).toBeCloseTo(6, 9);
  expect(creditLineWindow(0.4, area, { t0: 0, dur: 4, from: 0.2, to: 0.2 })).toBeNull();
  expect(creditLineWindow(0.4, area, { t0: 0, dur: 0, from: 0.63, to: -0.2 })).toBeNull();
});

test("estimateCreditsBlockH sums role lines, name lines and item gaps", () => {
  expect(estimateCreditsBlockH([{ role: "Dir", names: ["A"] }, { names: ["B", "C"] }]))
    .toBeCloseTo(CREDITS_ROLE_LH + CREDITS_NAME_LH + CREDITS_GAP + 2 * CREDITS_NAME_LH, 12);
  expect(estimateCreditsBlockH([{ role: "", names: ["A"] }])).toBeCloseTo(CREDITS_NAME_LH, 12); // an empty role draws no line
  expect(estimateCreditsBlockH([])).toBe(0);
});
```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `engine/deck/credits.ts`.
```ts
/** Credits roll geometry as pure functions (timed-video sub-project 6). Pure: no DOM — enforced by
 *  tests/unit/pure-import-graph.test.ts. Sizes are fractions of the 16:9 stage HEIGHT: the roll's
 *  DOM (engine/components/credits-block.ts) and lint's speed estimate both read them. */
import type { CreditItem, CreditsArea } from "@/engine/deck/types";
import type { TextScroll } from "@/engine/components/effects/note-state";

export const DEFAULT_CREDITS_AREA: CreditsArea = { x: 0.2, y: 0.32, w: 0.6, h: 0.63 };
export const CREDITS_ROLE_FS = 0.02;
export const CREDITS_ROLE_LH = 0.036;
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
```
  - **The pure-import-graph test:** add `"engine/deck/credits.ts",` to both `test.each` lists.
- [ ] **Step 4: Run** the tests, the pure-import-graph test, `npm test` and tsc.
- [ ] **Step 5: Commit.** `feat(engine): pure credits roll math (offset, line windows, height estimate)`

---

### Task 6: `parseCredits` / `formatCredits` (pure)

**Files:**
- Create: `lib/editor/credits-text.ts`, `tests/unit/credits-text.test.ts`
- Modify: `tests/unit/pure-import-graph.test.ts` (DOM list)

**Interfaces — Produces:**
```ts
export function parseCredits(text: string): CreditItem[];
export function formatCredits(items: CreditItem[]): string;
```

The rules:
- `Role: Name, Name` parses to `{ role, names }`.
- A line with no colon parses to `{ names: [line] }`.
- Blank lines are ignored.
- An empty role (a leading `:`) means no role. So `formatCredits` writes a role-less item as `: A, B` whenever it has other than one name, or its one name contains `:`. That keeps the round trip exact.

- [ ] **Step 1: Failing tests.**
```ts
import { expect, test } from "vitest";
import { formatCredits, parseCredits } from "@/lib/editor/credits-text";

test("parse: Role: Name, Name; a line with no colon is one name; blank lines are ignored", () => {
  expect(parseCredits("Directed by: Ann Lee\n\n  Music:  Bo Chen ,Cy Diaz \nThanks for watching, everyone\n")).toEqual([
    { role: "Directed by", names: ["Ann Lee"] },
    { role: "Music", names: ["Bo Chen", "Cy Diaz"] },
    { names: ["Thanks for watching, everyone"] },
  ]);
});

test("parse: an empty role means none; a trailing comma or a bare role drops empty names", () => {
  expect(parseCredits(": A, B")).toEqual([{ names: ["A", "B"] }]);
  expect(parseCredits("Cast: A, ")).toEqual([{ role: "Cast", names: ["A"] }]);
  expect(parseCredits("Special thanks:")).toEqual([{ role: "Special thanks", names: [] }]);
  expect(parseCredits("   \n\n")).toEqual([]);
});

test("format writes one line per item", () => {
  expect(formatCredits([{ role: "Music", names: ["Bo", "Cy"] }, { names: ["Thanks"] }])).toBe("Music: Bo, Cy\nThanks");
});

test("round trip: parse(format(items)) === items, role-less multi-name and colon names included", () => {
  const items = [
    { role: "Directed by", names: ["Ann Lee"] },
    { names: ["A", "B"] },
    { names: ["Time: 3:10"] },
    { role: "Special thanks", names: [] },
    { names: [] },
    { names: ["Solo"] },
  ];
  expect(parseCredits(formatCredits(items))).toEqual(items);
  const text = "Directed by: Ann Lee\nMusic: Bo Chen, Cy Diaz\nThanks";
  expect(formatCredits(parseCredits(text))).toBe(text);
});
```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
```ts
/** The Credits "Entries" textarea format (sub-project 6): one credit per line, `Role: Name, Name`;
 *  a line with no colon is one name; blank lines are ignored. Pure (no DOM). */
import type { CreditItem } from "@/engine/deck/types";

export function parseCredits(text: string): CreditItem[] {
  const out: CreditItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const c = line.indexOf(":");
    if (c < 0) { out.push({ names: [line] }); continue; }
    const role = line.slice(0, c).trim();
    const names = line.slice(c + 1).split(",").map((n) => n.trim()).filter(Boolean);
    out.push(role ? { role, names } : { names });
  }
  return out;
}

export function formatCredits(items: CreditItem[]): string {
  return items.map((it) => {
    const names = it.names.join(", ");
    if (it.role) return `${it.role}: ${names}`;
    // Role-less: a bare line parses back as ONE name with no colon, so anything else gets a leading ":".
    return it.names.length === 1 && !it.names[0].includes(":") ? names : `: ${names}`;
  }).join("\n");
}
```
  - Add `"lib/editor/credits-text.ts",` to the pure-import-graph DOM list.
- [ ] **Step 4: Run** the tests, `npm test` and tsc.
- [ ] **Step 5: Commit.** `feat(editor): credits entries parse/format (round-trip)`

---

### Task 7: Fade clock (pure)

**Files:**
- Create: `engine/authoring/fade-clock.ts`, `tests/unit/fade-clock.test.ts`
- Modify: `tests/unit/pure-import-graph.test.ts` (both lists)

**Interfaces — Produces:**
```ts
export const FADE_DEFAULT_MS = 1000;
export const FADE_DEFAULT_COLOR = "#000";
export interface FadeEvent { start: number; duration: number; to: number; color: string }
export interface FadeState { level: number; color: string }
export function fadeEvents(doc: DeckDoc): FadeEvent[];
export function fadeAt(events: FadeEvent[], T: number): FadeState;
```

- [ ] **Step 1: Failing tests.**
```ts
import { expect, test } from "vitest";
import { FADE_DEFAULT_COLOR, fadeAt, fadeEvents, type FadeEvent } from "@/engine/authoring/fade-clock";
import type { Action } from "@/engine/deck/types";
import type { DeckDoc } from "@/engine/deck-doc";

const deck = (scenes: DeckDoc["scenes"]): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes });
const fade = (to: number, durationMs?: number, color?: string): Action =>
  ({ kind: "screen_fade", to, ...(durationMs !== undefined ? { durationMs } : {}), ...(color ? { color } : {}) });
const wait = (ms: number): Action => ({ kind: "wait", ms });
const ev = (start: number, duration: number, to: number, color = "#000"): FadeEvent => ({ start, duration, to, color });

test("fadeEvents: deck-time starts across beats and scenes, defaults 1000 ms and #000", () => {
  const d = deck([
    { id: "s0", beats: [{ id: "a", timeline: [wait(1000)] }, { id: "b", timeline: [wait(500), fade(1)] }] },
    { id: "s1", beats: [{ id: "c", timeline: [fade(0.5, 0, "#fff"), wait(100)] }] },
  ]);
  expect(fadeEvents(d)).toEqual([ev(1.5, 1, 1), ev(1.5, 0, 0.5, "#fff")]);
});

test("fadeEvents: the reach rule — a fade past a pinned scene's cut is never reached", () => {
  expect(fadeEvents(deck([{ id: "s", durationSec: 1, beats: [{ id: "a", timeline: [wait(2000), fade(1)] }] }]))).toEqual([]);
});

test("fadeAt: none → level 0, #000; linear; holds after the end, across scenes", () => {
  expect(fadeAt([], 5)).toEqual({ level: 0, color: FADE_DEFAULT_COLOR });
  const e = [ev(2, 1, 1)];
  expect(fadeAt(e, 1.9).level).toBe(0);
  expect(fadeAt(e, 2.5).level).toBeCloseTo(0.5, 12);
  expect(fadeAt(e, 30).level).toBe(1);
  const d = deck([
    { id: "s0", beats: [{ id: "a", timeline: [fade(1, 500), wait(1000)] }] },
    { id: "s1", beats: [{ id: "b", timeline: [wait(1000)] }] },
    { id: "s2", beats: [{ id: "c", timeline: [wait(1000)] }] },
  ]);
  expect(fadeAt(fadeEvents(d), 2.5).level).toBe(1);
});

test("fadeAt: an interrupting fade continues from the level in effect (no jump)", () => {
  const e = [ev(0, 2, 1), ev(1, 1, 0)];
  expect(fadeAt(e, 1 - 1e-9).level).toBeCloseTo(0.5, 6);
  expect(fadeAt(e, 1).level).toBeCloseTo(0.5, 12);
  expect(fadeAt(e, 1.5).level).toBeCloseTo(0.25, 12);
  expect(fadeAt(e, 2).level).toBe(0);
});

test("fadeAt: 0 ms is a cut; the colour switches at a fade's start", () => {
  expect(fadeAt([ev(1, 0, 0.7)], 1).level).toBe(0.7);
  const e = [ev(0, 1, 1), ev(2, 1, 0.5, "#fff")];
  expect(fadeAt(e, 1.9)).toEqual({ level: 1, color: "#000" });
  expect(fadeAt(e, 2)).toEqual({ level: 1, color: "#fff" });
  expect(fadeAt(e, 2.5).level).toBeCloseTo(0.75, 12);
});
```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
```ts
/** Screen fade as a pure function of deck time (timed-video sub-project 6). Pure: no DOM, GSAP or
 *  React — enforced by tests/unit/pure-import-graph.test.ts. The nightlight model (art-clock's
 *  nightEvents/nightAt): each fade is linear from the level in effect when it starts, and the level
 *  holds across beats and scenes until the next fade. */
import type { DeckDoc } from "@/engine/deck-doc";
import { deckLayout } from "./deck-clock";
import { beatTimeline } from "./beat-clock";
import { clamp01 } from "./art-clock";

export const FADE_DEFAULT_MS = 1000;
export const FADE_DEFAULT_COLOR = "#000";
export interface FadeEvent { start: number; duration: number; to: number; color: string } // seconds
export interface FadeState { level: number; color: string }

/** Every reached screen_fade in deck order (same reach rule as nightEvents: nothing past a pinned
 *  scene's cut). */
export function fadeEvents(doc: DeckDoc): FadeEvent[] {
  const out: FadeEvent[] = [];
  for (const s of deckLayout(doc).scenes) {
    const scene = doc.scenes[s.sceneIdx];
    const reached = (localStart: number) => !s.pinned || localStart < s.length;
    for (const b of s.beats) {
      if (!reached(b.start)) continue;
      for (const w of beatTimeline(scene.beats[b.beatIdx].timeline)) {
        if (w.action.kind !== "screen_fade" || !reached(b.start + w.start)) continue;
        const a = w.action;
        out.push({ start: s.start + b.start + w.start, duration: (a.durationMs ?? FADE_DEFAULT_MS) / 1000, to: clamp01(a.to), color: a.color ?? FADE_DEFAULT_COLOR });
      }
    }
  }
  return out;
}

/** The fade at deck time T. The colour is the latest started fade's (it switches at its start). */
export function fadeAt(events: FadeEvent[], T: number): FadeState {
  let level = 0;
  let color = FADE_DEFAULT_COLOR;
  for (let i = 0; i < events.length && events[i].start <= T; i++) {
    const e = events[i];
    const until = i + 1 < events.length && events[i + 1].start <= T ? events[i + 1].start : T;
    const p = e.duration <= 0 ? 1 : clamp01((until - e.start) / e.duration);
    level = level + (e.to - level) * p;
    color = e.color;
  }
  return { level, color };
}
```
  - Add `"engine/authoring/fade-clock.ts",` to both pure-import-graph lists.
- [ ] **Step 4: Run** the tests, the pure-import-graph test, `npm test` and tsc.
- [ ] **Step 5: Commit.** `feat(engine): pure fade clock (fadeEvents/fadeAt)`

---

### Task 8: `hasNoteSources` (the render gate covers text particles)

**Files:**
- Modify: `engine/authoring/camera-clock.ts:81-86`, `components/player/RenderStage.tsx:8,43`, `tests/unit/camera-clock.test.ts:3,183-202`

**Interfaces — Produces:** `export function hasNoteSources(doc: DeckDoc): boolean`, which replaces `hasNoteActions`. It is renamed in place in `camera-clock.ts`, where the spec and deep-dive locate it.

- [ ] **Step 1: Failing tests.** In `camera-clock.test.ts`:
  - rename the import and the `describe("hasNoteActions")` to `hasNoteSources`, and replace every `hasNoteActions(` call;
  - add:
```ts
  test("a text or credits action with particles counts; without particles it does not", () => {
    const line = (particles?: object): Action => ({ kind: "text", value: "Hi", in: "fade", ...(particles ? { particles } : {}) }) as Action;
    expect(hasNoteSources(deck([{ id: "s", beats: [{ id: "a", timeline: [line({ rate: 6 })] }] }]))).toBe(true);
    expect(hasNoteSources(deck([{ id: "s", beats: [{ id: "a", timeline: [line({})] }] }]))).toBe(true);
    expect(hasNoteSources(deck([{ id: "s", beats: [{ id: "a", timeline: [line()] }] }]))).toBe(false);
    const credits = (particles?: object): Action => ({ kind: "credits", items: [{ names: ["A"] }], durationMs: 1000, ...(particles ? { particles } : {}) }) as Action;
    expect(hasNoteSources(deck([{ id: "s", beats: [{ id: "a", timeline: [credits({ color: "lime" })] }] }]))).toBe(true);
    expect(hasNoteSources(deck([{ id: "s", beats: [{ id: "a", timeline: [credits()] }] }]))).toBe(false);
  });
```
- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/unit/camera-clock.test.ts`
- [ ] **Step 3: Implement.**
```ts
/** Whether any beat emits note particles: a `note_emitter` / `note_circle`, or a `text` / `credits`
 *  action with `particles` (sub-project 6). Note sprites animate their own scale, so — like a camera
 *  deck — such a deck needs a full raster per frame in /render to be the same stepped or jumped
 *  (RenderStage's full-raster gate). The reach rule is ignored on purpose: the gate only has to be safe. */
export function hasNoteSources(doc: DeckDoc): boolean {
  return doc.scenes.some((s) => s.beats.some((b) => b.timeline.some((a) =>
    a.kind === "note_emitter" || a.kind === "note_circle" || ((a.kind === "text" || a.kind === "credits") && !!a.particles))));
}
```
  - `RenderStage.tsx:8` becomes `import { cameraEvents, hasNoteSources } from "@/engine/authoring/camera-clock";`, and `:43` becomes `const hasNotes = useMemo(() => hasNoteSources(doc), [doc]);`.
  - `grep -rn hasNoteActions engine components lib tests` must return nothing.
- [ ] **Step 4: Run** the camera-clock and render-stage tests, `npm test` and tsc.
- [ ] **Step 5: Commit.** `feat(render): full-raster gate covers text/credits particles (hasNoteSources)`

---

### Task 9: CinematicSlide draw rendering

**Files:**
- Modify: `engine/components/effects/cinematic-anim.ts` (add `drawIn`); `engine/components/layouts/CinematicSlide.tsx` (imports `:17-22`, a new `appendDrawLine` after `appendText` `:343-363`, `buildTextEffect` `:627-640`, `buildText` `:644-661`, the `<style>` block `:1048-1184`)
- Test: `tests/unit/draw-text.test.tsx` (new)

**Interfaces — Consumes:** `DRAW_VARIANT`, `drawDuration`, `drawGlyphAt`, `drawSweepAt`, `drawText`, `DRAW_DASH_EM` and `DRAW_STROKE_EM` (Task 2). **Produces:**
```ts
// cinematic-anim.ts
export function drawIn(el: HTMLElement, chars: number, speed?: number): gsap.core.Timeline; // paused-seekable; paints --d/--f/--s per tspan (--sweep on the svg for "mask")
// The DOM of a draw line, which Task 10 measures:
// <p class="cin__line cin__line--{size} cin__line--draw" aria-label>
//   <span class="cin__draw-wrap"><span class="cin__draw-ghost">text</span>
//     <svg class="cin__draw[ cin__draw--mask]"><text><tspan>c</tspan>…</text></svg></span></p>
```

The timeline tweens a proxy clock. Its `onUpdate` writes per-glyph CSS custom properties from `drawGlyphAt`. The stroke and fill state is therefore a pure function of `t`, and jsdom can check it (jsdom keeps custom properties but drops unknown SVG properties).

- [ ] **Step 1: Failing tests** (`tests/unit/draw-text.test.tsx`).
```tsx
import { afterEach, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { CinematicSlide, type CinematicRuntime, type SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import { DRAW_VARIANT, drawGlyphAt, drawSweepAt } from "@/engine/components/effects/draw-state";
import type { Action, Beat } from "@/engine/deck/types";

afterEach(cleanup);
const runtime = { art() {}, applyArt() {}, setNightlight() {}, onGate() {}, revealArrows() {}, pulseArrow() {}, onWaiting() {}, resolveEntry: () => [], resolveEnd: () => [], jumpTo() {} } as CinematicRuntime;
const r4 = (n: number) => String(Math.round(n * 1e4) / 1e4);

function mount(timeline: Action[], instantText = false) {
  const transport = createRef<SlideTransport>();
  const beat: Beat = { id: "d", timeline: [...timeline, { kind: "wait", ms: 1000 }] };
  const { container } = render(<CinematicSlide slots={{ sceneId: "s", beat }} animate runtime={runtime} transport={transport} autoplay={false} instantText={instantText} />);
  return { transport, container };
}

test("a draw line is an SVG <text> with one <tspan> per character over a hidden HTML ghost", () => {
  const { transport, container } = mount([{ kind: "text", value: "Hi you", in: "draw", size: "md", align: "center" }]);
  transport.current!.seek(0.09);
  const p = container.querySelector<HTMLElement>(".cin__line--draw")!;
  expect(p.classList.contains("cin__line--md")).toBe(true);
  expect(p.style.textAlign).toBe("center");
  expect(p.getAttribute("aria-label")).toBe("Hi you");
  expect(p.querySelector(".cin__draw-ghost")!.textContent).toBe("Hi you");
  const spans = Array.from(p.querySelectorAll(".cin__draw tspan")).map((t) => t.textContent);
  expect(spans).toEqual(["H", "i", " ", "y", "o", "u"]);
  expect(p.querySelector(".cin__draw")!.getAttribute("aria-hidden")).toBe("true");
});

test("seek paints each glyph from drawGlyphAt (in-flight) and the settled end state", () => {
  const { transport, container } = mount([{ kind: "text", value: "Hi you", in: "draw" }]);
  const glyphs = () => Array.from(container.querySelectorAll<SVGElement>(".cin__draw tspan"));
  const svg = () => container.querySelector<SVGElement>(".cin__draw")!;
  for (const t of [0, 0.09, 0.3, 0.7, 0.9]) {
    transport.current!.seek(t);
    glyphs().forEach((g, i) => {
      const s = drawGlyphAt(i, 6, t);
      if (DRAW_VARIANT === "dash") expect(g.style.getPropertyValue("--d"), `t=${t} i=${i}`).toBe(r4(s.dash));
      expect(g.style.getPropertyValue("--f")).toBe(r4(s.fill));
      expect(g.style.getPropertyValue("--s")).toBe(r4(s.stroke));
    });
    if (DRAW_VARIANT === "mask") expect(svg().style.getPropertyValue("--sweep")).toBe(r4(drawSweepAt(6, t)));
  }
  transport.current!.seek(1.5); // past introDuration 0.98: settled
  for (const g of glyphs()) {
    if (DRAW_VARIANT === "dash") expect(g.style.getPropertyValue("--d")).toBe("0");
    expect(g.style.getPropertyValue("--f")).toBe("1");
    expect(g.style.getPropertyValue("--s")).toBe("0");
  }
  transport.current!.seek(0.09); // backward: the same values as a fresh seek to 0.09
  expect(glyphs()[0].style.getPropertyValue("--f")).toBe("0");
});

test("Review Focus #5: inline markup, append, instantText, dots and an empty value fall back without an SVG", () => {
  const cases: Action[][] = [
    [{ kind: "text", value: "**Bold** words", in: "draw" }],
    [{ kind: "text", value: "Start", in: "fade" }, { kind: "text", value: " more", in: "draw", append: true }],
    [{ kind: "text", value: "Hello there...", in: "draw", dots: true }],
    [{ kind: "text", value: "", in: "draw" }],
  ];
  for (const tl of cases) {
    const { transport, container } = mount(tl);
    expect(() => transport.current!.seek(3)).not.toThrow();
    if (tl.some((a) => a.kind === "text" && (a.append || a.value.includes("**")))) expect(container.querySelector(".cin__draw")).toBeNull();
    cleanup();
  }
  const inst = mount([{ kind: "text", value: "Instant", in: "draw" }], true);
  inst.transport.current!.seek(0.1);
  expect(inst.container.querySelector(".cin__draw")).toBeNull();
  expect(inst.container.querySelector(".cin__line")!.textContent).toBe("Instant");
});
```
- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/unit/draw-text.test.tsx`
- [ ] **Step 3: Implement.**
  - **`cinematic-anim.ts` (append):**
```ts
import { DRAW_VARIANT, drawDuration, drawGlyphAt, drawSweepAt } from "./draw-state";

const r4 = (n: number) => String(Math.round(n * 1e4) / 1e4);

/** "draw": trace each glyph's outline, then fill (spec §1). A paused-seekable timeline over a proxy
 *  clock; every frame paints the per-glyph state from the pure drawGlyphAt as CSS custom properties
 *  (--d dash fraction, --f fill-opacity, --s stroke-opacity; --sweep on the svg for "mask"), which
 *  CinematicSlide's CSS turns into stroke-dashoffset / fill-opacity / stroke-opacity / mask-image.
 *  `chars` is the line's value.length, so the timing matches introDuration exactly. */
export function drawIn(el: HTMLElement, chars: number, speed = 1): gsap.core.Timeline {
  const svg = el.querySelector<SVGSVGElement>(".cin__draw");
  const glyphs = svg ? Array.from(svg.querySelectorAll<SVGTSpanElement>("tspan")) : [];
  const clock = { t: 0 };
  const paint = () => {
    if (DRAW_VARIANT === "mask") svg?.style.setProperty("--sweep", r4(drawSweepAt(chars, clock.t, speed)));
    glyphs.forEach((g, i) => {
      const s = drawGlyphAt(i, chars, clock.t, speed);
      if (DRAW_VARIANT === "dash") g.style.setProperty("--d", r4(s.dash));
      g.style.setProperty("--f", r4(s.fill));
      g.style.setProperty("--s", r4(s.stroke));
    });
  };
  paint();
  const D = drawDuration(chars, speed);
  return gsap.timeline().to(clock, { t: D, duration: D, ease: "none", onUpdate: paint });
}
```
  - **CinematicSlide imports:** add `drawIn` to the `../effects/cinematic-anim` import and `import { DRAW_DASH_EM, DRAW_STROKE_EM, DRAW_VARIANT, drawText } from "../effects/draw-state";`.
  - **CinematicSlide, a new function after `appendText`:**
```ts
  const SVG_NS = "http://www.w3.org/2000/svg";
  /** A "draw" line (spec §1): a hidden HTML ghost of the text reserves the line's layout, so boxes,
   *  alignment and `pos` behave exactly as for an HTML line, and an inline SVG <text> over it holds
   *  one <tspan> per glyph for drawIn to trace. One row: newlines become spaces (drawText). */
  function appendDrawLine(host: HTMLElement, a: Extract<Action, { kind: "text" }>): HTMLElement {
    const text = drawText(a.value);
    const p = document.createElement("p");
    p.className = `cin__line cin__line--${a.size ?? "lg"} cin__line--draw${a.tone === "dark" ? " cin__line--dark" : ""}`;
    if (a.align) p.style.textAlign = a.align;
    p.setAttribute("aria-label", text);
    const wrap = document.createElement("span");
    wrap.className = "cin__draw-wrap";
    const ghost = document.createElement("span");
    ghost.className = "cin__draw-ghost";
    ghost.textContent = text;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", DRAW_VARIANT === "mask" ? "cin__draw cin__draw--mask" : "cin__draw");
    svg.setAttribute("aria-hidden", "true");
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", "0");
    t.setAttribute("y", "0.075em"); // the HTML line box's half-leading at line-height 1.15
    t.setAttribute("dominant-baseline", "text-before-edge");
    for (const ch of Array.from(text)) {
      const span = document.createElementNS(SVG_NS, "tspan");
      span.textContent = ch;
      t.appendChild(span);
    }
    svg.appendChild(t);
    wrap.append(ghost, svg);
    p.appendChild(wrap);
    host.appendChild(p);
    currentLine.current = p;
    return p;
  }
```
  - **`buildTextEffect`:** add `effIn === "draw" ? drawIn(el, a.value.length, a.speed) :` as the first branch of the conditional chain.
  - **`buildText`:** replace the `perPiece` / `effIn` / `el` lines with:
```ts
    const perPiece: TextIn[] = ["letterFly", "letterUp", "wordUp", "blurIn", "typewriter", "cursive", "draw"];
    // Markup, and inline `append` fragments, cannot be drawn glyph-by-glyph: they reveal with "fade".
    const effIn: TextIn = (hasInlineMarkup(a.value) && perPiece.includes(a.in)) || (a.append && a.in === "draw") ? "fade" : a.in;
    const instant = !!(instantText && !a.reveal);
    let box: HTMLElement | undefined;
    const parent = () => (a.pos ? (box = makeLineBox(a.pos, a.align)) : host);
    // An instant draw line renders as a plain HTML line (no entrance to trace).
    const el = a.append
      ? appendFragment(a.value)
      : effIn === "draw" && !instant
        ? appendDrawLine(parent(), a)
        : appendText(parent(), a.value, a.size, a.align, a.dots, instant, a.tone);
```
    Keep the rest of `buildText` unchanged.
  - **`<style>`, after the `.cin__line--cursive` rule:**
```ts
        /* "draw" lines (sub-project 6): the ghost reserves layout; the SVG over it is traced. */
        .cin__line--draw { position: relative; }
        .cin__draw-wrap { position: relative; display: inline-block; white-space: pre; }
        .cin__draw-ghost { visibility: hidden; }
        .cin__draw { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
        .cin__draw text { fill: currentColor; stroke: currentColor; stroke-width: ${DRAW_STROKE_EM}em; white-space: pre; }
        .cin__draw tspan { stroke-dasharray: ${DRAW_DASH_EM}em; stroke-dashoffset: calc(var(--d, 1) * ${DRAW_DASH_EM}em);
          fill-opacity: var(--f, 0); stroke-opacity: var(--s, 1); }
        .cin__draw--mask { -webkit-mask-image: linear-gradient(90deg, #000 calc(var(--sweep, 0) * 108% - 8%), transparent calc(var(--sweep, 0) * 108%));
          mask-image: linear-gradient(90deg, #000 calc(var(--sweep, 0) * 108% - 8%), transparent calc(var(--sweep, 0) * 108%)); }
        .cin__draw--mask tspan { stroke-dasharray: none; stroke-dashoffset: 0; }
```
- [ ] **Step 4: Run** the test, `tests/unit/slide-render-at.test.tsx`, `tests/unit/camera-world.test.tsx`, `npm test` and tsc.
- [ ] **Step 5: Commit.** `feat(engine): "draw" text style — SVG outline stroke then fill, seekable`

---

### Task 10: Text sources (word boxes, `sourcesReady`, `.notefield__text`)

**Files:**
- Create: `engine/components/text-sources.ts`, `tests/unit/text-sources.test.tsx`
- Modify:
  - `engine/components/NoteField.tsx:10-14,40-82`;
  - `engine/authoring/BeatStage.tsx` (refs, `paint`, markup);
  - `engine/components/layouts/CinematicSlide.tsx`:
    - `SlideTransport` `:81-89`;
    - `Props` `:91-125`;
    - the refs near `:164`;
    - the beat setup `:205-311`;
    - `appendText` `:343-363`;
    - `buildText`;
    - `resetFrom` `:667-689`;
    - the end of `renderAt` `:921-930`;
    - `useImperativeHandle` `:1008`.

**Interfaces — Consumes:** `TextSource`, `TextRect`, `textSourceIdx`, `textSourceEnd`, `particleOpts` and `isTextSpriteKey` (Task 4); `drawText` and `wordRuns` (Task 2); the draw DOM (Task 9). **Produces:**
```ts
// text-sources.ts (DOM)
export const WORD_CLASS = "cin__mw";
export function wrapWords(root: HTMLElement): void;
export function htmlLineRects(el: HTMLElement, fill: (clone: HTMLElement) => void, sr: DOMRect): TextRect[];
export function drawLineRects(el: HTMLElement, text: string, sr: DOMRect): TextRect[];
export function creditLineRects(block: HTMLElement, line: HTMLElement, sr: DOMRect): TextRect[];
// CinematicSlide
interface SlideTransport { …; sourcesReady(): Promise<void> }
// Props gain: textSourcesRef?: React.MutableRefObject<TextSource[]>
// NoteField
interface NoteFieldHandle { renderAt(scene: Scene, beatIndex: number, t: number, textSources?: readonly TextSource[]): void }
// NoteField props gain: textHost?: React.RefObject<HTMLElement | null>
```

**Measurement rule.** Boxes are measured **at rest**, from layout offsets (`offsetLeft`/`offsetTop`, which ignore transforms) plus the host's rect. A reveal effect's transforms (flyUp, letterFly…) never reach the boxes. An HTML line is measured on a hidden clone (same classes, width and alignment, words wrapped in `.cin__mw`), so SplitText's state does not matter.

Measurement runs once per **layout change** (a line built, or anything wiped), after `document.fonts.ready`. It is never per frame. It measures every built particle line, so a frame reached by stepping and the same frame reached by jumping measure the same DOM.

After measuring, the slide re-notifies the host with `onTime(lastT)`. It does not re-run `renderAt`, which would re-sync clip videos.

- [ ] **Step 1: Failing tests** (`tests/unit/text-sources.test.tsx`).
```tsx
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { CinematicSlide, type CinematicRuntime, type SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import { NoteField, type NoteFieldHandle } from "@/engine/components/NoteField";
import { BeatStage } from "@/engine/authoring/BeatStage";
import { htmlLineRects, wrapWords } from "@/engine/components/text-sources";
import { textSourceIdx, type TextSource } from "@/engine/components/effects/note-state";
import type { Beat, Scene } from "@/engine/deck/types";

const runtime = { art() {}, applyArt() {}, setNightlight() {}, onGate() {}, revealArrows() {}, pulseArrow() {}, onWaiting() {}, resolveEntry: () => [], resolveEnd: () => [], jumpTo() {} } as CinematicRuntime;
const STAGE = { left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON() {} } as DOMRect;
beforeEach(() => { vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(STAGE); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete (document as unknown as { fonts?: unknown }).fonts; });

// Line 0 has particles; line 1 does not; a clear at 2.1 s ends line 0's births and wipes both.
const beat: Beat = { id: "b", timeline: [
  { kind: "text", value: "Hello world", in: "fade", particles: { color: "cyan" } },
  { kind: "text", value: "Plain", in: "fade" },
  { kind: "wait", ms: 500 }, { kind: "clear" }, { kind: "wait", ms: 500 },
] };
function mount(b: Beat = beat) {
  const transport = createRef<SlideTransport>();
  const sources = { current: [] as TextSource[] };
  const onTime = vi.fn();
  const r = render(<CinematicSlide slots={{ sceneId: "s", beat: b }} animate runtime={runtime} transport={transport} autoplay={false} textSourcesRef={sources} onTime={onTime} />);
  return { ...r, transport, sources, onTime };
}
const ready = (tr: React.RefObject<SlideTransport | null>) => act(async () => { await tr.current!.sourcesReady(); });

test("wrapWords wraps each non-space run (nested markup too) and keeps whitespace", () => {
  const el = document.createElement("p");
  el.innerHTML = "Hello  <strong>big</strong> world";
  wrapWords(el);
  expect(Array.from(el.querySelectorAll(".cin__mw")).map((w) => w.textContent)).toEqual(["Hello", "big", "world"]);
  expect(el.textContent).toBe("Hello  big world");
});

test("htmlLineRects: one box per word from layout offsets, on a clone that is removed again", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const p = document.createElement("p");
  p.textContent = "Hello world";
  host.appendChild(p);
  const word = (el: HTMLElement, a: number, b: number) => (el.classList.contains("cin__mw") ? (el.textContent === "Hello" ? a : b) : 0);
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) { return word(this, 10, 70); });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return word(this, 50, 50); });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return word(this, 20, 20); });
  expect(htmlLineRects(p, (c) => { c.textContent = "Hello world"; }, STAGE))
    .toEqual([{ x: 0.01, y: 0, w: 0.05, h: 0.04 }, { x: 0.07, y: 0, w: 0.05, h: 0.04 }]);
  expect(host.children).toHaveLength(1);
  host.remove();
});

test("a particle line publishes one source after sourcesReady; a line without particles publishes none", async () => {
  const { transport, sources } = mount();
  act(() => transport.current!.seek(1.7));
  await ready(transport);
  expect(sources.current).toHaveLength(1);
  const s = sources.current[0];
  expect(s).toMatchObject({ key: "a0", idx: textSourceIdx(0), start: 0, color: "#3FFBFF", rate: 6, rise: 1 });
  expect(s.end).toBeCloseTo(2.1, 9);
  expect(s.rects).toHaveLength(2);
  expect(s.scroll).toBeUndefined();
});

test("measuring re-notifies the host with the same t; a settled-but-unchanged frame does not re-measure", async () => {
  const { transport, onTime } = mount();
  act(() => transport.current!.seek(1.7));
  const before = onTime.mock.calls.length;
  await ready(transport);
  expect(onTime.mock.calls.length).toBe(before + 1);
  expect(onTime.mock.calls.at(-1)![0]).toBe(1.7);
  act(() => transport.current!.seek(1.8)); // nothing built or wiped
  await ready(transport);
  expect(onTime.mock.calls.length).toBe(before + 2); // the seek's own onTime only
});

test("Review Focus #4: after the clear, the wiped line's source is gone — stepped or jumped", async () => {
  const stepped = mount();
  for (const t of [0.5, 1.2, 1.7, 2.3]) act(() => stepped.transport.current!.seek(t));
  await ready(stepped.transport);
  expect(stepped.sources.current).toEqual([]);
  cleanup();
  const jumped = mount();
  act(() => jumped.transport.current!.seek(2.3));
  await ready(jumped.transport);
  expect(jumped.sources.current).toEqual([]);
});

test("Review Focus #1: a beat swap while a measurement is pending never publishes the old beat's sources", async () => {
  let release!: () => void;
  Object.defineProperty(document, "fonts", { value: { ready: new Promise<void>((r) => { release = r; }) }, configurable: true });
  const { transport, sources, rerender } = mount();
  act(() => transport.current!.seek(1.7));           // queues beat b's measurement behind fonts.ready
  const other: Beat = { id: "c", timeline: [{ kind: "text", value: "No notes here", in: "fade" }, { kind: "wait", ms: 500 }] };
  rerender(<CinematicSlide slots={{ sceneId: "s", beat: other }} animate runtime={runtime} transport={transport} autoplay={false} textSourcesRef={sources} />);
  release();
  await ready(transport);
  await act(async () => { await Promise.resolve(); });
  expect(sources.current).toEqual([]);
});

test("NoteField paints text-keyed sprites into textHost and emitter sprites into its own stage", () => {
  const ref = createRef<NoteFieldHandle>();
  const hostRef = createRef<HTMLDivElement>();
  render(<><NoteField ref={ref} textHost={hostRef} /><div ref={hostRef} className="notefield__text" /></>);
  const scene: Scene = { id: "s", beats: [{ id: "b", timeline: [{ kind: "note_emitter", color: "#fff", pos: { x: 0.5, y: 0.5 }, dir: 0, decay: 1000, freq: 4 }, { kind: "wait", ms: 2000 }] }] };
  const src: TextSource = { key: "a0", idx: textSourceIdx(0), start: 0, rects: [{ x: 0.1, y: 0.2, w: 0.1, h: 0.05 }], color: "#3FFBFF", rate: 6, rise: 1 };
  act(() => ref.current!.renderAt(scene, 0, 1, [src]));
  expect(hostRef.current!.children.length).toBeGreaterThan(0);
  expect(document.querySelector(".notefield__stage")!.children.length).toBeGreaterThan(0);
});

test("BeatStage: .notefield__text is in the fixed stack — outside both worlds, z 2, after them and before the text", () => {
  const scene: Scene = { id: "s", beats: [beat] };
  const { container } = render(<BeatStage sceneId="s" beat={beat} scene={scene} beatIndex={0} autoplay={false} art={false} contained
    camera={{ events: [{ start: 0, duration: 0, to: { zoom: 2 }, ease: "linear" }], beatStart: 0 }} />);
  const nt = container.querySelector<HTMLElement>(".notefield__text")!;
  expect(nt.closest(".beat__world")).toBeNull();
  const wrap = nt.parentElement!;
  expect(wrap.style.zIndex).toBe("2");
  const worlds = container.querySelectorAll<HTMLElement>(".beat__world");
  expect(worlds[1].compareDocumentPosition(wrap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(wrap.compareDocumentPosition(container.querySelector(".cin")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(worlds[0].style.transform).toContain("scale(2)");
  for (let n: HTMLElement | null = nt; n && n !== container; n = n.parentElement) expect(["", "none"]).toContain(n.style.transform);
});
```
- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/unit/text-sources.test.tsx`
- [ ] **Step 3: Implement.**
  - **`engine/components/text-sources.ts`:**
```ts
/** Word-box measurement for text-particle sources (sub-project 6). Every box is measured AT REST:
 *  from layout offsets (offsetLeft/offsetTop ignore transforms) plus the host's rect, so a line's
 *  reveal effect (flyUp, letterFly…) or a credits roll's translateY never moves its boxes. Results
 *  are 0–1 fractions of the stage rect `sr`. */
import type { TextRect } from "@/engine/components/effects/note-state";
import { wordRuns } from "@/engine/components/effects/draw-state";

export const WORD_CLASS = "cin__mw";

/** Wrap every non-space run of `root`'s text nodes (nested markup included) in a span.cin__mw. */
export function wrapWords(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  for (const t of texts) {
    if (!/\S/.test(t.data)) continue;
    const frag = document.createDocumentFragment();
    for (const part of t.data.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
      const span = document.createElement("span");
      span.className = WORD_CLASS;
      span.textContent = part;
      frag.appendChild(span);
    }
    t.replaceWith(frag);
  }
}

const norm = (x: number, y: number, w: number, h: number, sr: DOMRect): TextRect =>
  ({ x: (x - sr.left) / sr.width, y: (y - sr.top) / sr.height, w: w / sr.width, h: h / sr.height });

/** An HTML line's word boxes, measured on a hidden clone at the line's layout position (same
 *  classes, width and alignment; `fill` writes the line's content into it). The clone is removed. */
export function htmlLineRects(el: HTMLElement, fill: (clone: HTMLElement) => void, sr: DOMRect): TextRect[] {
  const host = el.parentElement;
  if (!host) return [];
  const hr = host.getBoundingClientRect();
  const clone = document.createElement("div");
  clone.className = el.className;
  clone.setAttribute("aria-hidden", "true");
  Object.assign(clone.style, {
    position: "absolute", visibility: "hidden", pointerEvents: "none", margin: "0",
    left: `${el.offsetLeft}px`, top: `${el.offsetTop}px`, width: `${el.clientWidth}px`, textAlign: el.style.textAlign,
  });
  fill(clone);
  wrapWords(clone);
  host.appendChild(clone);
  const ox = hr.left + host.clientLeft + el.offsetLeft;
  const oy = hr.top + host.clientTop + el.offsetTop;
  const rects = Array.from(clone.querySelectorAll<HTMLElement>(`.${WORD_CLASS}`))
    .map((w) => norm(ox + w.offsetLeft, oy + w.offsetTop, w.offsetWidth, w.offsetHeight, sr));
  clone.remove();
  return rects;
}

/** A "draw" line's word boxes from its SVG glyph geometry (getExtentOfChar, user space = CSS px
 *  from the svg's top-left, which sits on the ghost's .cin__draw-wrap). */
export function drawLineRects(el: HTMLElement, text: string, sr: DOMRect): TextRect[] {
  const host = el.parentElement;
  const wrap = el.querySelector<HTMLElement>(".cin__draw-wrap");
  const t = el.querySelector<SVGTextElement>(".cin__draw text");
  if (!host || !wrap || !t || typeof t.getExtentOfChar !== "function") return [];
  const hr = host.getBoundingClientRect();
  const ox = hr.left + host.clientLeft + el.offsetLeft + wrap.offsetLeft;
  const oy = hr.top + host.clientTop + el.offsetTop + wrap.offsetTop;
  const out: TextRect[] = [];
  for (const [a, b] of wordRuns(text)) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = a; k < b; k++) {
      const r = t.getExtentOfChar(k);
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.width); y1 = Math.max(y1, r.y + r.height);
    }
    if (x1 > x0 && y1 > y0) out.push(norm(ox + x0, oy + y0, x1 - x0, y1 - y0, sr));
  }
  return out;
}

/** One credit line's word boxes with the roll at offset 0 (its block top-left): word offsets are
 *  relative to the absolutely positioned roll, whose own translateY they ignore. */
export function creditLineRects(block: HTMLElement, line: HTMLElement, sr: DOMRect): TextRect[] {
  const br = block.getBoundingClientRect();
  return Array.from(line.querySelectorAll<HTMLElement>(`.${WORD_CLASS}`))
    .map((w) => norm(br.left + block.clientLeft + w.offsetLeft, br.top + block.clientTop + w.offsetTop, w.offsetWidth, w.offsetHeight, sr));
}
```
  - **`NoteField.tsx`:**
    - import `isTextSpriteKey, type TextSource` from `./effects/note-state`;
    - the handle becomes `renderAt(scene: Scene, beatIndex: number, t: number, textSources?: readonly TextSource[]): void;`;
    - `interface Props { reduced?: boolean; textHost?: React.RefObject<HTMLElement | null> }`, and the component destructures `{ reduced, textHost }`;
    - in `renderAt`, call `noteFieldStateAt(scene, beatIndex, t, textSources)` and append new nodes with `(isTextSpriteKey(s.key) ? (textHost?.current ?? host) : host).appendChild(node);`;
    - the `useImperativeHandle` deps are `[reduced, textHost]`;
    - add this CSS after `.notefield__stage`:
```css
        /* Text particles (sub-project 6): BeatStage's fixed .notefield__text, the same 16:9 letterbox. */
        .notefield__text { position: absolute; inset: 0; margin: auto;
          width: min(100cqw, calc(100cqh * 16 / 9)); height: min(100cqh, calc(100cqw * 9 / 16)); }
```
  - **`BeatStage.tsx`:**
    - import `type TextSource` from `@/engine/components/effects/note-state`;
    - add `const noteText = useRef<HTMLDivElement>(null);` and `const textSources = useRef<TextSource[]>([]);`;
    - in `paint`: `notes.current?.renderAt(scene, beatIndex, t, textSources.current);`;
    - in the markup:
      - `<NoteField ref={notes} reduced={false} textHost={noteText} />`;
      - after the objects world, before the CinematicSlide wrapper:
```tsx
      {/* Text particles (sub-project 6): FIXED, never the camera — text never moves (sub-5), so its notes
          stay on its words through a camera move. z 2 after the notes world (above emitter notes), before
          the text wrapper (below the text). */}
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2, overflow: "hidden" }}>
        <div className="notefield__text" ref={noteText} />
      </div>
```
      - pass `textSourcesRef={textSources}` to `<CinematicSlide>`.
  - **CinematicSlide:**
    - Imports: `textSourceEnd, textSourceIdx, particleOpts, type TextSource` from `@/engine/components/effects/note-state`; `drawLineRects, htmlLineRects` from `@/engine/components/text-sources`.
    - `SlideTransport` gains:
```ts
  /** Resolves once this beat's text-particle word boxes (and credit block heights) for the current
   *  DOM are measured and the host re-notified (spec §2 "Readiness"). /render awaits it per frame. */
  sourcesReady(): Promise<void>;
```
    - `Props` gains:
```ts
  /** Where measured text-particle sources are published (BeatStage hands NoteField them). Written on
   *  each layout change, after document.fonts.ready; never per frame. */
  textSourcesRef?: React.MutableRefObject<TextSource[]>;
```
      Destructure it in the signature.
    - Refs, next to `lastT`:
```ts
  // Text-source measurement (sub-project 6). layoutRev bumps on every build/wipe; a renderAt that sees
  // it ahead of measuredRev queues one measurement behind fonts.ready. measureGen invalidates a
  // measurement queued by a previous beat (or before unmount).
  const layoutRev = useRef(0);
  const measuredRev = useRef(-1);
  const measureGen = useRef(0);
  const measureQueued = useRef(false);
  const pendingSources = useRef<Promise<void>>(Promise.resolve());
```
    - **Beat setup** (in `useGSAP`, after `lastT.current = 0;`):
```ts
    measureGen.current++;
    measureQueued.current = false;
    layoutRev.current++;
    pendingSources.current = Promise.resolve();
    if (textSourcesRef) textSourcesRef.current = [];
```
      Add `measureGen.current++;` to both cleanup returns (the static one and the non-static one), before `pause()`.
    - **Extract `lineContent` from `appendText`.** `appendText` keeps its signature and calls `lineContent(p, value, dots, instant)` in place of its `if (dots) {…} else {…}` block.
```ts
  /** Fill a line element with `value` exactly as appendText does (dots split, inline markup). */
  function lineContent(p: HTMLElement, value: string, dots?: boolean, instant = false) {
    if (dots) {
      const { line } = lineAndDots(value);
      p.textContent = line + " ";
      const span = document.createElement("span");
      span.className = "dots";
      span.innerHTML = '<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>';
      if (instant) span.style.opacity = "0";
      p.appendChild(span);
    } else {
      renderLineContent(p, value);
    }
  }
```
    - **`buildText`:** add `layoutRev.current++;` as its first statement.
    - **`resetFrom`:** add `layoutRev.current++;` inside the loop, after `built.current.delete(i);`.
    - **New functions after `paintCamera`:**
```ts
  /** Queue one measurement of the current DOM behind fonts.ready (coalesced). */
  function scheduleMeasure() {
    measuredRev.current = layoutRev.current;
    if (measureQueued.current) return;
    measureQueued.current = true;
    const gen = measureGen.current;
    const fonts = typeof document !== "undefined" && document.fonts ? document.fonts.ready : Promise.resolve();
    pendingSources.current = Promise.resolve(fonts).then(() => {
      if (gen !== measureGen.current || !scope.current) return; // a newer beat (or unmount) owns the ref now
      measureQueued.current = false;
      publishSources();
      onTime?.(lastT.current); // the host repaints notes with the new sources at the same t
    });
  }

  /** Measure every built particle line (at rest) and publish the sources (spec §2). */
  function publishSources() {
    const timeline = slots.beat.timeline;
    const windows = beatTimeline(timeline);
    const sr = scope.current?.querySelector<HTMLElement>(".cin__stage")?.getBoundingClientRect();
    const out: TextSource[] = [];
    for (const i of [...built.current.keys()].sort((x, y) => x - y)) {
      const entry = built.current.get(i)!;
      const a = timeline[i];
      if (!textSourcesRef || !sr || !(sr.width > 0 && sr.height > 0)) continue;
      if (a?.kind !== "text" || !a.particles || a.append) continue;
      const rects = entry.el.querySelector(".cin__draw")
        ? drawLineRects(entry.el, drawText(a.value), sr)
        : htmlLineRects(entry.el, (c) => lineContent(c, a.value, a.dots, true), sr);
      if (rects.length) out.push({ key: `a${i}`, idx: textSourceIdx(i), start: windows[i].start, end: textSourceEnd(timeline, i), rects, ...particleOpts(a.particles) });
    }
    if (textSourcesRef) textSourcesRef.current = out;
  }
```
    - **At the end of `renderAt`,** before `onTime?.(t);`: `if (layoutRev.current !== measuredRev.current) scheduleMeasure();`.
    - **`useImperativeHandle(transport, …)`:** `({ seek, play, pause, duration, sourcesReady: () => pendingSources.current })`.
- [ ] **Step 4: Run** the new tests, `tests/unit/camera-world.test.tsx`, `tests/unit/beatstage-autoplay.test.tsx`, `tests/unit/note-field.test.tsx`, `tests/unit/note-parity.test.tsx`, `tests/unit/deck-stage.test.tsx`, `npm test` and tsc. Then run `E2E` with `e2e/render-page.spec.ts e2e/notes.spec.ts e2e/beatstage.spec.ts e2e/play.spec.ts`. These must pass unchanged (Review Focus #2).
- [ ] **Step 5: Commit.** `feat(engine): text-particle sources — at-rest word boxes, sourcesReady, fixed .notefield__text`

---

### Task 11: The credits block (`/play`, `/render`, and the editor canvas)

**Files:**
- Create: `engine/components/credits-block.ts`, `tests/unit/credits-block.test.tsx`
- Modify:
  - `engine/components/layouts/CinematicSlide.tsx`: the `built` type `:164`; the fold loop after `if (f.index < wipeBoundary) continue;` `:874`; `publishSources`; the measurement repaint in `scheduleMeasure`.
  - `engine/authoring/seek.ts:49-84`.

**Interfaces — Consumes:** Tasks 5 and 10. **Produces:**
```ts
export interface CreditsBlock { block: HTMLElement; roll: HTMLElement; lines: HTMLElement[] }
export function buildCreditsBlock(a: Extract<Action, { kind: "credits" }>): CreditsBlock;
// DOM: div.cin__credits (area, overflow hidden, edge mask) > div.cin__credits-roll (translateY) >
//      div.cin__credits-item > div.cin__credits-role | div.cin__credits-name (> span.cin__mw words)
```

The credits block is fixed text-layer content. It is appended to `.cin__stage` and tracked in `lineBoxes`. A `fade_out` therefore fades it, and a `clear` or a settled `fade_out` removes it, exactly like text. `blockH` and `areaH` are measured synchronously at build and again by each measurement pass (after fonts).

- [ ] **Step 1: Failing tests** (`tests/unit/credits-block.test.tsx`).
```tsx
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { CinematicSlide, type CinematicRuntime, type SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import { buildCreditsBlock } from "@/engine/components/credits-block";
import { renderBeatAt } from "@/engine/authoring/seek";
import { textSourceIdx, type TextSource } from "@/engine/components/effects/note-state";
import type { Action, Beat } from "@/engine/deck/types";

const runtime = { art() {}, applyArt() {}, setNightlight() {}, onGate() {}, revealArrows() {}, pulseArrow() {}, onWaiting() {}, resolveEntry: () => [], resolveEnd: () => [], jumpTo() {} } as CinematicRuntime;
const STAGE = { left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON() {} } as DOMRect;
type Credits = Extract<Action, { kind: "credits" }>;
const credits: Credits = { kind: "credits", items: [{ role: "Directed by", names: ["Ann Lee"] }, { names: ["Bo Chen", "Cy Diaz"] }], durationMs: 4000 };
beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(STAGE);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("cin__credits-roll") ? 400 : 0; });
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) { return this.classList.contains("cin__credits") ? 200 : 0; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
// (watchStyle — paste from Global Constraints)

function mount(timeline: Action[], withSources = false) {
  const transport = createRef<SlideTransport>();
  const sources = { current: [] as TextSource[] };
  const beat: Beat = { id: "c", timeline };
  const { container } = render(<CinematicSlide slots={{ sceneId: "s", beat }} animate runtime={runtime} transport={transport} autoplay={false} textSourcesRef={withSources ? sources : undefined} />);
  return { transport, container, sources };
}
const roll = (c: HTMLElement) => c.querySelector<HTMLElement>(".cin__credits-roll");

test("buildCreditsBlock: area box, edge mask, role then name lines with wrapped words, gaps after the first item", () => {
  const { block, lines } = buildCreditsBlock({ ...credits, area: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 } });
  expect([block.style.left, block.style.top, block.style.width, block.style.height]).toEqual(["10%", "20%", "50%", "60%"]);
  expect(block.style.overflow).toBe("hidden");
  expect(lines.map((l) => [l.className, l.textContent])).toEqual([
    ["cin__credits-role", "Directed by"], ["cin__credits-name", "Ann Lee"], ["cin__credits-name", "Bo Chen"], ["cin__credits-name", "Cy Diaz"],
  ]);
  expect(lines[1].querySelectorAll(".cin__mw")).toHaveLength(2);
  const items = block.querySelectorAll<HTMLElement>(".cin__credits-item");
  expect(items[0].style.marginTop).toBe("");
  expect(buildCreditsBlock(credits).block.style.left).toBe("20%"); // the default area
});

test("the roll lives in the fixed text stage and scrolls by creditsOffset at beat-local time, either direction", () => {
  const { transport, container } = mount([{ kind: "wait", ms: 1000 }, credits, { kind: "wait", ms: 500 }]);
  act(() => transport.current!.seek(2));                          // local 1 of 4: 200 − 600·0.25
  const block = container.querySelector<HTMLElement>(".cin__credits")!;
  expect(block.closest(".cin__stage")).not.toBeNull();
  expect(block.closest(".cin__world")).toBeNull();
  expect(roll(container)!.style.transform).toBe("translateY(50px)");
  act(() => transport.current!.seek(5));
  expect(roll(container)!.style.transform).toBe("translateY(-400px)");
  act(() => transport.current!.seek(1.5));
  expect(roll(container)!.style.transform).toBe("translateY(125px)");
  const w = watchStyle(roll(container)!, "transform");
  act(() => transport.current!.seek(1.5));
  expect(w.count()).toBe(0);                                       // written only when it changes
  w.stop();
});

test("a clear removes the block; a fade_out fades it with the text", () => {
  const a = mount([credits, { kind: "clear" }, { kind: "wait", ms: 500 }]);
  act(() => a.transport.current!.seek(4.2));
  expect(a.container.querySelector(".cin__credits")).toBeNull();
  cleanup();
  const b = mount([credits, { kind: "fade_out", durationMs: 1000 }, { kind: "wait", ms: 500 }]);
  act(() => b.transport.current!.seek(4.5));
  expect(Number(b.container.querySelector<HTMLElement>(".cin__credits")!.style.opacity)).toBeCloseTo(0.5, 6);
});

test("with particles, each credit line is a source with the roll's scroll, emitting only while its top is in the area", async () => {
  const { transport, sources } = mount([{ kind: "wait", ms: 1000 }, { ...credits, particles: { color: "lime" } }, { kind: "clear" }, { kind: "wait", ms: 100 }], true);
  act(() => transport.current!.seek(2));
  await act(async () => { await transport.current!.sourcesReady(); });
  // Stage 1000×500; area top 0 (stubbed rect), areaH 200 → 0.4; blockH 400 → 0.8. Every line's top is
  // the block top (offsets are 0 in jsdom), so each emits from t0 = 1 until it leaves the area top.
  expect(sources.current.map((s) => s.idx)).toEqual([0, 1, 2, 3].map((k) => textSourceIdx(1, k)));
  for (const s of sources.current) {
    expect(s.scroll).toEqual({ t0: 1, dur: 4, from: 0.4, to: -0.8 });
    expect(s.start).toBeCloseTo(1, 9);
    expect(s.end).toBeCloseTo(1 + 0.4 / 0.3, 9);
    expect(s.color).toBe("#E3F84F");
  }
});

test("seek.ts (editor canvas) paints the roll into the text host at the same offset", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  renderBeatAt([credits, { kind: "wait", ms: 100 }], 1, { textHost: host, art: null });
  expect(host.querySelector(".cin__credits")).not.toBeNull();
  expect(host.querySelector<HTMLElement>(".cin__credits-roll")!.style.transform).toBe("translateY(50px)");
  renderBeatAt([credits, { kind: "clear" }], 4.1, { textHost: host, art: null });
  expect(host.querySelector(".cin__credits")).toBeNull();
  host.remove();
});
```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - **`engine/components/credits-block.ts`:**
```ts
/** DOM for one credits roll (sub-project 6), shared by CinematicSlide (/play, /render) and seek.ts
 *  (the editor canvas). Inline styles only: the editor canvas never mounts CinematicSlide's <style>.
 *  Sizes are fractions of the 16:9 stage height (engine/deck/credits.ts), so lint's estimate holds. */
import type { Action } from "@/engine/deck/types";
import {
  CREDITS_GAP, CREDITS_NAME_FS, CREDITS_NAME_LH, CREDITS_ROLE_FS, CREDITS_ROLE_LH, DEFAULT_CREDITS_AREA,
} from "@/engine/deck/credits";
import { wrapWords } from "./text-sources";

export interface CreditsBlock { block: HTMLElement; roll: HTMLElement; lines: HTMLElement[] }

/** The 16:9 stage height in the nearest size container (BeatStage's root; the editor canvas host). */
const SH = "min(100cqh, calc(100cqw * 9 / 16))";
const MASK = "linear-gradient(transparent, #000 8%, #000 92%, transparent)";
const pct = (n: number) => `${n * 100}%`;

function line(cls: "cin__credits-role" | "cin__credits-name", text: string, lines: HTMLElement[]): HTMLElement {
  const el = document.createElement("div");
  el.className = cls;
  const role = cls === "cin__credits-role";
  el.style.fontSize = `calc(${SH} * ${role ? CREDITS_ROLE_FS : CREDITS_NAME_FS})`;
  el.style.lineHeight = `calc(${SH} * ${role ? CREDITS_ROLE_LH : CREDITS_NAME_LH})`;
  el.style.fontFamily = "var(--font-body)"; // spec §3: a small uppercase role line, names in the body style
  if (role) { el.style.textTransform = "uppercase"; el.style.letterSpacing = "0.12em"; el.style.opacity = "0.8"; }
  el.textContent = text;
  wrapWords(el);
  lines.push(el);
  return el;
}

export function buildCreditsBlock(a: Extract<Action, { kind: "credits" }>): CreditsBlock {
  const area = a.area ?? DEFAULT_CREDITS_AREA;
  const block = document.createElement("div");
  block.className = "cin__credits";
  Object.assign(block.style, {
    position: "absolute", left: pct(area.x), top: pct(area.y), width: pct(area.w), height: pct(area.h),
    overflow: "hidden", textAlign: "center", pointerEvents: "none",
    color: "var(--color-mm-cream)", textShadow: "0 2px 14px rgba(0,0,0,0.6)",
  });
  block.style.setProperty("mask-image", MASK);
  block.style.setProperty("-webkit-mask-image", MASK);
  const roll = document.createElement("div");
  roll.className = "cin__credits-roll";
  Object.assign(roll.style, { position: "absolute", left: "0", top: "0", width: "100%" });
  const lines: HTMLElement[] = [];
  a.items.forEach((it, k) => {
    const item = document.createElement("div");
    item.className = "cin__credits-item";
    if (k > 0) item.style.marginTop = `calc(${SH} * ${CREDITS_GAP})`;
    if (it.role) item.appendChild(line("cin__credits-role", it.role, lines));
    for (const n of it.names) item.appendChild(line("cin__credits-name", n, lines));
    roll.appendChild(item);
  });
  block.appendChild(roll);
  return { block, roll, lines };
}
```
  - **CinematicSlide.**
    - Imports: `buildCreditsBlock` from `@/engine/components/credits-block`; `creditLineRects` from `@/engine/components/text-sources`; `DEFAULT_CREDITS_AREA, creditLineWindow, creditsOffset, creditsScroll` from `@/engine/deck/credits`.
    - Types:
```ts
/** A built credits roll and its measured sizes (px): blockH = roll height, areaH = clip area height. */
interface CreditsState { block: HTMLElement; roll: HTMLElement; lines: HTMLElement[]; blockH: number; areaH: number; lastTf: string }
type BuiltEntry = { el: HTMLElement; tl: gsap.core.Timeline | null; box?: HTMLElement; credits?: CreditsState };
```
      Change the `built` ref to `useRef<Map<number, BuiltEntry>>(new Map())` and `buildText`'s return type to `BuiltEntry`.
    - Functions, next to `buildText`:
```ts
  /** Build the credits block into the fixed text stage (tracked as a line box: fade_out fades it,
   *  clear / a settled fade_out removes it, like text). Sizes are re-measured after fonts. */
  function buildCredits(a: Extract<Action, { kind: "credits" }>): BuiltEntry {
    layoutRev.current++;
    const { block, roll, lines } = buildCreditsBlock(a);
    stageParent()?.appendChild(block);
    lineBoxes.current.push(block);
    return { el: roll, tl: null, box: block, credits: { block, roll, lines, blockH: roll.offsetHeight, areaH: block.clientHeight, lastTf: "" } };
  }

  /** The roll's translateY at `local` seconds into the credits action — written only on change. */
  function paintCredits(c: CreditsState, local: number, durationMs: number) {
    const v = Math.round(creditsOffset(local, durationMs, c.blockH, c.areaH) * 100) / 100;
    const tf = `translateY(${v === 0 ? 0 : v}px)`;
    if (tf === c.lastTf) return;
    c.lastTf = tf;
    c.roll.style.transform = tf;
  }

  /** Each credit line as a text source (spec §3 "Particles"): word boxes at offset 0, the roll's
   *  scroll, and a birth window = the line's in-area window ∩ [roll start, the next clear/…). */
  function creditSources(a: Extract<Action, { kind: "credits" }>, i: number, c: CreditsState, start: number, sr: DOMRect): TextSource[] {
    const br = c.block.getBoundingClientRect();
    const area = { y: (br.top - sr.top) / sr.height, h: c.areaH / sr.height };
    const scroll = creditsScroll(start, a.durationMs, c.blockH / sr.height, area.h);
    const end = textSourceEnd(slots.beat.timeline, i) ?? Infinity;
    const opts = particleOpts(a.particles!);
    const out: TextSource[] = [];
    c.lines.forEach((ln, k) => {
      const rects = creditLineRects(c.block, ln, sr);
      if (!rects.length) return;
      const win = creditLineWindow(Math.min(...rects.map((r) => r.y)), area, scroll);
      if (!win) return;
      const s0 = Math.max(win.start, start), e0 = Math.min(win.end, end);
      if (e0 > s0) out.push({ key: `a${i}.${k}`, idx: textSourceIdx(i, k), start: s0, end: e0, rects, scroll, ...opts });
    });
    return out;
  }
```
    - **Fold loop:** directly after `if (f.index < wipeBoundary) continue;`:
```ts
      if (f.action.kind === "credits") {
        let entry = built.current.get(f.index);
        if (!entry) { entry = buildCredits(f.action); built.current.set(f.index, entry); }
        paintCredits(entry.credits!, t - f.start, f.action.durationMs);
        continue;
      }
```
    - **`publishSources`:** first, inside the loop, before the `textSourcesRef`/`sr` guard:
```ts
      if (entry.credits) {
        entry.credits.blockH = entry.credits.roll.offsetHeight;
        entry.credits.areaH = entry.credits.block.clientHeight;
        entry.credits.lastTf = ""; // repaint at the measured size
      }
```
      Then, after the guard and before the `text` check:
```ts
      if (a?.kind === "credits") { if (a.particles && entry.credits) out.push(...creditSources(a, i, entry.credits, windows[i].start, sr)); continue; }
```
      Move the `if (!textSourcesRef || !sr …) continue;` guard so it sits after the credits size refresh. Heights refresh even when the slide has no sources ref (`Slide.tsx`).
    - **`scheduleMeasure`,** after `publishSources();`: repaint the rolls at `lastT` without a re-fold:
```ts
      const windows = beatTimeline(slots.beat.timeline);
      for (const [i, entry] of built.current) {
        const a = slots.beat.timeline[i];
        if (entry.credits && a?.kind === "credits") paintCredits(entry.credits, lastT.current - windows[i].start, a.durationMs);
      }
```
  - **`seek.ts`:** add imports `import { buildCreditsBlock } from "@/engine/components/credits-block";` and `import { creditsOffset } from "@/engine/deck/credits";`. Add a case to `applyAt`:
```ts
    case "credits": {
      // Editor canvas: the same block, at the offset the beat-local progress implies.
      const { block, roll } = buildCreditsBlock(a);
      ctx.textHost.appendChild(block);
      const v = Math.round(creditsOffset(p * (a.durationMs / 1000), a.durationMs, roll.offsetHeight, block.clientHeight) * 100) / 100;
      roll.style.transform = `translateY(${v === 0 ? 0 : v}px)`;
      break;
    }
```
- [ ] **Step 4: Run** the tests, the Task 10 tests, `npm test` and tsc.
- [ ] **Step 5: Commit.** `feat(engine): credits roll in the fixed text layer (+ editor canvas), credit lines as text sources`

---

### Task 12: DeckStage fade overlay and the DeckCanvas 50% cap

**Files:**
- Create: `engine/components/fade-overlay.ts`, `tests/unit/deck-stage-fade.test.tsx`, `tests/unit/deck-canvas-fade.test.tsx`
- Modify: `components/player/DeckStage.tsx:60-134`, `components/editor/DeckCanvas.tsx:8,45-64,83,110`

**Interfaces — Consumes:** `fadeEvents` / `fadeAt` (Task 7). **Produces:**
```ts
export function paintFadeOverlay(el: HTMLElement, f: FadeState, last: string, cap?: number): string; // returns the painted key
export const CANVAS_FADE_CAP = 0.5; // DeckCanvas.tsx
```

- [ ] **Step 1: Failing tests.**
  - **`tests/unit/deck-stage-fade.test.tsx`:**
```tsx
import { afterEach, expect, test } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef, forwardRef, useImperativeHandle } from "react";
import { useDeckStage, type DeckStageHandle } from "@/components/player/DeckStage";
import { fadeAt, fadeEvents } from "@/engine/authoring/fade-clock";
import type { DeckDoc } from "@/engine/deck-doc";
import type { Scene } from "@/engine/deck/types";

afterEach(cleanup);
// (watchStyle — paste from Global Constraints)
const doc = (scenes: Scene[]): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes });
const Host = forwardRef<DeckStageHandle, { doc: DeckDoc; initialT?: number }>(function Host({ doc, initialT = 0 }, ref) {
  const { apply, T, layout, stage } = useDeckStage(doc, initialT);
  useImperativeHandle(ref, () => ({ apply, total: layout.total, current: () => T.current }), [apply, layout.total, T]);
  return <div style={{ position: "relative", width: 1920, height: 1080 }}>{stage}</div>;
});
function setup(d: DeckDoc, initialT = 0) {
  const ref = createRef<DeckStageHandle>();
  const { container } = render(<Host ref={ref} doc={d} initialT={initialT} />);
  const fade = () => container.querySelector<HTMLElement>(".deck__fade")!;
  return { container, fade, apply: (t: number) => act(() => { ref.current!.apply(t); }) };
}
// Fade to black over 1–3 s in scene 0; scene 1 (from 4 s) has no fade action.
const FADED = doc([
  { id: "s0", beats: [{ id: "a", timeline: [{ kind: "wait", ms: 1000 }, { kind: "screen_fade", to: 1, durationMs: 2000 }, { kind: "wait", ms: 3000 }] }] },
  { id: "s1", beats: [{ id: "b", timeline: [{ kind: "wait", ms: 2000 }] }] },
]);

test("the overlay is the stage wrapper's last child; apply(T) paints fadeAt's level and colour", () => {
  const { fade, apply } = setup(FADED);
  expect(fade().parentElement!.lastElementChild).toBe(fade());
  apply(2);
  expect(fade().style.display).toBe("block");
  expect(Number(fade().style.opacity)).toBeCloseTo(fadeAt(fadeEvents(FADED), 2).level, 6);
  expect(fade().style.background).toMatch(/^(#000|rgb\(0, 0, 0\))$/);
});

test("Review Focus #3: the level holds across a scene cut; a backward scrub to before the fade paints nothing", () => {
  const { fade, apply } = setup(FADED);
  apply(5);
  expect(fade().style.opacity).toBe("1");
  apply(0.5);
  expect(fade().style.display).toBe("none");
});

test("mount paints the fade at initialT; a fade-less deck never shows the overlay", () => {
  expect(setup(FADED, 2.5).fade().style.display).toBe("block");
  cleanup();
  const plain = setup(doc([{ id: "s", beats: [{ id: "a", timeline: [{ kind: "wait", ms: 1000 }] }] }]));
  plain.apply(0.5);
  expect(plain.fade().style.display).toBe("none");
  expect(plain.fade().style.opacity).toBe("");
});

test("writes only when the painted value changes", () => {
  const { fade, apply } = setup(FADED);
  apply(2);
  const w = watchStyle(fade(), "opacity");
  apply(2);
  apply(2);
  expect(w.count()).toBe(0);
  apply(2.5);
  expect(w.count()).toBe(1);
  w.stop();
});
```
  - **`tests/unit/deck-canvas-fade.test.tsx`:**
```tsx
import { afterEach, expect, test } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { DeckCanvas, type CanvasHandle } from "@/components/editor/DeckCanvas";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

afterEach(cleanup);
const docTo = (to: number): DeckDoc => ({ version: 1, meta: { id: "d", title: "T" }, scenes: [{ id: "s", beats: [{ id: "b", timeline: [
  { kind: "screen_fade", to, durationMs: 0 }, { kind: "wait", ms: 1000 },
] }] }] });

function mount(d: DeckDoc) {
  act(() => { useEditor.getState().load(d); useEditor.getState().select(0); });
  const ref = createRef<CanvasHandle>();
  const { container } = render(<DeckCanvas ref={ref} flat={useEditor.getState().beats[0]} />);
  act(() => ref.current!.seek(0.5));
  return container.querySelector<HTMLElement>(".ed__canvas-host .deck__fade")!;
}

test("the editor preview caps the fade at 50% so the beat stays visible", () => {
  expect(mount(docTo(1)).style.opacity).toBe("0.5");
});
test("a fade below the cap previews as-is; level 0 paints nothing", () => {
  expect(mount(docTo(0.3)).style.opacity).toBe("0.3");
  cleanup();
  expect(mount(docTo(0)).style.display).toBe("none");
});
```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - **`engine/components/fade-overlay.ts`:**
```ts
/** Paint the screen-fade overlay (sub-project 6) — shared by DeckStage (/play, /render) and the
 *  editor canvas. Writes only when the painted value changes; at level 0 the overlay is
 *  display:none, so it paints nothing. `cap` limits the level (the editor previews ≤ 0.5). Returns
 *  the key it painted, which the caller passes back as `last`. */
import type { FadeState } from "@/engine/authoring/fade-clock";

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function paintFadeOverlay(el: HTMLElement, f: FadeState, last: string, cap = 1): string {
  const level = r6(Math.min(f.level, cap));
  const key = level <= 0 ? "off" : `${level} ${f.color}`;
  if (key === last) return last;
  if (key === "off") { el.style.display = "none"; return key; }
  el.style.display = "block";
  el.style.opacity = String(level);
  el.style.background = f.color;
  return key;
}
```
  - **`DeckStage.tsx`:**
    - Imports: `import { fadeAt, fadeEvents } from "@/engine/authoring/fade-clock";` and `import { paintFadeOverlay } from "@/engine/components/fade-overlay";`.
    - In `useDeckStage`:
```ts
  const fadeEv = useMemo(() => fadeEvents(doc), [doc]);
  const fadeEl = useRef<HTMLDivElement>(null);
  const lastFade = useRef("");
  /** Paint the screen fade at T (spec §4): one overlay above text, outside every camera world. */
  const paintFade = useCallback(() => {
    if (fadeEl.current) lastFade.current = paintFadeOverlay(fadeEl.current, fadeAt(fadeEv, T.current), lastFade.current);
  }, [fadeEv]);
```
    - In `apply`, after `paintArt();`, call `paintFade();` and add `paintFade` to its deps.
    - After the `paintArt` layout effect: `useLayoutEffect(() => { paintFade(); }, [paintFade]);`.
    - In `stage`, after the `<Stage …/>` line:
```tsx
      {/* The screen fade (sub-project 6): the LAST child, above text and outside every camera world. No
          display/opacity in this style prop: paintFadeOverlay owns them (React never rewrites them). */}
      <div className="deck__fade" ref={fadeEl} aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 50 }} />
```
  - **`DeckCanvas.tsx`:**
    - Imports: `fadeAt, fadeEvents` from `@/engine/authoring/fade-clock`; `paintFadeOverlay` from `@/engine/components/fade-overlay`.
    - `export const CANVAS_FADE_CAP = 0.5;` at module level.
    - `const fadeEv = useMemo(() => (doc ? fadeEvents(doc) : []), [doc]);`, `const fadeEl = useRef<HTMLDivElement>(null);` and `const lastFade = useRef("");`.
    - Extend `cam` to `{ picking, camEvents, beatStart, fadeEv }`, in both its initialiser and the refresh effect.
    - In `draw()`, after `art.current?.setCamera(tf);`:
```ts
      if (fadeEl.current) lastFade.current = paintFadeOverlay(fadeEl.current, fadeAt(c.fadeEv, c.beatStart + t.current), lastFade.current, CANVAS_FADE_CAP);
```
    - Add `fadeEv` to the `useEffect(() => { draw(); }, [...])` deps.
    - After the text-layer `<div className="cin" …>` line:
```tsx
        {/* Screen fade preview, capped at 50% so the beat stays editable (spec §4). z 4: over art, notes and
            text; under the pos handle (5) and objects (6). */}
        <div className="deck__fade" ref={fadeEl} aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 4 }} />
```
- [ ] **Step 4: Run** both tests, `tests/unit/deck-stage.test.tsx`, `tests/unit/deck-canvas-camera.test.tsx`, `tests/unit/deck-canvas-notes.test.tsx`, `npm test`, tsc and `npm run build`.
- [ ] **Step 5: Commit.** `feat(player): deck-time screen fade overlay; editor preview capped at 50%`

---

### Task 13: RenderStage gate and awaiting sources

**Files:**
- Modify: `components/player/DeckStage.tsx` (return type `:46-59`, the return value `:134`, the camera hint rule `:129`), `components/player/RenderStage.tsx:174,207-211,230,236`
- Test: `tests/unit/render-stage.test.tsx` (add a DeckStage wrapper mock and cases), `tests/unit/deck-stage.test.tsx` (one case)

**Interfaces — Consumes:** `SlideTransport.sourcesReady` (Task 10), `hasNoteSources` (Task 8). **Produces:** the `useDeckStage` return value gains `sourcesReady: () => Promise<void>`.

- [ ] **Step 1: Failing tests.**
  - **`render-stage.test.tsx`.** Add after the `video-sync` mock:
```ts
// sourcesReady is wrapped: test-gateable, and it records how many clip-seek awaits came before it.
const sources = vi.hoisted(() => ({ gate: null as null | Promise<void>, seeksAtCall: -1 }));
vi.mock("@/components/player/DeckStage", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/player/DeckStage")>();
  return { ...real, useDeckStage: (...args: Parameters<typeof real.useDeckStage>) => {
    const r = real.useDeckStage(...args);
    return { ...r, sourcesReady: () => { sources.seeksAtCall = seeks.calls; return sources.gate ?? r.sourcesReady(); } };
  } };
});
```
    In `beforeEach`, add `sources.gate = null; sources.seeksAtCall = -1;`. Then add:
```ts
test("renderFrame awaits the beat's text sources after the clip seeks and before decoding images", async () => {
  render(<RenderStage doc={D} />);
  const r = await ready();
  let release!: () => void;
  sources.gate = new Promise<void>((res) => { release = res; });
  decoded.length = 0;
  let done = false;
  const p = r.renderFrame(2.95).then(() => { done = true; });
  await waitFor(() => expect(sources.seeksAtCall).toBeGreaterThan(0));
  expect(sources.seeksAtCall).toBe(seeks.calls);                  // pendingVideoSeeks came first
  await new Promise((res) => setTimeout(res, 50));
  expect(done).toBe(false);
  expect(decoded.filter((s) => /\/storyboard\/panels\//.test(s))).toEqual([]); // no frame <img> decoded yet
  release();
  await p;
  expect(decoded.some((s) => /1\.02\.jpg$/.test(s))).toBe(true);
});

test("a deck whose only note source is text particles gets the full raster and the hint drop", async () => {
  const TEXTY: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s0", beats: [
    { id: "a", timeline: [{ kind: "text", value: "Notes off me", in: "fade", particles: {} }, { kind: "wait", ms: 2000 }] },
  ] }] };
  const { container } = render(<RenderStage doc={TEXTY} />);
  const r = await ready();
  const root = container.querySelector<HTMLElement>("[data-render-root]")!;
  const w = clipWrites(root);
  await r.renderFrame(1);
  await Promise.resolve();
  w.stop();
  expect(w.seen.some((s) => s.includes("clip-path"))).toBe(true);
  expect(styleText(container)).toMatch(/html\[data-render="1"\] \[data-render-root\] \.notefield__text > \*/);
});
```
    In the existing "a camera-less note deck…" test, add `expect(css).toMatch(/html\[data-render="1"\] \[data-render-root\] \.notefield__text > \*/);`. In the "camera AND notes" test, add `expect(css).toMatch(/\[data-camera\] \.notefield__text > \*/);`.
  - **`deck-stage.test.tsx`:** add a test with its own small host that exposes `sourcesReady`, and expect it to resolve for the fixture `D`.
```tsx
test("sourcesReady resolves (it delegates to the mounted beat's transport)", async () => {
  let ready!: () => Promise<void>;
  function SrcHost({ doc }: { doc: DeckDoc }) { const s = useDeckStage(doc, 0); ready = s.sourcesReady; return <div>{s.stage}</div>; }
  render(<SrcHost doc={D} />);
  await expect(act(async () => { await ready(); })).resolves.toBeUndefined();
});
```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - **`DeckStage.tsx`:**
    - The return type gains:
```ts
  /** Resolves once the mounted beat's text-particle sources for the current DOM are measured
   *  (CinematicSlide's transport.sourcesReady); resolved when no beat is mounted. */
  sourcesReady: () => Promise<void>;
```
    - `const sourcesReady = useCallback(() => transport.current?.sourcesReady() ?? Promise.resolve(), []);`, and add it to the returned object.
    - The camera rule (`:129`) becomes:
```tsx
      {hasCamera && <style>{`[data-camera] .artstage__layer, [data-camera] .notefield__stage > *, [data-camera] .notefield__text > * { will-change: auto !important; }`}</style>}
```
  - **`RenderStage.tsx`:**
    - `:174`: `const { apply, layout, stage, sourcesReady } = useDeckStage(doc, 0);`.
    - After `(await pendingVideoSeeks()).forEach(fail);`:
```ts
          // Text-particle word boxes (and credit block heights) are measured asynchronously, after
          // fonts, whenever a line is built; a frame is never captured before they exist (spec §2).
          await sourcesReady();
```
    - Add `sourcesReady` to the effect's deps (`:230`).
    - The hint-drop style (`:236`) becomes:
```tsx
    {hasNotes && !hasCamera && <style>{`html[data-render="1"] [data-render-root] .artstage__layer, html[data-render="1"] [data-render-root] .notefield__stage > *, html[data-render="1"] [data-render-root] .notefield__text > * { will-change: auto !important; }`}</style>}
```
- [ ] **Step 4: Run** the render-stage and deck-stage tests, `npm test`, tsc and `npm run build`. Then run `E2E` with `e2e/render-page.spec.ts`. It must pass unchanged.
- [ ] **Step 5: Commit.** `feat(render): await text sources per frame; hint drop covers .notefield__text`

---

### Task 14: Editor fields (draw, Particles, Credits, Screen fade)

**Files:**
- Modify: `lib/editor/registry.ts:1-37` (and the new entries before `:141`), `components/editor/Field.tsx`, `components/editor/Inspector.tsx:80-90`
- Test: `tests/unit/registry-credits.test.ts` (new), `tests/unit/inspector-credits.test.tsx` (new)

**Interfaces — Consumes:** Tasks 3, 5 and 6. **Produces:**
```ts
export type FieldType = … | "credits";
interface Field { …; toggle?: Record<string, unknown>; showIf?: string }
// REGISTRY.credits, REGISTRY.screen_fade; text.in options include "draw"; text gains the Particles fields
```

- [ ] **Step 1: Failing tests.**
  - **`tests/unit/registry-credits.test.ts`:**
```ts
import { expect, test } from "vitest";
import { REGISTRY } from "@/lib/editor/registry";
import { validateDeckDoc } from "@/engine/deck-doc";

const keys = (kind: string) => REGISTRY[kind].schema.map((f) => f.key);
const deckWith = (a: unknown) => ({ version: 1, meta: { id: "r", title: "R" }, scenes: [{ id: "s", beats: [{ id: "b", timeline: [a] }] }] });

test("text: Effect offers draw; a Particles checkbox reveals color/rate/rise", () => {
  const by = Object.fromEntries(REGISTRY.text.schema.map((f) => [f.key, f]));
  expect(by.in.options!.map((o) => o.value)).toContain("draw");
  expect(by.particles).toMatchObject({ type: "checkbox", toggle: { color: "cream", rate: 6, rise: 1 } });
  expect(by["particles.color"]).toMatchObject({ type: "select", showIf: "particles" });
  expect(by["particles.color"].options!.map((o) => o.value)).toEqual(["cream", "cyan", "lime", "pink"]);
  expect(by["particles.rate"]).toMatchObject({ type: "number", min: 1, max: 30, showIf: "particles" });
  expect(by["particles.rise"]).toMatchObject({ type: "range", min: 0.5, max: 2, showIf: "particles" });
});

test("credits: Entries, Duration, area and Particles; its defaults validate", () => {
  expect(keys("credits")).toEqual(["items", "durationMs", "area.x", "area.y", "area.w", "area.h", "particles", "particles.color", "particles.rate", "particles.rise"]);
  expect(REGISTRY.credits.schema[0]).toMatchObject({ type: "credits" });
  const d = REGISTRY.credits.defaults();
  expect(d).toEqual({ kind: "credits", items: [{ role: "Directed by", names: ["Your Name"] }], area: { x: 0.2, y: 0.32, w: 0.6, h: 0.63 }, durationMs: 20000 });
  expect(validateDeckDoc(deckWith(d)).errors).toEqual([]);
});

test("screen_fade: Level, Color, Duration; its defaults validate", () => {
  expect(keys("screen_fade")).toEqual(["to", "color", "durationMs"]);
  expect(REGISTRY.screen_fade.schema[0]).toMatchObject({ type: "range", min: 0, max: 1 });
  const d = REGISTRY.screen_fade.defaults();
  expect(d).toEqual({ kind: "screen_fade", to: 1, color: "#000", durationMs: 1000 });
  expect(validateDeckDoc(deckWith(d)).errors).toEqual([]);
});
```
  - **`tests/unit/inspector-credits.test.tsx`:**
```tsx
import { afterEach, beforeEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Inspector } from "@/components/editor/Inspector";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s1", beats: [{ id: "b1", timeline: [
  { kind: "credits", items: [{ role: "Directed by", names: ["Ann"] }], durationMs: 9000 },
  { kind: "text", value: "Hi", in: "fade" },
] }] }] });
const action = (i: number) => useEditor.getState().doc!.scenes[0].beats[0].timeline[i] as Record<string, unknown>;
beforeEach(() => act(() => { useEditor.getState().load(doc()); useEditor.getState().selectAction(0); }));
afterEach(cleanup);

test("the Entries textarea shows the formatted items and parses live", () => {
  render(<Inspector />);
  const ta = screen.getByTestId("field-items") as HTMLTextAreaElement;
  expect(ta.value).toBe("Directed by: Ann");
  fireEvent.change(ta, { target: { value: "Directed by: Ann\nMusic: Bo, " } });
  expect(action(0).items).toEqual([{ role: "Directed by", names: ["Ann"] }, { role: "Music", names: ["Bo"] }]);
  expect(ta.value).toBe("Directed by: Ann\nMusic: Bo, ");        // the draft is not reformatted under the cursor
});

test("an outside change (undo) re-syncs the textarea", () => {
  render(<Inspector />);
  const ta = screen.getByTestId("field-items") as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: "Cast: Zed" } });
  act(() => useEditor.getState().undo());
  expect(ta.value).toBe("Directed by: Ann");
});

test("Particles: hidden sub-fields until checked; checking writes the defaults, clearing deletes the key", () => {
  act(() => useEditor.getState().selectAction(1));
  render(<Inspector />);
  expect(screen.queryByTestId("field-particles.color")).toBeNull();
  fireEvent.click(screen.getByTestId("field-particles"));
  expect(action(1).particles).toEqual({ color: "cream", rate: 6, rise: 1 });
  expect(screen.getByTestId("field-particles.color")).toBeTruthy();
  fireEvent.click(screen.getByTestId("field-particles"));
  expect("particles" in action(1)).toBe(false);
  expect(screen.queryByTestId("field-particles.color")).toBeNull();
});
```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - **`registry.ts`:**
```ts
import type { Action, TextIn } from "@/engine/deck/types";
import { DEFAULT_CREDITS_AREA } from "@/engine/deck/credits";

export type FieldType = "text" | "textarea" | "number" | "select" | "range" | "checkbox" | "objectRef" | "asset" | "credits";
```
    - `Field` gains:
```ts
  /** checkbox on an object-valued key (text `particles`): checked writes a copy of this object,
   *  cleared deletes the key. */
  toggle?: Record<string, unknown>;
  /** The Inspector shows this field only while this dot-path of the action is truthy. */
  showIf?: string;
```
    - `TEXT_INS` gains `"draw"` (after `"typewriter"`). Add:
```ts
const PARTICLE_FIELDS: Field[] = [
  { key: "particles", label: "Particles", type: "checkbox", toggle: { color: "cream", rate: 6, rise: 1 } },
  { key: "particles.color", label: "Particle color", type: "select", options: opts("cream", "cyan", "lime", "pink"), showIf: "particles" },
  { key: "particles.rate", label: "Notes/sec (1–30)", type: "number", min: 1, max: 30, step: 1, showIf: "particles" },
  { key: "particles.rise", label: "Rise", type: "range", min: 0.5, max: 2, step: 0.1, showIf: "particles" },
];
```
    - Append `...PARTICLE_FIELDS,` to the text schema after `pos.y`. Add these entries after `camera`:
```ts
  credits: { kind: "credits", label: "Credits", icon: "ti-list-details", seekable: true, schema: [
    { key: "items", label: "Entries (Role: Name, Name)", type: "credits" },
    { key: "durationMs", label: "Duration ms", type: "number", min: 100, step: 100 },
    { key: "area.x", label: "Area X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "area.y", label: "Area Y", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "area.w", label: "Area W", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "area.h", label: "Area H", type: "number", min: 0, max: 1, step: 0.01 },
    ...PARTICLE_FIELDS,
  ], defaults: () => ({ kind: "credits", items: [{ role: "Directed by", names: ["Your Name"] }], area: { ...DEFAULT_CREDITS_AREA }, durationMs: 20000 }) },
  screen_fade: { kind: "screen_fade", label: "Screen fade", icon: "ti-contrast", seekable: true, schema: [
    { key: "to", label: "Level (0–1)", type: "range", min: 0, max: 1, step: 0.05 },
    { key: "color", label: "Color", type: "text" },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ], defaults: () => ({ kind: "screen_fade", to: 1, color: "#000", durationMs: 1000 }) },
```
  - **`Field.tsx`:**
    - Add `import { useEffect, useState } from "react";`, `import type { CreditItem } from "@/engine/deck/types";` and `import { formatCredits, parseCredits } from "@/lib/editor/credits-text";`.
    - As the first statement of `Field`: `if (spec.type === "credits") return <CreditsField spec={spec} value={value} onChange={onChange} />;`.
    - Replace the checkbox branch with:
```tsx
      ) : spec.type === "checkbox" ? (
        <input
          type="checkbox"
          data-testid={`field-${spec.key}`}
          checked={Boolean(value)}
          onChange={(e) => onChange(spec.toggle ? (e.target.checked ? { ...spec.toggle } : undefined) : e.target.checked)}
        />
```
    - Add the component:
```tsx
/** The Credits "Entries" textarea: one credit per line (`Role: Name, Name`), parsed live. It keeps
 *  its own draft so typing is never reformatted under the cursor, and re-syncs only when the items
 *  change from outside (undo, MCP) — i.e. when the draft no longer parses to them. */
function CreditsField({ spec, value, onChange }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  const items = Array.isArray(value) ? (value as CreditItem[]) : [];
  const shown = formatCredits(items);
  const [draft, setDraft] = useState(shown);
  useEffect(() => {
    if (formatCredits(parseCredits(draft)) !== shown) setDraft(shown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span style={{ display: "block", fontSize: 11, color: "var(--ed-fg-muted)", marginBottom: 4 }}>{spec.label}</span>
      <textarea
        data-testid={`field-${spec.key}`}
        style={{ ...base, minHeight: 96, resize: "vertical" }}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); onChange(parseCredits(e.target.value)); }}
      />
    </label>
  );
}
```
    - The `<select>` already carries `data-testid={`field-${spec.key}`}`, so `field-particles.color` works.
  - **`Inspector.tsx:80`:** `{d.schema.filter((f) => !f.showIf || !!getPath(action, f.showIf)).map((f) => {`.
- [ ] **Step 4: Run** the tests, `tests/unit/registry*.test.ts`, `tests/unit/field-optional.test.tsx`, `tests/unit/mcp-tool-defs.test.ts`, `npm test`, tsc and `npm run build`.
- [ ] **Step 5: Commit.** `feat(editor): draw effect, Particles, Credits (live entries) and Screen fade fields`

---

### Task 15: Lint rules and MCP docs

**Files:**
- Modify: `lib/editor/lint.ts:1-12` (imports), a new `creditsAndFadeWarnings` after `cameraWarnings` (`:166`), `lintDeck` `:268-272`; `lib/mcp/tool-defs.ts:77,110`
- Test: `tests/unit/lint-credits.test.ts` (new); `tests/unit/mcp-tool-defs.test.ts` (one case)

**Interfaces — Consumes:** `estimateCreditsBlockH` and `DEFAULT_CREDITS_AREA` (Task 5), `FADE_DEFAULT_MS` (Task 7), `introDuration` (Task 2).

- [ ] **Step 1: Failing tests.**
  - **`tests/unit/lint-credits.test.ts`:**
```ts
import { expect, test } from "vitest";
import { lintDeck } from "@/lib/editor/lint";
import type { DeckDoc } from "@/engine/deck-doc";
import type { Action } from "@/engine/deck/types";

const deck = (timeline: Action[], durationSec?: number): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" },
  scenes: [{ id: "s", ...(durationSec ? { durationSec } : {}), beats: [{ id: "a", timeline }] }] });
const rule = (d: DeckDoc, r: string) => lintDeck(d).filter((i) => i.rule === r);
const credits = (durationMs: number): Action => ({ kind: "credits", items: [{ role: "A", names: ["B"] }], durationMs });

test("credits-fast: (estimated blockH + areaH) at 1080p over the duration above 90 px/s", () => {
  // (0.036 + 0.05 + 0.63) × 1080 = 773.28 px; over 4 s = 193 px/s → at least 8600 ms.
  expect(rule(deck([credits(4000)]), "credits-fast")).toMatchObject([{ severity: "warning", at: { sceneIdx: 0, beatIdx: 0, actionIdx: 0 },
    message: "credits roll at 193 px/s at 1080p — hard to read; use durationMs ≥ 8600" }]);
  expect(rule(deck([credits(9000)]), "credits-fast")).toEqual([]);
});

test("draw-long: a draw line whose introDuration is above 8 s", () => {
  const draw = (n: number, speed?: number): Action => ({ kind: "text", value: "x".repeat(n), in: "draw", ...(speed ? { speed } : {}) });
  expect(rule(deck([draw(94)]), "draw-long")).toMatchObject([{ at: { actionIdx: 0 }, message: "draw line takes 8.0s — shorten it or raise its speed" }]);
  expect(rule(deck([draw(93)]), "draw-long")).toEqual([]);
  expect(rule(deck([draw(94, 2)]), "draw-long")).toEqual([]);
  expect(rule(deck([{ kind: "text", value: "x".repeat(300), in: "fade" }]), "draw-long")).toEqual([]);
});

test("fade-unfinished: a screen fade still running at the deck's end", () => {
  const fade: Action = { kind: "screen_fade", to: 1 };
  expect(rule(deck([fade, { kind: "wait", ms: 500 }]), "fade-unfinished")).toMatchObject([{ at: { actionIdx: 0 },
    message: "screen fade is still running at the end of the deck — it ends 0.5s after the last frame" }]);
  expect(rule(deck([fade, { kind: "wait", ms: 1000 }]), "fade-unfinished")).toEqual([]);
  // Cut off by a pinned scene: never reached, never warned.
  expect(rule(deck([{ kind: "wait", ms: 2000 }, fade, { kind: "wait", ms: 100 }], 1), "fade-unfinished")).toEqual([]);
});
```
  - **`mcp-tool-defs.test.ts`:**
```ts
test("action docs describe draw, particles, credits and screen_fade", () => {
  for (const name of ["insert_action_after", "update_action"]) {
    const d = TOOL_DEFS.find((t) => t.name === name)!.description;
    for (const word of ["\"draw\"", "particles", "credits", "screen_fade"]) expect(d, `${name}: ${word}`).toContain(word);
  }
});
```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - **`lint.ts`.** Add imports: `import { DEFAULT_CREDITS_AREA, estimateCreditsBlockH } from "@/engine/deck/credits";`, `import { FADE_DEFAULT_MS } from "@/engine/authoring/fade-clock";`, and add `introDuration` to the existing `beat-clock` import. Then:
```ts
/** Lint's reference frame height for roll speed (spec §5: "about 90 px/s at 1080p"). */
const REF_H = 1080;
export const CREDITS_MAX_PX_PER_SEC = 90;
export const DRAW_MAX_SEC = 8;

/** Credits, draw and screen-fade warnings (sub-project 6). Runs only on a structurally valid deck. */
function creditsAndFadeWarnings(doc: DeckDoc): LintIssue[] {
  const out: LintIssue[] = [];
  doc.scenes.forEach((s, sceneIdx) => s.beats.forEach((b, beatIdx) => b.timeline.forEach((a, actionIdx) => {
    const at = { sceneIdx, beatIdx, actionIdx };
    if (a.kind === "credits") {
      // No DOM: blockH is estimated from line counts × line heights (engine/deck/credits.ts).
      const travel = (estimateCreditsBlockH(a.items) + (a.area ?? DEFAULT_CREDITS_AREA).h) * REF_H;
      const pxPerSec = travel / (a.durationMs / 1000);
      if (pxPerSec > CREDITS_MAX_PX_PER_SEC) {
        const minMs = Math.ceil((travel / CREDITS_MAX_PX_PER_SEC) * 10) * 100;
        out.push({ rule: "credits-fast", severity: "warning", at, message: `credits roll at ${Math.round(pxPerSec)} px/s at 1080p — hard to read; use durationMs ≥ ${minMs}` });
      }
    }
    if (a.kind === "text" && a.in === "draw") {
      const d = introDuration(a);
      if (d > DRAW_MAX_SEC) out.push({ rule: "draw-long", severity: "warning", at, message: `draw line takes ${d.toFixed(1)}s — shorten it or raise its speed` });
    }
  })));
  const layout = deckLayout(doc);
  for (const s of layout.scenes) {
    const scene = doc.scenes[s.sceneIdx];
    const reached = (localStart: number) => !s.pinned || localStart < s.length;
    for (const b of s.beats) {
      if (!reached(b.start)) continue;
      beatTimeline(scene.beats[b.beatIdx].timeline).forEach((w, actionIdx) => {
        if (w.action.kind !== "screen_fade" || !reached(b.start + w.start)) return;
        const end = s.start + b.start + w.start + (w.action.durationMs ?? FADE_DEFAULT_MS) / 1000;
        if (end > layout.total + 1e-6) {
          out.push({ rule: "fade-unfinished", severity: "warning", at: { sceneIdx: s.sceneIdx, beatIdx: b.beatIdx, actionIdx },
            message: `screen fade is still running at the end of the deck — it ends ${(end - layout.total).toFixed(1)}s after the last frame` });
        }
      });
    }
  }
  return out;
}
```
    In `lintDeck`, add `warnings.push(...creditsAndFadeWarnings(doc));` after `cameraWarnings`. Check the expected value: 94 chars → `0.1 + 94·0.08 + 0.4 = 8.02` → `"8.0s"`.
  - **`tool-defs.ts`.** Append this sentence to both the `insert_action_after` (`:77`) and the `update_action` (`:110`) descriptions:
    ` A text action with in "draw" traces each glyph's outline, then fills it. particles {color: cream|cyan|lime|pink or a hex, rate 1–30 notes/s (default 6), rise (default 1)} on a text or credits action emits music notes off its words (not on append fragments). credits actions roll items [{role?, names[]}] upward through area {x,y,w,h} (default 0.2,0.32,0.6,0.63) over durationMs, and the beat waits for the roll. screen_fade fades the whole frame to \`to\` (0–1) in color (default #000) over durationMs (default 1000, 0 = cut); the level holds until the next screen_fade.`
- [ ] **Step 4: Run** the tests, `tests/unit/lint*.test.ts`, `tests/unit/samples-lint.test.ts`, the pure-import-graph test, `npm test`, tsc and `npm run build`.
- [ ] **Step 5: Commit.** `feat(editor): lint credits-fast, fade-unfinished, draw-long; MCP docs for draw/particles/credits/screen_fade`

---

### Task 16: e2e render determinism (draw, roll with particles, fade, backward jump, last frame black)

**Files:**
- Modify: `e2e/render-page.spec.ts` (imports `:1-5`; a new `test.describe("credits")` before `test.describe("error path")`)

**Interfaces — Consumes:** everything above. The determinism contract is `retries: 0`.

- [ ] **Step 1: Write the test.** Add these imports:
```ts
import { deckLayout } from "../engine/authoring/deck-clock";
import { fadeAt, fadeEvents } from "../engine/authoring/fade-clock";
import { DRAW_VARIANT } from "../engine/components/effects/draw-state";
```
  Then add the describe:
```ts
// Sub-project 6: a drawn title with particles, a credits roll with particles, and a fade to black.
test.describe("credits", () => {
  // Byte-equality is the render's contract: a flaky mismatch must fail, never pass on a CI retry.
  test.describe.configure({ retries: 0 });
  let creditsId = "";
  test.beforeEach(async ({ request }, info) => {
    creditsId = `e2e-render-credits-${info.parallelIndex}`;
    await request.delete(`/api/decks/${creditsId}`).catch(() => {});
    await request.post("/api/decks", { data: { id: creditsId, title: "Credits" } });
  });
  test.afterEach(async ({ request }) => { await request.delete(`/api/decks/${creditsId}`); });

  test("draw, roll + particles and fade: stepped, jumped and backward-jumped frames are byte-equal; the last frame is pure black", async ({ page, request }) => {
    test.setTimeout(180_000);
    const still = await upload(request, creditsId, "still.png", "image/png");
    // Title draws over 0–1.06 s; the roll runs 1.06–5.06 s; the fade runs 5.06–6.06 s; the deck ends at 6.56 s.
    const doc = { version: 1, meta: { id: creditsId, title: "Credits" }, scenes: [{ id: "s1", beats: [{ id: "a", art: { to: still, mode: "cut" }, timeline: [
      { kind: "text", value: "Credits", in: "draw", align: "center", pos: { x: 0.5, y: 0.06 }, particles: { color: "cyan", rate: 8 } },
      { kind: "credits", items: [{ role: "Directed by", names: ["Ann Lee"] }, { role: "Music", names: ["Bo Chen", "Cy Diaz"] }, { names: ["Thanks for watching"] }],
        durationMs: 4000, particles: { color: "lime", rate: 6 } },
      { kind: "screen_fade", to: 1, durationMs: 1000 },
      { kind: "wait", ms: 1500 },
    ] }] }] };
    expect((await request.put(`/api/decks/${creditsId}`, { data: doc })).status()).toBe(200);
    const d = doc as unknown as DeckDoc;
    const TOTAL = deckLayout(d).total;
    const MID_DRAW = 0.5, MID_ROLL = 3.0, MID_FADE = 5.6;
    expect(TOTAL).toBeCloseTo(6.56, 9);
    // Storyboard glyphs may be absent from a checkout (an unloaded mask paints nothing): serve a
    // fine-lined glyph for every note so the sprites really draw.
    const glyph = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="none" stroke="#fff" stroke-width="2">
      <ellipse cx="22" cy="48" rx="10" ry="7"/><path d="M32 48V8l18 8"/><path d="M8 20h48M8 26h48M8 32h48"/></g></svg>`;
    await page.route("**/storyboard/notes/**", (r) => r.fulfill({ contentType: "image/svg+xml", body: glyph }));
    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto(`/render?deck=${creditsId}`);
    await page.waitForFunction(() => window.__morganaRender?.ready === true);
    const frame = (t: number) => page.evaluate(async (t) => {
      const r = window.__morganaRender!;
      if (!r.ready) throw new Error("not ready");
      await r.renderFrame(t);
    }, t);
    const capture = async () => {
      const png = await page.screenshot();
      const dom = await page.evaluate(() => {
        const q = (s: string) => document.querySelector<HTMLElement>(`[data-render-root] ${s}`);
        const fade = q(".deck__fade");
        return {
          draw: [...document.querySelectorAll<SVGElement>("[data-render-root] .cin__draw tspan")].map((e) => [e.style.getPropertyValue("--d"), e.style.getPropertyValue("--f")]),
          roll: q(".cin__credits-roll")?.style.transform ?? null,
          text: [...document.querySelectorAll<HTMLElement>("[data-render-root] .notefield__text > *")]
            .filter((e) => e.style.display !== "none").map((e) => [e.style.left, e.style.top, e.style.opacity, e.style.transform]),
          fade: fade ? [fade.style.display, fade.style.opacity, fade.style.background] : null,
        };
      });
      return { png, dom };
    };

    const ts: number[] = [];
    for (let i = 0; i <= 65; i++) ts.push(i / 10);
    ts.push(TOTAL);
    const stepped = new Map<number, Awaited<ReturnType<typeof capture>>>();
    for (const t of ts) {
      await frame(t);
      if ([MID_DRAW, MID_ROLL, MID_FADE, TOTAL].includes(t)) stepped.set(t, await capture());
    }
    const draw = stepped.get(MID_DRAW)!, roll = stepped.get(MID_ROLL)!, fade = stepped.get(MID_FADE)!, last = stepped.get(TOTAL)!;

    // Sanity: each compared frame really is mid-effect.
    expect(draw.dom.draw.length).toBe("Credits".length);
    if (DRAW_VARIANT === "dash") expect(draw.dom.draw.some(([dd]) => Number(dd) > 0 && Number(dd) < 1)).toBe(true);
    expect(draw.dom.draw.every(([, f]) => f === "0")).toBe(true);          // fill not started
    expect(draw.dom.text.length).toBeGreaterThan(0);                       // title particles already flying
    expect(roll.dom.roll).toMatch(/^translateY\(-?[\d.]+px\)$/);
    expect(roll.dom.text.length).toBeGreaterThan(3);
    expect(fade.dom.fade![0]).toBe("block");
    expect(Number(fade.dom.fade![1])).toBeCloseTo(fadeAt(fadeEvents(d), MID_FADE).level, 5);
    expect(last.dom.fade!.slice(0, 2)).toEqual(["block", "1"]);
    expect(draw.png.equals(roll.png)).toBe(false);

    for (const [T, want] of [[MID_DRAW, draw], [MID_ROLL, roll], [MID_FADE, fade], [TOTAL, last]] as const) {
      await frame(0);
      await frame(T);
      const jumped = await capture();
      expect(jumped.dom, `jump T=${T}`).toEqual(want.dom);
      expect(jumped.png.equals(want.png), `jump T=${T}`).toBe(true);
    }
    // Backward: mid-fade → mid-draw (the overlay goes away, the title re-draws).
    await frame(MID_FADE);
    await frame(MID_DRAW);
    const back = await capture();
    expect(back.dom).toEqual(draw.dom);
    expect(back.png.equals(draw.png), `backward jump T=${MID_DRAW}`).toBe(true);

    // The last frame is pure black: byte-equal to a black page of the same size.
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#000"></body></html>`);
    expect(last.png.equals(await page.screenshot()), "the last frame is pure black").toBe(true);
  });
});
```
- [ ] **Step 2: Run.** `E2E` with `e2e/render-page.spec.ts`, then again with `--repeat-each=3`. Every existing describe must pass unchanged (Review Focus #2).
- [ ] **Step 3: If a byte comparison fails,** use superpowers:systematic-debugging before changing anything. Look at the `dom` diff first: the `text` arrays isolate source measurement, `roll` isolates block heights. Do not add retries.
- [ ] **Step 4: Commit.** `test(e2e): render determinism — draw, credits roll + particles, fade, last frame black`

---

### Task 17: e2e `/play` — scrub and camera attachment

**Files:**
- Modify: `e2e/play.spec.ts` (imports `:8-9`; a new `test.describe("credits and particles")` at the end)

- [ ] **Step 1: Write the tests.** Add these imports:
```ts
import { creditsOffset } from "../engine/deck/credits";
import { fadeAt, fadeEvents } from "../engine/authoring/fade-clock";
```
  Then add the describe:
```ts
test.describe("credits and particles", () => {
  // Per-worker deck ids: parallel workers (--repeat-each) must not share a deck.
  let cid = "";
  test.beforeEach(({}, info) => { cid = `e2e-play-credits-${info.parallelIndex}`; });
  test.afterEach(async ({ request }) => {
    for (const id of [cid, `${cid}-cam`, `${cid}-still`]) await request.delete(`/api/decks/${id}`).catch(() => {});
  });
  const put = async (request: import("@playwright/test").APIRequestContext, id: string, doc: object) => {
    await request.delete(`/api/decks/${id}`).catch(() => {});
    await request.post("/api/decks", { data: { id, title: id } });
    expect((await request.put(`/api/decks/${id}`, { data: doc })).status()).toBe(200);
  };
  const deckT = (page: import("@playwright/test").Page) => page.getByTestId("play-scrub").getAttribute("aria-valuenow").then(Number);

  test("after a deep link and a scrub, the roll offset and the fade level match the deck clock", async ({ page, request }) => {
    // Roll 0–6 s, fade to black 6–8 s, end 8.5 s.
    const doc = { version: 1, meta: { id: cid, title: "Play credits" }, scenes: [{ id: "s", beats: [{ id: "a", timeline: [
      { kind: "credits", items: [{ role: "Directed by", names: ["Ann Lee"] }, { role: "Music", names: ["Bo Chen", "Cy Diaz"] }], durationMs: 6000 },
      { kind: "screen_fade", to: 1, durationMs: 2000 }, { kind: "wait", ms: 2500 },
    ] }] }] };
    await put(request, cid, doc);
    const fades = fadeEvents(doc as unknown as DeckDoc);
    const read = () => page.evaluate(() => {
      const q = (s: string) => document.querySelector<HTMLElement>(`[data-testid=play-stage] ${s}`);
      const roll = q(".cin__credits-roll"), block = q(".cin__credits"), fade = q(".deck__fade")!;
      const m = /translateY\((-?[\d.]+)px\)/.exec(roll?.style.transform ?? "");
      return { off: m ? Number(m[1]) : NaN, blockH: roll?.offsetHeight ?? 0, areaH: block?.clientHeight ?? 0, fade: [fade.style.display, fade.style.opacity] };
    });
    const rollMatches = async (T: number) => {
      const r = await read();
      return Math.abs(r.off - creditsOffset(T, 6000, r.blockH, r.areaH));
    };

    await page.goto(`/play?deck=${cid}&t=3`);
    await expect.poll(() => deckT(page)).toBe(3);
    await expect.poll(() => rollMatches(3)).toBeLessThanOrEqual(0.01); // poll: blockH is re-measured after fonts
    expect((await read()).fade[0]).toBe("none");

    const box = (await page.getByTestId("play-scrub").boundingBox())!;
    await page.mouse.click(box.x + box.width * (7 / 8.5), box.y + box.height / 2);
    await expect.poll(async () => Math.abs((await deckT(page)) - 7)).toBeLessThanOrEqual(0.1);
    const T = await deckT(page);
    await expect.poll(async () => (await read()).fade[0]).toBe("block");
    expect(Number((await read()).fade[1])).toBeCloseTo(fadeAt(fades, T).level, 5);
    expect(await rollMatches(T)).toBeLessThanOrEqual(0.01);           // past the roll: −blockH

    // Review Focus #3: scrub back to before the fade — the overlay paints nothing again.
    await page.mouse.click(box.x + box.width * (2 / 8.5), box.y + box.height / 2);
    await expect.poll(async () => (await read()).fade[0]).toBe("none");
  });

  test("text particles stay on the words during a camera move: .notefield__text never transforms; the sprites equal the camera-less deck's", async ({ page, request }) => {
    const line = { kind: "text", value: "Particle words", in: "fade", pos: { x: 0.3, y: 0.3 }, particles: { color: "cyan", rate: 8 } };
    const mk = (id: string, cam: boolean) => ({ version: 1, meta: { id, title: id }, scenes: [{ id: "s", beats: [{ id: "a", art: { to: "1.01", mode: "cut" }, timeline: [
      line, ...(cam ? [{ kind: "camera", to: { zoom: 3, x: 0.3, y: 0.3 }, durationMs: 2000 }] : []), { kind: "wait", ms: 3000 },
    ] }] }] });
    await put(request, `${cid}-cam`, mk(`${cid}-cam`, true));
    await put(request, `${cid}-still`, mk(`${cid}-still`, false));
    const sprites = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-testid=play-stage] .notefield__text > *")]
      .filter((e) => e.style.display !== "none").map((e) => [e.style.left, e.style.top]));
    const open = async (id: string) => {
      await page.goto(`/play?deck=${id}&t=1.8`);              // the camera is mid-move at 1.8 (0.8 → 2.8)
      await expect.poll(async () => (await sprites()).length).toBeGreaterThan(3);
      return sprites();
    };

    const withCam = await open(`${cid}-cam`);
    const chain = await page.evaluate(() => {
      const out: { tf: string; world: string }[] = [];
      for (let n = document.querySelector<HTMLElement>("[data-testid=play-stage] .notefield__text"); n; n = n.parentElement) {
        out.push({ tf: getComputedStyle(n).transform, world: n.className });
        if (n.dataset.testid === "beatstage") break; // the player frame's own letterbox scaling is not ours
      }
      return { out, beat: document.querySelector<HTMLElement>("[data-testid=play-stage] .beat__world")!.style.transform };
    });
    expect(chain.beat).toContain("scale(");                  // the camera really is zooming the world
    for (const n of chain.out) expect(n.tf, n.world).toBe("none");
    const still = await open(`${cid}-still`);
    expect(withCam).toEqual(still);                          // same word boxes, same notes
  });
});
```
- [ ] **Step 2: Run.** `E2E` with `e2e/play.spec.ts`, then again with `--repeat-each=2`.
- [ ] **Step 3: Commit.** `test(e2e): /play credits roll + fade follow the clock; text particles ignore the camera`

---

### Task 18: e2e editor credits flow

**Files:**
- Create: `e2e/credits-editor.spec.ts`

- [ ] **Step 1: Write the test.** It uses the setup pattern from `e2e/camera-editor.spec.ts`.
```ts
import { expect, test } from "@playwright/test";
import { creditsOffset } from "../engine/deck/credits";

// Per-worker deck id: parallel workers (--repeat-each) must not share a deck.
let id = "";
test.beforeEach(({}, info) => { id = `e2e-credits-editor-${info.parallelIndex}`; });
test.afterEach(async ({ request }) => { await request.delete(`/api/decks/${id}`); });

const scrub = (page: import("@playwright/test").Page, v: number) => page.getByTestId("scrub").evaluate((el: HTMLInputElement, v) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true }));
}, v);

test("add Credits and type entries: they save parsed and the canvas rolls; a screen fade previews at most 50%", async ({ page, request }) => {
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Credits editor" }, scenes: [
    { id: "s", beats: [{ id: "a", art: { to: "1.01", mode: "cut" }, timeline: [{ kind: "wait", ms: 100 }, { kind: "wait", ms: 3000 }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Credits editor" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const timeline = page.getByTestId("timeline");
  await expect(timeline.locator(".ed__chip")).toHaveCount(2);

  // Credits after the first wait: 0.1 s → 20.1 s (default 20000 ms).
  await timeline.locator(".ed__chip").nth(0).click();
  await page.getByTestId("action-add").selectOption("credits");
  await expect(timeline.locator(".ed__chip")).toHaveCount(3);
  await expect(page.getByTestId("inspector")).toContainText("Credits action");
  await page.getByTestId("field-items").fill("Directed by: Ann Lee\nMusic: Bo Chen, Cy Diaz\nThanks for watching");
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  const saved = (await (await request.get(`/api/decks/${id}`)).json()) as { scenes: { beats: { timeline: { kind: string; items?: unknown }[] }[] }[] };
  expect(saved.scenes[0].beats[0].timeline[1]).toMatchObject({ kind: "credits", items: [
    { role: "Directed by", names: ["Ann Lee"] }, { role: "Music", names: ["Bo Chen", "Cy Diaz"] }, { names: ["Thanks for watching"] },
  ] });

  // Mid-roll (local 10 of 20 s): the canvas shows the block at creditsOffset.
  await scrub(page, 10.1);
  const canvas = page.locator(".ed__canvas");
  await expect(canvas.locator(".cin__credits")).toContainText("Ann Lee");
  const r = await canvas.evaluate((c) => {
    const roll = c.querySelector<HTMLElement>(".cin__credits-roll")!, block = c.querySelector<HTMLElement>(".cin__credits")!;
    return { off: Number(/translateY\((-?[\d.]+)px\)/.exec(roll.style.transform)![1]), blockH: roll.offsetHeight, areaH: block.clientHeight };
  });
  expect(r.blockH).toBeGreaterThan(0);
  expect(Math.abs(r.off - creditsOffset(10, 20000, r.blockH, r.areaH))).toBeLessThanOrEqual(0.01);

  // A screen fade after the roll (20.1 s, 1000 ms to 1): the preview is capped at 50%.
  await timeline.locator(".ed__chip").nth(1).click();
  await page.getByTestId("action-add").selectOption("screen_fade");
  await expect(timeline.locator(".ed__chip")).toHaveCount(4);
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  const fade = canvas.locator(".deck__fade");
  await scrub(page, 20.35);                                   // level 0.25: under the cap
  await expect.poll(() => fade.evaluate((e: HTMLElement) => e.style.opacity)).toBe("0.25");
  await scrub(page, 22.5);                                    // level 1: capped
  await expect.poll(() => fade.evaluate((e: HTMLElement) => [e.style.display, e.style.opacity])).toEqual(["block", "0.5"]);
  await scrub(page, 1);                                       // before the fade: nothing painted
  await expect.poll(() => fade.evaluate((e: HTMLElement) => e.style.display)).toBe("none");
});
```
- [ ] **Step 2: Run.** `E2E` with `e2e/credits-editor.spec.ts e2e/camera-editor.spec.ts e2e/inspector.spec.ts e2e/timeline-actions.spec.ts e2e/deck-canvas.spec.ts`.
- [ ] **Step 3: Full suite.** `npm test`, `npx tsc --noEmit`, `npm run build`, then `E2E` with no spec argument (the whole default project). Every test must pass.
- [ ] **Step 4: Commit.** `test(e2e): editor credits entries, canvas roll and 50% fade preview`

---

## Self-review notes (plan author)

- **Spec coverage:**
  - §1 draw style, timing and determinism → T2 (timing), T9 (rendering and CSS).
  - §1 probe and fallback → T1 (recorded), T2 (`DRAW_VARIANT`), T9 (both CSS paths).
  - §2 opt-in particles and their validation → T3.
  - §2 text sources and draw-line boxes → T10.
  - §2 pure state → T4.
  - §2 painting in `.notefield__text` → T10.
  - §2 readiness → T10 (`sourcesReady`), T13 (`renderFrame` await).
  - §2 render gate → T8, T13.
  - §3 action, timing and validation → T3.
  - §3 rendering, scroll and particles → T5 (math), T11 (block and sources).
  - §4 action and clock → T3, T7.
  - §4 painting and editor preview → T12.
  - §5 editor fields → T14.
  - §5 validation → T3.
  - §5 lint and MCP → T15.
  - §7 unit tests → T2–T15.
  - §7 e2e tests:
    - probe → T1;
    - render determinism → T16;
    - `/play` and camera → T17;
    - editor → T18.
- **Review Focus coverage:**
  - #1 → T10.
  - #2 → T10, T12, T13 (existing e2e unchanged) and T16 Step 2.
  - #3 → T12 and the T17 e2e.
  - #4 → T10.
  - #5 → T9.
- **Type consistency:** `TextSource.idx` is set through `textSourceIdx` everywhere (T4, T10, T11), and `noteFieldStateAt` passes `src.idx` as `srcIdx`. `creditsScroll` returns `TextScroll` (T5) and is consumed by `scrollOffsetAt` (T4). `paintFadeOverlay`'s `cap` is used only by DeckCanvas.
- **Task-shape change:** the controller's "types plus validation" task became Task 3, and `TextIn` `"draw"` moved into Task 2. `INTRO_DUR: Record<TextIn, …>` makes tsc reject the type change without the timing change. Lint and MCP docs became their own task (T15), separate from the editor fields (T14), so a reviewer can gate the UI and the rules separately.
- **Deep-dive:** `docs/MM_MORGANA.md` is synced at closeout (the controller does it).
