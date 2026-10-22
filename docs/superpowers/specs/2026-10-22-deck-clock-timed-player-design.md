# Deck Clock + Timed Player — Design Spec (Timed Video, sub-project 1 of 6)

**Status:** designed, not yet implemented
**Date:** 2026-10-22
**Builds on:** [§7b — seekable transport surface](2026-07-28-transport-surface-7b-design.md)
**Driving use case:** the Alt-Ctrl Festival 2027 storyboard — a 2:00 video rendered by Morgana

---

## 0. Context

### 0.1 The driving storyboard

A four-section, music-synced, 2-minute submission video:

| Section | Window | Visual / text | Audio | Transition out |
| --- | --- | --- | --- | --- |
| Opening | 0–15s | Musical Mycology landing art; "Connecting People to Music", "Presents — The Terrarium" fade in | 1–2s silence → *Deux Arabesques* | Expand container, zoom into space behind mosaic |
| Background | 16–40s | Collage of dev photos/video + concept screens; 5 text lines | Arabesques → drop-beat Debussy | Zoom into concept-art installation on the beat drop |
| Gameplay | 40–90s | Footage of people playing; 5 text lines | Drop-beat Debussy | Expand container, zoom behind mosaic |
| Credits | 90–120s | Credits with particle lines coming off the words | Drop-beat → back to Arabesques | Fade to black |

**Morgana's output is the submission** — it must render the final MP4, not just pre-visualize it.

### 0.2 The six-part roadmap (each its own spec → plan → implementation)

| # | Sub-project | Delivers | Status |
| --- | --- | --- | --- |
| **1** | **Deck clock + timed player** | **This spec** | designed |
| 2 | Soundtrack | Deck-level audio clips (start, trim, fade, volume) synced to the deck clock; overlapping clips crossfade | open |
| 3 | MP4 render | Headless Chromium frame-stepped `seek(t)` → screenshots → ffmpeg + soundtrack mux; makes the remaining wall-clock effects (ArtStage crossfades, tsParticles atmosphere, `Slide.tsx` entry tweens) deterministic | open |
| 4 | Video clips | A video media/object kind whose `currentTime` is a function of the deck clock | open |
| 5 | Camera moves | Stage-wide time-pure pan/zoom (`camera_move`) | open |
| 6 | Credits + text particles | Scrolling credits block; particles emitted from text | open |

Order rationale: everything hangs off the deck clock (1); the storyboard is cut to music, so
section lengths aren't final without audio (2); export lands third so the pipeline is proven on a
rough cut before visual polish, and each later feature is verified through a real export.

### 0.3 Decisions taken during brainstorming

- **Pauses are an authoring/preview concept only.** Pausing stops the count-up clock and the
  scrubber; the exported video always runs straight through.
- **Timing model: pinned scene lengths.** Each scene may pin a length; beats inside play
  sequentially as today. Scene boundaries never move, so music cue points stay put.
- **Scrubber lives in both places:** a fullscreen timed Player (full-fidelity, and what export will
  render) *and* a deck-time ruler in the editor.
- **Export (sub-project 3) will be a frame-stepped headless render**, which is why this spec makes
  playback seek-driven: preview and export become the same loop.

### 0.4 Findings verified against the code

1. **No deck-wide time axis exists.** `engine/authoring/beat-clock.ts` lays out one beat;
   every beat restarts at 0. Nothing plays a deck end-to-end — Morgana is editor-only.
2. **The editor canvas is not the cinematic renderer.** `DeckCanvas` paints via `seek.ts`'s
   `renderBeatAt`. The full-fidelity seekable renderer is `CinematicSlide` (wrapped by
   `BeatStage`), exposing `SlideTransport { seek, play, pause, duration }`.
3. **`CinematicSlide` autoplays on mount** (`play()` at the end of its layout effect).
   `seek(t)` already pauses the autoplay ticker internally.
4. **`BeatStage` starts lighting at `beat.nightlight ?? 0`** — it does not know inherited
   nightlight. `flattenStory` (`engine/deck/flatten.ts`) does, and `resolveEntryArt` /
   `resolveBeatArt` resolve each beat's art stack.
5. **MCP `update_meta` already sets arbitrary meta dot-paths**, so `timing.targetSec` needs no
   new tool. There is no scene-level field tool.

---

## 1. Approach

**(chosen) Seek-slaved beats.** One deck-level clock owns deck time `T`. A pure function maps
`T → (beat, localT)`. The Player keeps a single `BeatStage` mounted, swaps its `beat` prop, and
calls `transport.seek(localT)` every frame; beats never autoplay.

- Preview ≡ export: sub-project 3 runs the same loop one frame at a time.
- `click_gate` is skipped for free — gates only halt a beat's own autoplay ticker.
- Still exactly one clock (the §7b principle).

Rejected: **one concatenated `CinematicSlide` timeline** (breaks per-beat entry art/nightlight
semantics; rewrites a 1,000-line component) and **per-beat autoplay with completion handoff**
(two clocks that drift — the liability §7 removed).

**Gate (plan Task 1):** benchmark per-frame forward `seek()` on a busy beat before building on
it. `renderAt` already runs once per tick under autoplay, so cost should be equivalent; if it is
not, stop and revisit.

---

## 2. Data model

Additive optional fields — **no `version` bump, no migration** (per
[deck-format-version-policy](deck-format-version-policy.md)):

```ts
// engine/deck-doc.ts
interface DeckMeta {
  // …existing
  /** Present = a timed deck (video). targetSec is the intended total length, e.g. 120. */
  timing?: { targetSec: number };
}

// engine/deck/types.ts
interface Scene {
  // …existing
  /** Pinned scene length in seconds. Omit = length follows content. */
  durationSec?: number;
}
```

- `validateDeckDoc`: `meta.timing.targetSec` and `scenes[i].durationSec` must be finite and > 0
  (messages carry the `scenes[i]` prefix so lint can jump to them).
- `durationSec` is honored by the deck clock whether or not the deck is timed; `timing` adds
  the target, the `timed-interactive` lint, and the editor ruler.

---

## 3. The deck clock — `engine/authoring/deck-clock.ts`

Pure (no DOM, GSAP, or React); imports only `beat-clock.ts` and types. Added to
`tests/unit/pure-import-graph.test.ts`.

```ts
export interface BeatSpan { beatIdx: number; flatIdx: number; start: number; duration: number } // start is scene-local
export interface SceneSpan {
  sceneIdx: number;
  start: number;          // deck time
  length: number;         // durationSec ?? contentLength
  contentLength: number;  // Σ beatDuration(beat.timeline)
  pinned: boolean;
  beats: BeatSpan[];
}
export interface DeckLayout { scenes: SceneSpan[]; total: number }

export type LocatePhase = "play" | "hold" | "empty";
export interface Located {
  sceneIdx: number;
  beatIdx: number | null;  // null only for "empty"
  flatIdx: number | null;
  localT: number;          // beat-local seconds to seek to
  phase: LocatePhase;
}

export function deckLayout(doc: DeckDoc): DeckLayout;
export function locate(layout: DeckLayout, T: number): Located | null; // null iff total === 0
export function deckTimeOf(layout: DeckLayout, flatIdx: number, localT: number): number; // inverse, for the editor playhead
```

Semantics:

- Scenes are half-open `[start, start + length)`. `T` is clamped to `[0, total]`; `T === total`
  resolves to the final scene's end state.
- **play** — `T` falls inside a beat's content: that beat, `localT = T − scene.start − beat.start`.
- **hold** — content ended before the pinned end: last beat, `localT = its duration` (settled).
- **empty** — a zero-beat scene with a pinned length (legal; see the deep-dive's empty-scene
  gotcha). The stage renders blank for that window.
- **Overrun** — content longer than the pinned length is cut at the boundary: a beat in flight is
  clamped to `localT = scene.length − beat.start`; beats starting at or after the boundary are
  never reached. Later scenes do not move.
- **Zero-length beats** occupy no time and are never the located beat; their art/nightlight
  effects still apply because the next beat's entry state comes from `flattenStory`.
- **Zero-length scenes** (no beats, no `durationSec`) occupy no time and are skipped.

---

## 4. The timed Player — `/play?deck=<id>[&t=<seconds>]`

New route `app/play/page.tsx`, matching the editor's `?deck=` convention (default `demo`).

**Stage.** Fullscreen, letterboxed 16:9, one `BeatStage` that stays mounted while its `beat`,
`scene`, `beatIndex`, entry/end layers, and initial nightlight props change — so `ArtStage` and
lighting persist across beat changes and art crossfades from the previous panel exactly as in the
real deck (remounting per beat would flash art in from blank). Per-beat entry layers and
nightlight come from `flattenStory` + `resolveEntryArt` / `resolveBeatArt`, so a beat reached by
scrubbing looks the same as one reached by playing through.

Required engine changes (small, additive):
- `CinematicSlide` / `BeatStage`: `autoplay?: boolean` (default `true`). When `false`, the
  mount effect skips `play()`; entry art is still issued.
- `BeatStage`: `entryNight?: number` — the beat's inherited entry nightlight (from `flattenStory`). Applied on mount AND on every beat change, because `CinematicSlide` only issues nightlight for `nightlight` *actions*, never the beat-level inherited value.

**Clock.** A single `requestAnimationFrame` loop advances `T` by real elapsed time while playing,
then `locate(T)` → set beat props if changed → `transport.seek(localT)`. On `hold` it seeks the
last beat's full duration; on `empty` it renders a blank stage. Reaching `total` stops on the
last frame. A hidden tab (`visibilitychange`) pauses playback rather than jumping ahead on return.

**HUD** (visible while paused; auto-hides 2s after the last pointer move while playing; `H`
toggles):
- Count-up clock `0:47.3 / 2:00` — turns amber once `T` passes `targetSec`. Untimed decks show
  `elapsed / total`.
- Current scene id.
- Whole-deck scrubber: scene segments to scale and labeled by scene id, target marker, held
  tails shaded, overrun shown as a red hatch, `data-testid="play-scrub"`.

**Keys.** Space play/pause · ←/→ ±1s · Shift+←/→ ±5s · Home → 0 · F fullscreen · H HUD.

**Errors/empty.** Load failure shows a plain "Couldn't load deck" message (`data-testid="play-error"`); `total === 0` shows
"Nothing to play — add beats or pin a scene length."

---

## 5. Editor changes

- **Deck Settings:** "Timed deck" toggle plus a target length input in `m:ss` (writes / removes
  `meta.timing`).
- **Filmstrip scene header:** a "Length" field per scene, shown as `15s · content 12.4s`; empty =
  follow content; overrun highlighted.
- **Deck-time ruler** (`components/editor/DeckRuler.tsx`), above the per-beat Timeline, shown only
  for timed decks (untimed decks show a one-line hint pointing at Deck Settings):
  - scene segments to scale with hold/overrun shading and the target line;
  - playhead = `deckTimeOf(selectedFlatIdx, beatT)`, following the per-beat scrubber;
  - elapsed readout;
  - **click/drag** → `locate(T)` → select that beat (`flatIdx`) → `canvasRef.seek(localT)`. An
    `empty` location selects nothing and parks the playhead;
  - **▶ Play from here** → opens `/play?deck=<id>&t=<T>`.
- **Top bar:** "Play deck" button → `/play?deck=<id>`. Both links go through `withBasePath()`.
- **Out of scope:** continuous whole-deck playback inside the editor. The editor canvas uses the
  `seek.ts` renderer; unifying it is §7c, not this work.

---

## 6. Lint

Added to `lib/editor/lint.ts`, locating to the scene (or action) as existing rules do:

| Rule | Severity | Fires when |
| --- | --- | --- |
| `scene-overrun` | warning | `contentLength > durationSec` — "Background runs 3.2s over its 24s". A warning, not an error: in `lintDeck` an error means "the server will reject this save", and an overrun is a timing problem, not an invalid deck |
| `deck-length-mismatch` | warning | timed deck and `total ≠ targetSec` — "Deck is 1:56 of 2:00 — 4s short" |
| `timed-interactive` | warning | timed deck contains `click_gate`, `reveal_arrows`, `pulse_arrow`, `reveal_again`, or a `jump:` inline link — "ignored in timed playback" |

---

## 7. MCP

- **`set_scene_duration(deck_id, scene_index, seconds | null)`** — pin or un-pin a scene's
  length. `null` removes `durationSec`.
- **`read_deck_timing(deck_id)`** — read-only; returns `deckLayout` plus target, total, and
  overrun list, so a connected Claude client can time a deck without deriving durations.
- Target length uses existing `update_meta` with path `timing.targetSec`; its description gains
  that example. Per the deep-dive, tool descriptions are the only contract a remote model reads,
  so both new tools' descriptions state the pinned/hold/overrun semantics.

---

## 8. Testing

- **Unit — `deck-clock`:** scene starts; play/hold/empty phases; overrun cut-off; boundary
  half-openness; zero-length beats and scenes; clamping at 0 and `total`; `deckTimeOf` ∘
  `locate` round-trip.
- **Unit — other:** `validateDeckDoc` for both new fields; the three lint rules; both MCP tools
  (handlers + tool-defs sweep); `pure-import-graph` includes `deck-clock`; `CinematicSlide`
  `autoplay={false}` does not start the ticker.
- **e2e** (seek-driven, not wall-clock, per the determinism suite's conventions): `/play` renders
  the clock; Space pauses and the clock text is unchanged after 500ms; seeking to 0:20 on a
  fixture deck lands in scene 2; clicking the editor ruler selects the expected beat; `?t=`
  deep-link starts at that time.
- **Plan Task 1:** the per-frame seek benchmark gate (§1).

---

## 9. Out of scope (owned by later sub-projects)

Audio (2) · MP4 export and determinism of ArtStage crossfades / tsParticles atmosphere /
`Slide.tsx` entry tweens (3) · video (4) · camera (5) · credits and text particles (6) · fixed
output resolution and frame rate (3) · whole-deck playback in the editor canvas (§7c).

## 10. Risks

- **Static mode at mount.** `CinematicSlide` takes its static/print path under reduced motion or
  a backgrounded tab, rendering only the settled end state. The Player must keep seek-driven
  rendering in effect regardless; verify in the plan which condition is read at mount and pass
  through accordingly.
- **Wall-clock art crossfades in preview.** Beat-entry art transitions still run on GSAP
  wall-clock in this sub-project; scrubbing across a beat boundary may show a crossfade in
  progress. Acceptable for preview; sub-project 3 owns making it deterministic.
- **Deferred `keep`/`out` double-issue** (deep-dive): unchanged by this work, but the Player
  issues entry art on every beat swap — the first `keep`/`out`-bearing art action authored for the
  storyboard must fix that issue first.
