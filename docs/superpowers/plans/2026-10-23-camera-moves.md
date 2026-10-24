# Camera Moves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A time-pure camera (pan and zoom) over the stage's world layers (art, tiles, notes and objects) that is identical in `/play`, the MP4 render and the editor preview, while text stays screen-fixed.

**Architecture:**
- A new `camera` timeline action.
- A pure `engine/authoring/camera-clock.ts` that produces `cameraEvents(doc)`, `cameraAt(events, T)` and `cameraTransform(f)`.
- `useDeckStage` owns a `cameraRef` and passes it the same way as `clipModeRef`.
- Each world layer paints the same transform string:
  - the ArtStage inner `.artstage__world`;
  - CinematicSlide's new `.cin__world`, which holds the tiles;
  - BeatStage's `.beat__world`, which wraps NoteField and ObjectStage.
- The editor gets a Camera action with **Pick on canvas** and a canvas preview.

**Tech Stack:** Next.js 15, React 19, TypeScript, GSAP (parity reference only), Vitest (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-camera-moves-design.md`

## Global Constraints

- `Framing = { x: number; y: number; zoom: number }`. `FULL_FRAME = { x: 0.5, y: 0.5, zoom: 1 }`. Zoom range is [1, 8]. `x` and `y` are clamped to `[0.5/zoom, 1 − 0.5/zoom]`.
- The action shape is `{ kind: "camera"; to: { x?, y?, zoom? }; durationMs?: number; ease?: "inOut" | "in" | "out" | "linear" }`.
  - `durationMs` defaults to 1200; 0 is a cut.
  - `ease` defaults to `"inOut"`.
  - `actionDuration` is 0: the action does not advance the beat timeline.
- Eases:
  - `inOut` = `power2InOut` (from art-clock);
  - `in` = `p³`;
  - `out` = `1 − (1−p)³`;
  - `linear` = `p`.
- Zoom interpolates in log space. `x` and `y` interpolate linearly with the same eased `p`. The result is clamped again.
- `cameraTransform(FULL_FRAME) === "none"`. Otherwise it is `translate(${(0.5 − x·zoom)·100}%, ${(0.5 − y·zoom)·100}%) scale(${zoom})` with `transform-origin: 0 0`. Every number is rounded to 6 decimals.
- World layers:
  - the ArtStage `.artstage__world`. The glow stays outside it, on the fixed `.artstage` root.
  - CinematicSlide `.cin__world`, which holds the tiles and sits beneath the text.
  - BeatStage `.beat__world`, which holds NoteField and ObjectStage.
  - Text, counters, rotateList, ending and chrome stay fixed.
- Write the transform only when the string changes. Do not use `will-change`.
- `apply(T)` stays the only writer of deck time. `cameraRef` is a ref and never causes a `Stage` re-render.
- The editor canvas previews the camera on ArtStage and NoteField only. The editor's ObjectStage (drag handles) stays at full frame.
- `camera-clock.ts` is pure. It goes in the pure-import-graph DOM list and the node-builtin guard list.
- Client code must never runtime-import `@/lib/store/*`. Finish UI tasks with `npm run build`.
- Commits are conventional and carry no attribution lines.

## Review Focus

1. A camera move that is interrupted by the next move must continue from where it was. Expect no jump, at both T = next.start − ε and T = next.start (Task 2).
2. A framing must hold across scene cuts and pinned holds. A deck time inside a later scene with no camera action shows the last framing (Task 2 + Task 4 e2e).
3. Text must not move or scale while the world zooms. The text box rect must be identical at zoom 1 and zoom 3 (Task 4 e2e).
4. Decks without any camera action must render pixel-identically to before. The transform must be `"none"` everywhere and the DOM moves must not change stacking. The existing render-page determinism and objects e2e must pass unchanged (Tasks 3–4).
5. Picking near an edge at high zoom must clamp, so the view never shows outside the stage (Task 5).

---

### Task 1: The camera action (type, validation, registry, timing, MCP docs)

**Files:**
- Modify: `engine/deck/types.ts`, `engine/deck-doc.ts` (validation), `engine/authoring/beat-clock.ts` (only if `default: return 0` doesn't already cover the new kind — verify), `lib/editor/registry.ts`, `lib/mcp/tool-defs.ts` (doc text)
- Test: `tests/unit/camera-action.test.ts`, plus the existing registry and validation tests where they enumerate kinds

**Interfaces — Produces:**
```ts
// engine/deck/types.ts
export type CameraEase = "inOut" | "in" | "out" | "linear";
export interface Framing { x: number; y: number; zoom: number }
// Action union gains:
| { kind: "camera"; to: { x?: number; y?: number; zoom?: number }; durationMs?: number; ease?: CameraEase }
```

- [ ] **Step 1: Failing tests.**
  - `actionDuration({ kind: "camera", to: { zoom: 2 } })` returns 0.
  - `validateDeckDoc` errors, at path `scenes[i].beats[j].timeline[k]`, on each of:
    - `to: {}` (message contains `camera needs at least one of x, y, zoom`);
    - `to.zoom: 0.5`;
    - `to.zoom: 9`;
    - `to.x: 1.2`;
    - `durationMs: -1`;
    - `ease: "bounce"`.
  - A valid camera action produces no errors.
  - `REGISTRY.camera.defaults()` deep-equals `{ kind: "camera", to: { zoom: 2, x: 0.5, y: 0.5 }, durationMs: 1200, ease: "inOut" }`.
  - The schema keys are `to.zoom` (range, min 1, max 8, step 0.05), `to.x` and `to.y` (number, 0–1, step 0.01), `durationMs` (number, min 0, step 50) and `ease` (select of the four values).
  - The MCP `ACTION_KINDS` includes `"camera"`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - Add the types.
  - Add a `validateCameraActions(scene, si, e)` next to `validateSceneActionTargets`, using the same pattern and the same message style (for example `${at}.to.zoom must be 1–8`). Call it in the same place.
  - Add the registry entry with label `"Camera"`, icon `"ti-zoom-in"` and `seekable: true`.
  - In tool-defs, extend the `update_action` / `add_action` description with one sentence: `camera actions pan/zoom the world layers (art, tiles, notes, objects; text stays fixed): to {x,y,zoom 1–8}, durationMs (0 = cut), ease inOut|in|out|linear; a framing holds until the next camera action`.
  - Fix every `switch(action.kind)` that has `never` exhaustiveness. Let tsc find them; a camera action is a no-op in each of those switches.
- [ ] **Step 4: Run.** `npm test` and `npx tsc --noEmit`.
- [ ] **Step 5: Commit.** `feat(engine): camera timeline action (type, validation, registry)`

---

### Task 2: Camera clock (pure)

**Files:**
- Create: `engine/authoring/camera-clock.ts`, `tests/unit/camera-clock.test.ts`
- Modify: `tests/unit/pure-import-graph.test.ts` (add to the DOM list and the node-builtin list)

**Interfaces — Produces:**
```ts
export const FULL_FRAME: Framing;
export const CAMERA_DEFAULT_MS = 1200;
export interface CameraEvent { start: number; duration: number; to: Partial<Framing>; ease: CameraEase }
export function clampFraming(f: Framing): Framing;
export function cameraEase(e: CameraEase, p: number): number;
export function cameraEvents(doc: DeckDoc): CameraEvent[];
export function cameraAt(events: CameraEvent[], T: number): Framing;
export function cameraTransform(f: Framing): string;
```

- [ ] **Step 1: Failing tests.** Build decks with the helpers already used in `tests/unit/art-clock-night.test.ts`.
  - **`clampFraming`:**
    - `{x:0,y:1,zoom:2}` gives `{x:0.25,y:0.75,zoom:2}`;
    - zoom 0.5 gives 1, and zoom 10 gives 8;
    - at zoom 1, x and y are clamped to 0.5.
  - **`cameraEase`:**
    - `inOut` at 0.5 is 0.5, and at 0.25 equals `power2InOut(0.25)`;
    - `in` at 0.5 is 0.125;
    - `out` at 0.5 is 0.875;
    - `linear` is the identity.
  - **`cameraEvents`:**
    - a camera action in beat 2 at window start 1.5, where beat 2 starts at deck 4, gives `start` 5.5;
    - `duration` is `durationMs / 1000`, or 1.2 by default;
    - `ease` defaults to `inOut`;
    - an action past a pinned scene's cut produces no event.
  - **`cameraAt`:**
    - no events gives `FULL_FRAME`;
    - a move `{zoom:4}` at 0 over 2 s, `linear`: at T=1, zoom ≈ 2 (log-space midpoint) and x = y = 0.5; at T=2 and T=10, zoom is 4;
    - a pan `{x:0.8,zoom:2}`: at its end x = 0.75 (clamped) and zoom = 2;
    - after `{zoom:3}`, a later `{x:0.6}` keeps zoom 3, because omitted fields are kept;
    - a 0 ms cut back to `{zoom:1}` gives `FULL_FRAME` from that instant;
    - **Review Focus #1:** a move A from zoom 1→4 over 2 s at 0, interrupted by B `{zoom:1}` over 1 s at 1. Just before T=1 (T=1−1e-9) and at T=1 the value is the same (|Δzoom| < 1e-6). B starts from A's T=1 value.
    - **Review Focus #2:** a framing set in scene 1 holds at a deck time inside scene 3, which has no camera actions.
  - **`cameraTransform`:**
    - `FULL_FRAME` gives `"none"`;
    - `{x:0.25,y:0.75,zoom:2}` gives `"translate(0%, -100%) scale(2)"`. Compute it as (0.5 − 0.25·2)·100 = 0 and (0.5 − 0.75·2)·100 = −100;
    - no `-0` appears in the output (normalise −0 to 0).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
```ts
/** Camera framing as a pure function of deck time (timed-video sub-project 5). Pure: no DOM,
 *  GSAP or React — enforced by tests/unit/pure-import-graph.test.ts. */
import type { CameraEase, Framing } from "@/engine/deck/types";
import type { DeckDoc } from "@/engine/deck-doc";
import { deckLayout } from "./deck-clock";
import { beatTimeline } from "./beat-clock";
import { clamp01, power2InOut } from "./art-clock";

export const FULL_FRAME: Framing = { x: 0.5, y: 0.5, zoom: 1 };
export const CAMERA_DEFAULT_MS = 1200;
const MIN_ZOOM = 1, MAX_ZOOM = 8;
export interface CameraEvent { start: number; duration: number; to: Partial<Framing>; ease: CameraEase }

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export function clampFraming(f: Framing): Framing {
  const zoom = clamp(f.zoom, MIN_ZOOM, MAX_ZOOM);
  const m = 0.5 / zoom;
  return { zoom, x: clamp(f.x, m, 1 - m), y: clamp(f.y, m, 1 - m) };
}

export function cameraEase(e: CameraEase, p: number): number {
  switch (e) {
    case "in": return p * p * p;
    case "out": return 1 - Math.pow(1 - p, 3);
    case "linear": return p;
    default: return power2InOut(p);
  }
}

export function cameraEvents(doc: DeckDoc): CameraEvent[] {
  const out: CameraEvent[] = [];
  for (const s of deckLayout(doc).scenes) {
    const scene = doc.scenes[s.sceneIdx];
    const reached = (localStart: number) => !s.pinned || localStart < s.length;
    for (const b of s.beats) {
      if (!reached(b.start)) continue;
      for (const w of beatTimeline(scene.beats[b.beatIdx].timeline)) {
        if (w.action.kind !== "camera" || !reached(b.start + w.start)) continue;
        const a = w.action;
        out.push({ start: s.start + b.start + w.start, duration: (a.durationMs ?? CAMERA_DEFAULT_MS) / 1000, to: { ...a.to }, ease: a.ease ?? "inOut" });
      }
    }
  }
  return out;
}

export function cameraAt(events: CameraEvent[], T: number): Framing {
  let f = FULL_FRAME;
  for (let i = 0; i < events.length && events[i].start <= T; i++) {
    const e = events[i];
    const until = i + 1 < events.length && events[i + 1].start <= T ? events[i + 1].start : T;
    const p = e.duration <= 0 ? 1 : cameraEase(e.ease, clamp01((until - e.start) / e.duration));
    const to = clampFraming({ ...f, ...e.to });
    f = clampFraming({
      zoom: Math.exp(Math.log(f.zoom) + (Math.log(to.zoom) - Math.log(f.zoom)) * p),
      x: f.x + (to.x - f.x) * p,
      y: f.y + (to.y - f.y) * p,
    });
  }
  return f;
}

const r6 = (n: number) => { const v = Math.round(n * 1e6) / 1e6; return v === 0 ? 0 : v; };
export function cameraTransform(f: Framing): string {
  if (f.zoom === 1 && f.x === 0.5 && f.y === 0.5) return "none";
  return `translate(${r6((0.5 - f.x * f.zoom) * 100)}%, ${r6((0.5 - f.y * f.zoom) * 100)}%) scale(${r6(f.zoom)})`;
}
```
  - **Check against the clamp before writing the test:** `{x:0.25, y:0.75, zoom:2}` is already inside the clamp range (0.25–0.75), so it is not clamped. Keep the test value as given.
- [ ] **Step 4: Run** the tests, the pure-import-graph test, `npm test` and tsc. Expect PASS.
- [ ] **Step 5: Commit.** `feat(engine): pure camera clock — cameraEvents/cameraAt/cameraTransform`

---

### Task 3: World layers (ArtStage, CinematicSlide tiles, BeatStage notes and objects)

**Files:**
- Modify: `engine/components/ArtStage.tsx`, `engine/components/layouts/CinematicSlide.tsx`, `engine/authoring/BeatStage.tsx`, `components/player/DeckStage.tsx` (the `Stage` passthrough only)
- Tests: `tests/unit/camera-world.test.tsx` (new), plus the existing ArtStage, tile and BeatStage tests (update selectors only where a parent changed)

**Interfaces — Produces:**
```ts
// ArtStageHandle gains:
setCamera(transform: string): void;            // writes .artstage__world style.transform when changed
// CinematicSlide + BeatStage props gain:
cameraRef?: React.RefObject<Framing>;          // host-driven: read at paint time
camera?: { events: CameraEvent[]; beatStart: number };   // BeatStage autoplay only; ignored when cameraRef is set
```

- [ ] **Step 1: Failing tests.**
  - **ArtStage:**
    - art layers (`img` and `video` `.artstage__layer`) live inside `.artstage > .artstage__world`, and `.artstage__glow` is a direct child of `.artstage`, outside the world;
    - `setCamera("translate(0%, -100%) scale(2)")` sets the world's `style.transform` and `transformOrigin "0 0"`;
    - calling it again with the same string causes no write. Spy on the `style` setter, or count with a MutationObserver attributes record.
    - `renderState` and `show` still reconcile layers inside the world.
  - **CinematicSlide:** media tiles are appended to `.cin__world`, not `.cin__stage`; text stays in `.cin__stage`. `.cin__world` comes before `.cin__stage` in DOM order and has a lower `z-index`, so text paints above tiles.
  - **Camera prop:** when CinematicSlide is given a `cameraRef` whose current value is `{x:0.25,y:0.75,zoom:2}`, a `transport.seek(t)` paints `.cin__world` `style.transform` with `cameraTransform(...)`. At `FULL_FRAME` the transform is `"none"`, or empty.
  - **BeatStage:**
    - NoteField and ObjectStage are wrapped in `.beat__world`;
    - the wrapper's transform follows `cameraRef` on each `onTime`;
    - their z-index stacking relative to the text wrapper is unchanged. Assert the computed order: `.notefield` z 2, objects z 6, CinematicSlide wrapper unchanged.
  - **BeatStage autoplay with a `camera` prop** `{ events: [{start:0,duration:0,to:{zoom:2},ease:"linear"}], beatStart: 0 }`: after mount, `.cin__world` and `.beat__world` carry `scale(2)`.
  - **Review Focus #4:** with no camera, every world transform is `"none"` or empty. The existing ArtStage, tile, BeatStage, deck-stage and render tests pass. List any test where only a selector changed.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - **ArtStage:**
    - Add an inner `<div className="artstage__world" style={{position:"absolute",inset:0,transformOrigin:"0 0"}}>`.
    - Every layer query and append goes to it. Keep `.artstage__layer` CSS unchanged.
    - The glow stays on the root.
    - `setCamera` keeps a `lastCamera` ref and writes only on change.
  - **CinematicSlide:**
    - Render `<div className="cin__world" />` as the first child of the stage wrapper, before `.cin__stage`, with CSS `position:absolute; inset:0; z-index:1; pointer-events:none; transform-origin:0 0`. `.cin__stage` is already z-index 2.
    - Tiles use a new `worldParent()`.
    - In `renderAt`'s paint, after `paintMedia`, write `world.style.transform = cameraTransform(frame)` only when changed. Here `frame = cameraRef?.current ?? (cameraProp ? cameraAt(cameraProp.events, cameraProp.beatStart + t) : FULL_FRAME)`.
  - **BeatStage:**
    - Wrap `<NoteField/>` and `<ObjectStage/>` in `<div className="beat__world" style={{position:"absolute",inset:0,transformOrigin:"0 0",pointerEvents:"none"}}>`. Children keep their own z-index and pointer events. Check that ObjectStage still receives pointer events if it needs them in BeatStage; it is display-only here.
    - Paint it in the existing `paint(t)` callback the same way CinematicSlide does.
    - Forward `cameraRef` and `camera` to CinematicSlide.
  - **DeckStage `Stage`:** accept and forward `cameraRef`. This task does not compute it yet; Task 4 does.
- [ ] **Step 4: Run** the focused tests, `npm test` and tsc. Then run `npm run test:e2e -- e2e/render-page.spec.ts e2e/play.spec.ts e2e/objects-playback.spec.ts e2e/beatstage.spec.ts --project=default`. These must pass unchanged (Review Focus #4).
- [ ] **Step 5: Commit.** `feat(engine): world layers take a camera transform; text stays fixed`

---

### Task 4: Deck-time camera in `/play` and `/render` (+ e2e)

**Files:**
- Modify: `components/player/DeckStage.tsx`, plus `RenderStage.tsx` and `TimedPlayer.tsx` only if needed
- Tests: `tests/unit/deck-stage.test.tsx` (add cases), `e2e/render-page.spec.ts`, `e2e/play.spec.ts`

**Interfaces — Consumes:** Tasks 2 and 3. **Produces:** `useDeckStage` return value gains `cameraRef: React.MutableRefObject<Framing>`.

- [ ] **Step 1: Failing unit tests (DeckStage).**
  - The deck has a camera action `{zoom:3,x:0.3,y:0.4}` over 2 s at beat 1 t=0.5.
  - `apply(1.5)`: the ArtStage world, `.cin__world` and `.beat__world` all carry the same string, `cameraTransform(cameraAt(events, 1.5))`. Text (`.cin__text`) has no transform.
  - `apply(10)` holds the end framing.
  - A two-scene deck: after a cut into scene 2, the framing persists.
  - `Stage` does not re-render when only the framing changes. Count renders with a spy on BeatStage, or use the existing re-render test pattern in `deck-stage.test.tsx`.
- [ ] **Step 2: Implement.**
  - `const camEv = useMemo(() => cameraEvents(doc), [doc])` and `const cameraRef = useRef<Framing>(cameraAt(camEv, T.current))`.
  - In `apply`, after setting T and before the seek: `cameraRef.current = cameraAt(camEv, T.current); artRef.current?.setCamera(cameraTransform(cameraRef.current))`.
  - Paint once in the mount layout effect.
  - Pass `cameraRef` to `Stage`.
  - The beat's own paint picks the framing up on seek. A beat swap mounts, and the layout-effect seek paints it.
- [ ] **Step 3: e2e.**
  - **`render-page.spec.ts` "camera is deterministic"**, with `retries: 0`. Use the existing deck-builder helpers. The deck has a camera move `{zoom:3,x:0.3,y:0.4}` over 2 s in scene 1, a scene cut at 4 s with the framing persisting, then `{zoom:1}` over 1 s at 5 s. Compare stepped and jumped renders by screenshot bytes plus the world transform strings at three points:
    - T = 1.0, mid-zoom;
    - T = 4.5, after the cut;
    - T = 5.4, mid zoom-out;
    - and once more after a backward jump from 5.4 to 1.0.
  - **Review Focus #3:** a deck with a text line and art. Measure `getBoundingClientRect()` of `.cin__text` (or the line element) at T where zoom = 1 and where zoom = 3. Expect it identical within 0.5 px, while `.artstage__world`'s rect width is ×3 (±1 px).
  - **Review Focus #4:** the existing determinism and clips tests in render-page must still pass unchanged.
  - **`play.spec.ts`:** open `/play` with a camera deck at `t=1`, scrub to 1.8, and check that the `.artstage__world` transform equals the expected string. Compute it in the test by importing `cameraAt`/`cameraTransform`, or hardcode the value computed for the fixture.
- [ ] **Step 4: Run** the unit tests, `npm test` and tsc. Then run `npm run test:e2e -- e2e/render-page.spec.ts e2e/play.spec.ts --project=default` and `--repeat-each=3` on render-page.
- [ ] **Step 5: Commit.** `feat(player): deck-time camera in /play and /render; camera determinism e2e`

---

### Task 5: Editor — canvas preview and "Pick on canvas"

**Files:**
- Modify: `components/editor/DeckCanvas.tsx`, `components/editor/Inspector.tsx`, `lib/editor/registry.ts` (only to mark the camera schema for the pick button, e.g. `pick: "camera"` on the entry)
- Create: `components/editor/CameraPick.tsx`
- Tests: `tests/unit/camera-pick.test.tsx`, `tests/unit/deck-canvas-camera.test.tsx`, `e2e/camera-editor.spec.ts`

- [ ] **Step 1: Failing tests.**
  - **DeckCanvas preview:**
    - Given a doc with a camera action and a selected beat at deck start S, after a draw at local `t` the ArtStage world transform equals `cameraTransform(cameraAt(cameraEvents(doc), S + t))`.
    - The NoteField wrapper gets the same transform. Wrap NoteField in DeckCanvas in a `.beat__world`-style div.
    - The editor ObjectStage and text layer get none.
    - DeckCanvas currently receives `flat` and `scene`. It also needs the doc and the beat's deck start. Read how the editor page passes props and use the store's `doc` with `deckLayout`. Do not guess the prop names.
  - **CameraPick:**
    - Rendered over the canvas with `zoom` = 4, a pointer move at canvas fraction (0.9, 0.1) draws the overlay rect with width 25% and height 25%, centred and clamped to x = 0.875, y = 0.125.
    - A click calls `onPick({x:0.875,y:0.125})` once. Esc calls `onCancel` and stops propagation.
    - While picking, the canvas preview is at `FULL_FRAME`.
  - **Inspector:**
    - The Camera action shows a **Pick on canvas** button (`camera-pick`).
    - Clicking it enters pick mode. Signal the canvas through the editor store or a small context; read how DeckCanvas and Inspector share state today.
    - `onPick` writes `to` as one object, `{ ...to, x, y }`, through `updateAction(..., "to", next)`, so it is a single undo step.
- [ ] **Step 2: Implement** per the spec §4. The overlay is `data-testid="camera-pick-overlay"`, with a crosshair cursor and a 2px outline rectangle.
- [ ] **Step 3: e2e** `e2e/camera-editor.spec.ts`, using the setup pattern from `e2e/timeline-actions.spec.ts`:
  - add a Camera action;
  - set Zoom to 3;
  - click **Pick on canvas**, then click near the top-left of the canvas;
  - expect `to.x` and `to.y` to be clamped (≈ 0.1667) after the save;
  - expect the canvas `.artstage__world` transform to contain `scale(3)` at the action's end.
- [ ] **Step 4: Run** the unit tests, `npm test`, tsc and `npm run build`. Then run `npm run test:e2e -- e2e/camera-editor.spec.ts e2e/inspector.spec.ts e2e/deck-canvas.spec.ts e2e/object-drag.spec.ts --project=default`. Object dragging must be unaffected.
- [ ] **Step 5: Commit.** `feat(editor): camera preview on the canvas + Pick on canvas`

---

### Task 6: Lint

**Files:** Modify `lib/editor/lint.ts`. Test `tests/unit/lint-camera.test.ts`.

- [ ] **Step 1: Failing tests.**
  - **`camera-overlap`:** a camera action starting while the previous one's `start + duration` is still in the future, in deck time via `cameraEvents`. Expect a warning at the later action's location, with the message `camera move starts before the previous one finishes (interrupts it)`. Back-to-back moves and a 0 ms cut that follows a finished move produce nothing.
  - **`camera-zoom-soft`:** a camera action whose resulting zoom (from `cameraAt` at that event's end) is above 2, while the art stack at that deck time contains a built-in panel key (not a `media:` ref) from art-clock `artAt`. The message is `zoom ${z.toFixed(1)}× on built-in panel art will look soft — use higher-resolution art`. Uploaded media at zoom 4 produces nothing.
  - Both rules run only on a structurally clean deck, on the same path as `timingWarnings`.
- [ ] **Step 2: Implement** with `cameraEvents`, `cameraAt`, `artEvents` and `artAt`. Map events back to their locations by walking the doc in parallel, the same way `cameraEvents` does. Store `sceneIdx`, `beatIdx` and `actionIdx` on an internal event list; do not change the exported `CameraEvent` type, and use a local helper.
- [ ] **Step 3: Run** the tests, `npm test` and tsc.
- [ ] **Step 4: Commit.** `feat(editor): lint camera overlap and soft zoom on built-in art`

---

### Task 7: Docs

**Files:** Modify `README.md` and the spec status line.

- [ ] **Step 1: README.** Add a "Camera moves" section next to "Images and video clips". It covers:
  - the action fields and defaults;
  - that world layers move and text stays;
  - that a framing holds until the next move;
  - Pick on canvas;
  - that the editor preview leaves objects at full frame;
  - zoom softness and the art-resolution tip;
  - the lint rules.
- [ ] **Step 2:** Set the spec status to `implemented (sub-project 5)`.
- [ ] **Step 3: Commit.** `docs: camera moves`

---

## Self-review notes (plan author)

- **Spec coverage:**
  - §1 → T1.
  - §2 → T2.
  - §3 → T3 (layers) and T4 (deck time).
  - §4 → T5 (editor), T6 (lint), T1 (MCP docs).
  - §6 → spread across T1–T6.
  - §7 → T7 (README tip).
- **Review Focus coverage:**
  - #1 → T2.
  - #2 → T2 and the T4 e2e.
  - #3 → T4 e2e.
  - #4 → T3 and T4.
  - #5 → T5.
- **Deep-dive:** `docs/MM_MORGANA.md` is synced at closeout.
