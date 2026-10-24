# Credits, drawn titles, text particles and fade to black: design

**Status:** implemented (sub-project 6, the last on the timed-video roadmap). Plan: `docs/superpowers/plans/2026-10-23-credits-particles.md`.
**Roadmap:** timed-video sub-project 6 of 6; see [Deck clock + timed Player](2026-10-22-deck-clock-timed-player-design.md) §0.2. It builds on [MP4 render](2026-10-24-mp4-render-design.md), [Camera moves](2026-10-23-camera-moves-design.md) and the note-deck full-raster fix.
**Driving use case:** the Alt-Ctrl 2027 festival video's Credits section (90–120 s). It shows "credits with particle lines coming off the words" and ends with a fade to black. It must be identical in `/play`, the editor scrub and the frame-accurate MP4 render.

---

## 0. Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Credits form | A **drawn title** that holds near the top, plus a **standard upward roll** in a separate area below it. No timed cards. |
| Draw effect | **Outline stroke, then fill.** Each glyph's outline is traced like a pen, then the fill fades in. |
| Particles | **Music-note glyphs off the words**, reusing the deterministic note sprites. |
| Emitters | **Any text line, opt-in** (`particles`), including credit lines. |
| Layout | Title at the top and roll below by default. The roll area is adjustable. |
| Approach | Four small time-pure pieces inside the existing text and particle systems (not a separate canvas, not a pre-made clip). |

## 1. "Draw" text style

- **The style.** `TextIn` gains `"draw"`. A line with `in: "draw"` is rendered as an inline SVG `<text>` in place of the HTML line, with each glyph in its own `<tspan>` so the browser still lays out the line. It keeps the same font family, weight, size, colour, alignment and `pos`. Positioned lines and the shared box both work.
- **Outline phase.**
  - `stroke = currentColor`, `stroke-width` is 1.5% of the font size, `fill-opacity: 0`.
  - `stroke-dasharray: L` and `stroke-dashoffset` animate from `L` to `0`. `L` is a per-line constant, a font-size-relative upper bound on the outline length.
  - Glyphs are staggered left to right, 0.08 s per character.
- **Fill phase.** 0.4 s: `fill-opacity` goes 0 → 1 and `stroke-opacity` goes 1 → 0.
- **Timing.** `introDuration` for `"draw"` = `(0.1 + chars·0.08 + 0.4) / speed`, with `speed` defaulting to 1.
- **Determinism.** It is built as a paused GSAP timeline in `buildTextEffect`, so CinematicSlide seeks it like every other style.
- **Probe and fallback.**
  - The first plan task checks that Chromium dashes each glyph's outline independently, and that the result is deterministic.
  - If the probe fails, the outline phase becomes a soft-edged `mask-image` sweeping left to right over the stroked glyphs, at the same timing. The fill phase is unchanged.
  - The plan records which variant shipped.

## 2. Note particles off text

- **Opt-in.** `text` actions gain `particles?: { color?: NoteColor | string; rate?: number; rise?: number }`.
  - `color` is a `NoteColor` name (resolved through `NOTE_TINTS[c].fill`) or any CSS hex, like `note_emitter.color`. It defaults to `"cream"`.
  - `rate` is notes per second, default 6.
  - `rise` scales the travel distance, default 1.
- **Text sources.**
  - After a line is built and `document.fonts.ready` resolves, CinematicSlide measures the line's **word boxes**. These are spans per word, `getBoundingClientRect` relative to the stage, normalised to 0–1.
  - It publishes `TextSource = { key, start, end?, rects, color, rate, rise }` to BeatStage through a stable ref.
    - `start` is the line's start in the beat.
    - `end` is the first `clear`, `fade_out` or `stop_notes` after the line, if any.
    - `scroll?` (credit lines only) is `{ t0, dur, from, to }`, the linear vertical offset of the source's rects over beat time (§3).
  - **Draw lines:** for a `"draw"` line the boxes are measured from the SVG glyph geometry instead.
  - **Readiness.** Measuring is asynchronous, so CinematicSlide exposes a pending-sources promise. `/render`'s `renderFrame` awaits it after `pendingVideoSeeks` and before the image-decode step. A frame is never captured before the boxes exist.
- **Pure state.** `textSpritesAt(src, srcIdx, elapsed)` lives in `note-state.ts`.
  - Note *i* is born at `i / rate`, and it is only emitted while `start ≤ birth < end`.
  - It picks a rect with `mulberry32(hash32(TEXT_SEED + srcIdx, i))` (`TEXT_SEED = 0x10000`, so text seeds never collide with emitter seeds), then an x position inside the rect, and y at the rect's top. With `scroll`, y is that top shifted by the offset at the note's **birth** time. The note then rises from where it was born and does not follow the scroll.
  - Keys are `t${srcIdx}:${i % P}`, a different key space from the emitter keys `${srcIdx}:…`.
  - It moves like an emitter note (the same bounce, travel and fade curves as `emitterSpritesAt`) with `dir` 0 (up) ± 25°, a 2.4 s lifetime and distance `EMIT_SPEED_N · 2.4 · mult · rise`.
  - It uses the existing caps (`MAX_SPRITES_PER_SOURCE`, `MAX_SPRITES_TOTAL`).
  - `noteFieldStateAt(scene, beatIndex, t, textSources?)` appends these sprites, so existing note behaviour is unchanged when there are no text sources.
- **Painting.** NoteField paints them with the existing glyphs, in a second sprite container `.notefield__text`. It sits in the **fixed** layer stack just below the text layer and outside the camera world. Text never moves with the camera (sub-5), so its particles stay attached to the words during a camera move. Emitter and circle notes stay in the world layer as before.
- **Render gate.** The `/render` full-raster gate (`needsFullRaster`) also covers decks with any `text.particles` or credits `particles`, through `hasNoteActions` → `hasNoteSources`.

## 3. Credits roll

- **Action.** `{ kind: "credits"; items: { role?: string; names: string[] }[]; area?: { x: number; y: number; w: number; h: number }; durationMs: number; particles?: TextParticles }`.
  - The default area is `{ x: 0.2, y: 0.32, w: 0.6, h: 0.63 }`.
  - `actionDuration` = `durationMs`, so the beat waits for the roll.
- **Rendering.**
  - CinematicSlide builds one `.cin__credits` block in the **fixed text layer** (inside `.cin__stage`, so the camera never moves it), clipped to `area` with `overflow: hidden`.
  - The edges fade with `mask-image: linear-gradient(transparent, #000 8%, #000 92%, transparent)`.
  - Each item renders an optional `role` line in the small uppercase style, then one line per name in the body style.
- **Scroll.** `creditsOffset(t, durationMs, blockH, areaH)` is pure: `translateY` runs linearly from `areaH` (the block starts just below the area) to `−blockH` (it ends just above). `blockH` is measured at build and re-measured on every measurement pass (layout change, stage resize, late font).
- **Particles.** With `particles`, each credit line (role or name) is a text source with `scroll` set from `creditsOffset`. It emits only while its top edge is inside the area. That window is computed in closed form from the linear offset and intersected with `[start, end)`, so notes never come from clipped-out lines.

## 4. Fade to black

- **Action.** `{ kind: "screen_fade"; to: number /* 0–1 */; color?: string /* default "#000" */; durationMs?: number /* default 1000 */ }`.
  - `actionDuration` is 0, so the fade runs in parallel with what follows. The level reached holds until the next fade, across beats and scenes, the same model as the nightlight.
- **Clock.** `engine/authoring/fade-clock.ts` (pure) exports `fadeEvents(doc)` and `fadeAt(events, T) → { level, color }`.
  - The level is linear from the value in effect when each fade starts. `durationMs: 0` is a cut.
  - The colour switches at the start of a fade.
  - It uses the same reach rule as `nightEvents`.
- **Painting.**
  - `useDeckStage` paints one `.deck__fade` overlay as the last child of the stage wrapper, above text and outside the camera world, in `apply(T)`. It writes only when the value changes, and paints nothing at level 0.
  - `/render` inherits this. The final frame of a deck faded to 1 is pure `color`.
- **Editor preview.** DeckCanvas paints the overlay at `min(level, 0.5)`, so the beat stays visible while editing.

## 5. Editor, lint, MCP

- **Text fields.**
  - The Effect select gains `draw`.
  - A **Particles** checkbox reveals Color (a select of note tints), Rate (number, 1–30) and Rise (range 0.5–2).
- **Credits action.**
  - An **Entries** textarea, one credit per line:
    - `Role: Name, Name` becomes `{ role, names }`;
    - a line with no colon is `{ names: [line] }`;
    - blank lines are ignored.
  - The parse runs live, and a pure round-trip helper `formatCredits`/`parseCredits` is tested.
  - Also: area x/y/w/h, Duration ms, and Particles (the same sub-fields as text).
- **Screen fade.** Level (range 0–1), Color (text), Duration ms.
- **Validation.**
  - `credits.items` must be non-empty and `durationMs > 0`.
  - The area must lie within 0–1 with positive size.
  - `screen_fade.to` must be within 0–1.
  - `particles.rate` must be within 1–30.
- **Lint warnings.**
  - `credits-fast`: the roll speed `(blockH + areaH)/duration` is above about 90 px/s at 1080p. Lint estimates `blockH` from line counts × line height, so it needs no DOM.
  - `fade-unfinished`: a `screen_fade` is still running at the deck's total.
  - `draw-long`: a `"draw"` line's `introDuration` is above 8 s.
- **MCP.** The tool docs describe `draw`, `particles`, `credits` and `screen_fade`. There are no new tools.

## 6. Out of scope

- Per-glyph colour.
- Kinetic typography beyond `"draw"`.
- Credits cards.
- Particles shaped like anything other than notes.
- Audio-reactive particles.
- Fades with eases other than linear.
- Fading individual layers.

## 7. Testing

- **Unit tests.**
  - `"draw"` `introDuration`, and the timeline's stroke/fill state at chosen times.
  - `textSpritesAt`:
    - seeded positions inside the rects, and birth-time positions under `scroll`;
    - seeds and keys disjoint from emitter sources;
    - births clipped to `[start, end)`;
    - caps respected;
    - deterministic;
    - existing note tests unchanged.
  - `creditsOffset` endpoints and linearity; credit-line visibility windows; the parse/format round-trip.
  - `fadeEvents` and `fadeAt`: hold, interrupt, cut, colour switch, reach rule.
  - The `hasNoteSources` gate.
  - Validation and lint rules.
- **e2e tests.**
  - **Probe** (Task 1): glyph-independent dashing and its determinism.
  - **Render-page determinism**, `retries: 0`. Stepping to a frame and jumping to it must give byte-equal screenshots for each of:
    - mid-draw;
    - mid-roll with particles;
    - mid-fade;
    - a backward jump;
    - the last frame, which must be pure black.
  - **`/play`:** after a scrub, the roll offset and the fade level match the clock.
  - **Camera:** during a camera move, `.notefield__text` has no transform and the word boxes do not move.
  - **Editor:** add Credits, type entries, and the canvas shows the roll; set a screen fade, and the preview is capped at 50%.

## 8. Risks

- **SVG glyph dashing behaviour.** Covered by the probe, with a mask-sweep fallback.
- **Raster history on note sprites.** Covered by extending the full-raster gate. The render cost is about +35 ms per frame.
- **Word-box measurement depends on fonts.** It is measured after `document.fonts.ready`, and `/render` awaits the pending-sources promise before capturing. Boxes are re-measured on a deck or line change, never per frame.
- **Long credit lists.** One transformed block plus the mask keeps paint cost flat.
