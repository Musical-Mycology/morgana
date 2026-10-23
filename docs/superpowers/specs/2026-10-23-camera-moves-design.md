# Camera moves — design

**Status:** approved design (sub-project 5)
**Roadmap:** timed-video sub-project 5 of 6. See
[Deck clock + timed Player](2026-10-22-deck-clock-timed-player-design.md) §0.2, which builds on
[MP4 render](2026-10-24-mp4-render-design.md) (#38) and [Video clips](2026-10-23-video-clips-design.md) (#40).

**Driving use case:** the Alt-Ctrl 2027 festival video's transitions:
- Opening → Background (~15 s): "expand container, zoom into the space behind the mosaic".
- Background → Gameplay (~40 s): "zoom into the concept-art installation on the beat drop".
- Gameplay → Credits (~90 s): the same expand-and-zoom again.

These must look identical in `/play`, the editor scrub and the frame-accurate MP4 render.

---

## 0. Decisions (from brainstorming)

| Question | Decision |
|---|---|
| What moves | **World layers only.** These are art (incl. clips), media tiles, notes and objects. Text, counters, the ending card, chrome and the nightlight glow stay screen-fixed |
| Persistence | **Until the next move.** A framing holds across beats and scenes. A cut back to full frame is a 0 ms move |
| Authoring | A **Camera** timeline action with fields **plus "Pick on canvas"**. The editor canvas previews the framing |
| Approach | One pure `cameraAt(T)`, painted as the **same CSS transform on each world layer** |

The "expand container" half of the storyboard is already possible: a media tile can grow with `media_move` (`scale`, `to`). The camera adds the zoom.

## 1. Model and action

- **`Framing = { x: number; y: number; zoom: number }`.**
  - `x` and `y` are the normalised stage point (0–1) at the centre of the view.
  - `zoom` is from `1` (full frame) to `8`.
  - `FULL_FRAME = { x: 0.5, y: 0.5, zoom: 1 }`.
- **Clamping.** `clampFraming(f)` clamps `zoom` to [1, 8], then clamps `x` and `y` to `[0.5/zoom, 1 − 0.5/zoom]`, so the view never leaves the stage.
- **New `Action` variant:**
  `{ kind: "camera"; to: { x?: number; y?: number; zoom?: number }; durationMs?: number; ease?: CameraEase }`.
  - `CameraEase = "inOut" | "in" | "out" | "linear"`.
  - Omitted `to` fields keep the current value.
  - `durationMs` defaults to `1200`. `0` is a cut.
  - `ease` defaults to `"inOut"`.
- **Timing.** Like `art` and `nightlight`, the action takes no time in the beat timeline (`actionDuration` 0). Its motion runs in parallel over `durationMs`.
- **Validation** (`validateDeckDoc`):
  - `to.zoom` must be in [1, 8]; `to.x` and `to.y` in [0, 1].
  - `durationMs` must be ≥ 0.
  - `ease` must be one of the four values.
  - `to` must have at least one field.

## 2. Camera clock (pure)

`engine/authoring/camera-clock.ts` joins the pure-import-graph test, including its node-builtin guard.

- **Eases.** All closed-form ports of GSAP, with tests against GSAP:
  - `inOut` = `power2.inOut` (reuse `power2InOut` from art-clock);
  - `in` = `power2.in`, i.e. `p³`;
  - `out` = `power2.out`, i.e. `1 − (1−p)³`;
  - `linear` = `p`.
- **`cameraEvents(doc): CameraEvent[]`**, where `CameraEvent = { start, duration, to, ease }` and times are deck seconds.
  - It walks the deck exactly like `nightEvents`: `deckLayout` scenes and beats.
  - It uses the same reach rule: a pinned scene's content past its cut is never reached.
  - Each `camera` action in a beat timeline becomes an event at `beatStart + window.start`.
- **`cameraAt(events, T): Framing`.**
  - Start from `FULL_FRAME`.
  - Each event with `start ≤ T` is evaluated up to the next event's start, or up to `T` for the last one.
  - **From** is the framing in effect at the event's start. That includes a move still in flight, which gets interrupted.
  - **To** is the event's `to` merged over **From**, then clamped.
  - `p = ease(clamp01((until − start) / duration))`. A `duration` of 0 gives `p = 1`.
  - `zoom = exp(lerp(ln from.zoom, ln to.zoom, p))`. Log space gives a steady perceived zoom.
  - `x` and `y` are lerped with the same `p`.
  - The result is clamped again, because a pan during a zoom can leave the safe range.
- **`cameraTransform(f): string`.**
  - Returns `` `translate(${(0.5 − f.x·f.zoom)·100}%, ${(0.5 − f.y·f.zoom)·100}%) scale(${f.zoom})` `` with `transform-origin: 0 0`.
  - `FULL_FRAME` gives exactly `"none"`, so decks without camera actions paint nothing new.
  - Numbers are rounded to 6 decimals, so the string is deterministic.

## 3. World layers and painting

- **World layers**, which take the camera:
  - the ArtStage root, including clip layers;
  - media tiles;
  - NoteField;
  - ObjectStage.
- **Fixed layers**, which never move:
  - text lines and text boxes;
  - counters;
  - `rotateList`;
  - the ending card and chrome;
  - the nightlight glow. It is a child of the ArtStage root, so it is moved out of the transformed element: the ArtStage root stays fixed, and the art layers live in an inner `.artstage__world` wrapper that takes the transform.
- **CinematicSlide.** Media tiles move from `.cin__stage` into a new `.cin__world` sibling, which is absolutely positioned, fills the stage, is `pointer-events: none`, and sits **beneath** text in stacking order. `stageParent()` for tiles returns `.cin__world`; text keeps `.cin__stage`.
- **NoteField and ObjectStage.** BeatStage wraps both in one `.beat__world` container. Their z-indexes (2 and 6) are preserved inside it, so stacking relative to text does not change.
- **How the framing reaches the layers:**
  - `useDeckStage` owns `cameraRef: MutableRefObject<Framing>`. `apply(T)` sets `cameraRef.current = cameraAt(events, T)` and paints the ArtStage world wrapper.
  - The ref is passed through the memoised `Stage` → `BeatStage` → `CinematicSlide` as a stable prop, the same pattern as `clipModeRef`. Each layer paints `cameraTransform(cameraRef.current)` in its own paint.
  - Changing the framing never re-renders `Stage`.
  - CinematicSlide paints `.cin__world` in `renderAt`. BeatStage paints `.beat__world` in its `paint` callback, which `onTime` already fires every frame.
- **`/render`** inherits all of this through DeckStage, and frames stay deterministic.
- **Autoplay** (BeatStage without a deck clock):
  - BeatStage accepts an optional `camera?: { events: CameraEvent[]; beatStart: number }`.
  - The host that knows the doc computes it with `cameraEvents(doc)` and the beat's deck start from `deckLayout`.
  - CinematicSlide, NoteField and ObjectStage then paint `cameraAt(events, beatStart + t)` at the beat-local `t`.
  - With no `camera` prop the world stays at `FULL_FRAME`.
- **Paint rules:** no `will-change: transform` on world layers, so Chromium re-rasterises zoomed art at the output resolution instead of scaling a cached bitmap. The transform is written only when the string changes.

## 4. Editor, lint, MCP

- **Registry.** A `camera` action entry: label "Camera", icon `ti-zoom-in`, seekable. Schema:
  - `to.zoom`: range, 1–8, step 0.05;
  - `to.x` and `to.y`: number, 0–1, step 0.01;
  - `durationMs`: number;
  - `ease`: select.

  Defaults: `{ kind: "camera", to: { zoom: 2, x: 0.5, y: 0.5 }, durationMs: 1200, ease: "inOut" }`.
- **Pick on canvas.** The Camera action's inspector has a **Pick on canvas** button.
  - While picking, the editor canvas shows the full frame with the camera off.
  - It draws an outline rectangle of the view the current `to.zoom` would show, centred on the pointer and clamped like `clampFraming`.
  - A click writes `to.x` and `to.y` from the clamped centre, as one undo step. Esc cancels.
  - Testids: `camera-pick`, `camera-pick-overlay`.
- **Canvas preview.** DeckCanvas paints `cameraAt(cameraEvents(doc), beatDeckStart + t)` on its world layers at the scrub point, so the editor shows what `/play` and the render show.
- **Lint warnings:**
  - `camera-overlap`: a camera action starts while the previous move is still running. This is legal (it interrupts), but usually unintended.
  - `camera-zoom-soft`: `zoom > 2` while the framed art is a built-in panel key. Raster art gets soft when zoomed. Uploaded art isn't flagged, because its resolution is unknown to lint.
- **MCP.** The tool docs describe the camera action shape and that it holds until the next move. There is no new tool: `add_action` and `update_action` cover it.

## 5. Out of scope

- Rotation and tilt.
- Motion blur.
- Per-layer camera choice.
- Parallax (layers moving at different rates).
- Camera keyframes on objects.
- Easing curves beyond the four eases.
- Scene-level default framing (a 0 ms move on a scene's first beat does the same).

## 6. Testing

- **Unit tests.**
  - `clampFraming`.
  - Eases against GSAP.
  - `cameraEvents`: reach rule; events at beat timeline offsets; multiple scenes.
  - `cameraAt`:
    - `FULL_FRAME` default;
    - log-space zoom: a 1→4 move at its midpoint gives zoom 2;
    - the pan is clamped during a zoom;
    - the framing holds across beats and scenes;
    - a 0 ms cut;
    - an interrupted move starts from the framing it was interrupted at;
    - omitted `to` fields keep their value.
  - `cameraTransform`, including the `"none"` string at full frame.
  - DeckStage: art world, tiles, notes and objects get the same transform, and text gets none. A framing change does not re-render `Stage`.
  - CinematicSlide: tiles live in `.cin__world`, which sits under text.
  - BeatStage autoplay with a `camera` prop.
  - Editor pick: the overlay rectangle size follows zoom; a click sets the clamped x/y in one undo step; Esc cancels.
  - Canvas preview equals `cameraAt`.
  - Validation and lint rules.
- **e2e tests.**
  - `render-page` determinism with a camera move: stepped and jumped frames byte-equal mid-zoom, across a scene cut, and on a backward jump. Retries pinned to 0.
  - A screenshot check that text stays fixed: the text box rect is identical at zoom 1 and zoom 3, while an art layer's rect is scaled.
  - `/play`: after a scrub, the world transform equals `cameraTransform(cameraAt(T))`.
  - Editor: add a Camera action, pick a point, and the canvas preview shows the zoomed world.

## 7. Risks

- **Soft art.** Zoom scales raster art, so a 1920-wide panel looks soft past about 2×. Supply 2–3× art for zoom shots. Lint flags built-in panels.
- **Render cost.** A per-frame transform on large images and video makes each render frame a little more expensive. This is acceptable at 30 fps.
- **DOM moves.** Tiles move from `.cin__stage` to `.cin__world`, and the nightlight glow moves out of the transformed ArtStage element. Existing tests and selectors that assume the old parents need updating. Stacking order is preserved.
