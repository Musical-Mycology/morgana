# MP4 Render — Design Spec (Timed Video, sub-project 3 of 6)

**Status:** designed, not yet implemented
**Date:** 2026-10-24
**Builds on:** [Deck clock + timed Player](2026-10-22-deck-clock-timed-player-design.md) (#36),
[Soundtrack + deck media store](2026-10-23-soundtrack-design.md) (#37)
**Driving use case:** Morgana renders the final Alt-Ctrl 2027 festival submission video.

---

## 0. Context

### 0.1 Decisions taken during brainstorming

- **CLI on the author's machine** — `npm run render`, not an in-editor export button (no
  Chromium/ffmpeg in the container image, no job queue). The renderer is a module the CLI calls,
  so a server-side button can wrap it later.
- **Default output: 1920×1080, 30 fps, H.264 (yuv420p, CRF 18) + AAC 192k in .mp4.** Flags
  override fps and size.
- **The renderer talks to a local Morgana** (`http://localhost:3000` by default) holding the deck
  and its media — it never handles credentials; the gated hosted instance is out of scope.
- **Approach A: art and nightlight become pure functions of deck time** (rather than simulated
  wall-clock time in the browser).
- **ffmpeg is the system's** (`PATH` or `FFMPEG_PATH`), with an install hint if missing — no
  ~70 MB npm binary.

### 0.2 Findings verified against the code

1. Everything the Player paints is already a function of `T` **except**:
   - `ArtStage` crossfades: fire-and-forget GSAP tweens in `render()`
     (`engine/components/ArtStage.tsx`), started when `CinematicSlide` calls `runtime.art` /
     `runtime.applyArt`.
   - Nightlight: the authoring runtime's `setNightlight` jumps the value; a 200 ms CSS
     `transition: opacity` on `.artstage__glow` smooths it on the wall clock.
   - The fin end-card's CSS `@keyframes cin-ending-in` animation.
   `Atmosphere` (tsParticles) and `Slide.tsx` are not mounted by the Player.
2. `art` and `nightlight` actions are **zero-length on the beat timeline** (`actionDuration`
   default 0): their visual transition runs *after* the action's start for
   `durationMs ?? DUR[mode]` (art) / the authored `durationMs` (nightlight), without reserving
   time.
3. Sub-project 1 added host-driven workarounds because art lived on a sibling component's live
   state: `CinematicSlide` re-issues the resolved entry stack on every beat change and restores
   the entry art + `resolveEntryNight()` on a backward seek. These exist only because art was not
   a function of time.
4. GitHub Actions' e2e job is `ubuntu-latest` with `npx playwright install --with-deps chromium`;
   ffmpeg is not installed there today. This dev machine has no ffmpeg either.

---

## 1. Approach

**(chosen) Art and nightlight are pure functions of deck time.** New pure functions compute the
exact art layer state and nightlight for any deck time `T`; `ArtStage` gains a stateless
`renderState`; the Player (host-driven) paints art from them every frame and `CinematicSlide`
stops issuing art/nightlight in host-driven mode. Preview scrubbing becomes correct mid-crossfade,
every frame is identical however it is reached (sequential, jumped, re-rendered), and the
sub-project-1 workarounds are deleted.

Rejected: Playwright's fake clock stepping wall-clock tweens one frame per screenshot (render-only,
preview stays wrong, frames depend on render order, CSS transitions uncontrollable); real-time
screen capture (drops frames).

---

## 2. Deterministic visuals

### 2.1 `engine/authoring/art-clock.ts` (pure; joins the enforced no-DOM set)

```ts
export interface ArtLayerState {
  asset: StoryAsset;
  opacity: number;   // 0–1
  scale: number;     // 1 at rest; overlays enter from 0.9, morph enters from 1.04
  z: number;         // stacking order, 1 = bottom
  overlay: boolean;  // screen-blended overlay asset
}
export const ART_DURATION_MS: Record<ArtMode, number>; // moved from ArtStage: cut 0, fade 700, crossfade 900, morph 800, dissolve 1100
export const NIGHT_ENTRY_MS = 200;                     // beat-level nightlight change (today's CSS transition)
export function artEvents(doc: DeckDoc): ArtEvent[];      // deck-time-ordered; compute once per doc
export function artAt(events: ArtEvent[], T: number): ArtLayerState[];
export function nightEvents(doc: DeckDoc): NightTimeline;  // { initial: number; events: NightEvent[] }
export function nightAt(timeline: NightTimeline, T: number): number;
```

**Events.** Walking `deckLayout(doc)` and `flattenStory(doc.scenes)` in deck order, an art event
is emitted for (a) each beat's entry `beat.art` at the beat's deck start, and (b) each mid-beat
`art` action at `scene.start + beat.start + window.start`. Events that are never reached — a beat
or action at/after a pinned scene's cut boundary — are dropped. Each event carries the stack it
transitions **to** (`applyArt(stackBefore, art)`, so `keep`/`out` fold against the true prior
stack), its `mode`, and duration `art.durationMs ?? ART_DURATION_MS[mode]`.

**State at T.** Fold events with `start ≤ T`. Layers in the target stack that were not in the
previous stack fade in: opacity `ease(p)`, where `p = clamp((T − start) / duration)` and
duration 0 (or `cut`) means `p = 1`; plain layers use `power2.inOut` (GSAP naming — **cubic**:
`p < .5 ? 4p³ : 1 − (−2p+2)³/2`), overlays use `back.out(2)` for scale `0.9 → 1` and opacity, and
`morph` plain layers enter from scale 1.04. Layers leaving fade out from **their opacity at the
event's start** (recursively, so a transition starting mid-crossfade continues smoothly) to 0
with `power2.inOut`, and are dropped once `p = 1`. Kept layers are at opacity 1. z follows the
target stack order; outgoing layers keep their previous z beneath. Ease implementations are
unit-tested against `gsap.parseEase(...)` at many points.

**Nightlight.** Start value = the first beat's flattened nightlight. Each beat entry whose
flattened nightlight differs from the current value transitions linearly over `NIGHT_ENTRY_MS`;
each `nightlight` action transitions linearly over `durationMs ?? NIGHT_ENTRY_MS` from the value at
its start. Same reach/cut rules as art.

### 2.2 `ArtStage.renderState(layers, night)`

A new imperative method that reconciles `<img class="artstage__layer">` elements to exactly the
given states (reuse by asset; create/remove; set `opacity`, `transform: scale()`, `zIndex`,
overlay blend) and sets the nightlight filter and glow opacity inline — **no GSAP, no CSS
transition** (it sets `transition: none` on the glow while state-driven). `show` / `apply` /
`snap` remain unchanged for autoplay and the editor canvas (`seek.ts`).

### 2.3 Host-driven wiring

- The **Player owns one `ArtStage`** (outside `BeatStage`, persistent across beats) and in its
  `apply(T)` calls `renderState(artAt(art, T), nightAt(night, T))` — `apply` stays the only writer
  of `T`.
- `BeatStage` gains `art={false}` to skip mounting its own `ArtStage` (default true).
- In host-driven mode (`autoplay={false}`) `CinematicSlide` **never** calls `runtime.art`,
  `runtime.applyArt` or `runtime.setNightlight`. The sub-project-1 workarounds are deleted:
  the always-reissue-entry-art branch, the backward-seek entry-baseline restore, and
  `resolveEntryNight` (plus `BeatStage`'s `entryNight` plumbing that only fed them).
- `/dev/seekbench` (the other host-driven caller) is unaffected (it has no art).

### 2.4 The fin end-card animation

`CinematicSlide`'s `cin-ending-in` keyframes are disabled when the page carries
`data-render="1"` on `<html>` (set by the render page). Interactive end-cards are not part of a
rendered video.

---

## 3. The render page — `/render?deck=<id>`

`app/render/page.tsx` + `components/player/RenderStage.tsx`:

- The Player's stage (same `Stage`/`BeatStage`/`ArtStage` composition as `TimedPlayer`) at
  **exactly the viewport size** (the CLI sets 1920×1080), no HUD, no letterbox, no soundtrack
  playback, `<html data-render="1">`.
- Exposes `window.__morganaRender`:
  ```ts
  { ready: true; total: number; renderFrame(T: number): Promise<void> }
  ```
  `renderFrame` applies `T` (beat swap + seek + art/night state), then waits until **every
  `<img>` in the stage is decoded** (`img.decode()`, errors tolerated and reported once),
  `document.fonts.ready`, and two `requestAnimationFrame`s, then resolves. The CLI screenshots
  only after it resolves.
- Load errors set `window.__morganaRender = { ready: false, error }` so the CLI can fail fast.

To avoid duplicating the Player, the shared stage composition and the `apply(T)` body are
extracted from `TimedPlayer` into a reusable hook/component used by both.

---

## 4. The CLI — `npm run render`

`scripts/render.ts` (run with `tsx`) + a testable module `lib/render/` (pure argument parsing,
frame math, ffmpeg argument building).

```
npm run render -- --deck <id> --out <file.mp4>
                  [--base-url http://localhost:3000] [--fps 30]
                  [--width 1920 --height 1080] [--from 0] [--to <seconds>]
```

1. Verify ffmpeg (`FFMPEG_PATH` or `ffmpeg` on `PATH`, `-version`); if absent, exit 2 with:
   "ffmpeg not found — install it (macOS: `brew install ffmpeg`, Debian/Ubuntu/WSL:
   `sudo apt install ffmpeg`) or set FFMPEG_PATH."
2. Fetch the deck (`GET <base-url>/api/decks/<id>`); exit 2 on 404 with a clear message. If it has
   a soundtrack, download it from `<base-url>` + `mediaPath(...)` to a temp file (base-url carries
   any sub-path; no `withBasePath` in the CLI).
3. Launch Playwright Chromium (headless, viewport W×H, `deviceScaleFactor: 1`), open
   `<base-url>/render?deck=<id>`, wait for `__morganaRender.ready` (or its error → exit 1).
4. Frames: `N = ceil((to − from) · fps)`; for `i = 0…N−1`, `T = from + i / fps`;
   `await renderFrame(T)`; `page.screenshot({ type: "png" })` → ffmpeg stdin.
5. ffmpeg: `-f image2pipe -framerate <fps> -i - [-ss <from> -i <audio>] -map 0:v [-map 1:a]
   -c:v libx264 -pix_fmt yuv420p -crf 18 -preset medium [-c:a aac -b:a 192k -af apad]
   -t <to − from> -movflags +faststart -y <out>`. Audio is offset by `--from` so a partial render
   stays in sync.
6. Progress to stderr every ~1 s: `frame i/N · x.x fps · ETA m:ss`. Ctrl-C closes Chromium and
   ffmpeg and removes the partial output. Any frame error aborts with the frame number and `T`.
7. Exit 0 prints the output path, duration and size.

---

## 5. Correctness, failure handling, testing

- **Determinism check (the core guarantee):** an e2e renders frames of a fixture deck with a
  crossfade, a nightlight change and a mid-beat art action, and asserts the PNG at a given `T` is
  **byte-identical** whether reached sequentially (stepping from 0) or by jumping straight to it.
- **Pure unit tests:** art events (entry + mid-beat, reach/cut rules, `keep`/`out` folding against
  the true prior stack), `artAt` (fade-in/out, overlay scale, morph, cut, a transition starting
  mid-crossfade, outgoing layers dropped at `p = 1`), easing parity with `gsap.parseEase`,
  `nightAt` (entry, actions, interpolation from mid-transition); `art-clock.ts` added to
  `pure-import-graph.test.ts`.
- **`ArtStage.renderState`** unit tests (reconcile, reuse, z-order, glow without transition).
- **Player:** existing timed-player tests keep passing; a new test that scrubbing into the middle
  of a crossfade shows both layers at the expected opacities; deleted workaround tests replaced by
  art-clock coverage.
- **CLI unit tests:** argument parsing/validation, frame count/timestamps (incl. `--from/--to`),
  ffmpeg argument building with/without audio, the ffmpeg-missing message.
- **CLI e2e:** render a 2 s fixture deck at 320×180, 10 fps with a short WAV soundtrack, then
  `ffprobe` the output: one H.264 video stream at 10 fps, one AAC audio stream, duration ≈ 2 s.
  Skips with a clear message when ffmpeg is unavailable; the CI e2e job installs it
  (`sudo apt-get install -y ffmpeg`).
- **Failure paths:** unknown deck → exit 2; render page error → exit 1 with the message; an image
  that fails to decode → warning once, render continues (the frame shows what the browser shows).

## 6. Out of scope

An in-editor Export button / server-side rendering; rendering from the gated hosted instance;
GPU encoders; transparent/alpha output; per-frame parallelism (made possible by determinism, not
built); video clips (sub-project 4); camera moves (5); credits/text particles (6); unifying the
editor canvas (`seek.ts`) onto `artAt` (§7c).

## 7. Risks

- **Screenshot throughput.** ~3,600 PNG screenshots at 1080p; expected tens of ms each → a few
  minutes. If too slow, switch the screenshot type to JPEG (q≈95) or use CDP screencast frames.
- **Fonts/SplitText layout.** Text effects measure glyphs; the first frame must wait for
  `document.fonts.ready` (built into `renderFrame`).
- **Visual parity of the new art path.** The pure ease curves must match GSAP's — pinned by the
  parity test; a visual check of the storyboard's transitions in `/play` before the final render.
