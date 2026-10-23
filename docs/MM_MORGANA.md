# morgana — Cinematic deck editor (standalone OSS)

Self-hostable web editor for cinematic, data-driven slide decks. Decks are
authored as `Scene → Beat → Action` JSON and played by a vendored GSAP +
tsParticles render engine; the editor puts a filmstrip, a WYSIWYG canvas, a
schema-driven inspector, and a scrubbable per-beat timeline on top of that same
data model. Runs as a single Node container with filesystem storage — no
database, no infrastructure-specific coupling.

See `MM_ARCHITECTURE.md` (MM-internal) → *Other repos* for the one-line role and the
render-engine lineage (vendored *from* mm-website's investor-hub deck; the
eventual export round-trip goes back the other way).

## Stack

Next.js 15 + React 19 + TypeScript. Vendored render engine under `engine/`
(GSAP + tsParticles). Zustand editor store. Vitest (unit) + Playwright (e2e).
Packaged as a single Node container (`Dockerfile` + `docker-compose.yml`);
decks are portable JSON on a mounted volume (`MORGANA_DATA_DIR`, default
`/data`).

**Sub-path deployment (`MORGANA_BASE_PATH`).** Morgana can serve from a path of
a larger site (`https://example.com/morgana/`) rather than a domain root. Three
things about it are load-bearing:

- **It is a BUILD arg, never a runtime env var.** Next bakes `basePath` during
  `next build`, so the value must be passed as `--build-arg`; setting it on a
  running container does nothing. `next.config.mjs` re-exports it as
  `NEXT_PUBLIC_BASE_PATH` so client code reads one source of truth.
- **Every hand-built URL must go through `withBasePath()`**
  ([`lib/base-path.ts`](../lib/base-path.ts)). Next rewrites `<Link>`,
  `<Image>`, and `/_next/*` for you; it does **not** touch raw `fetch()`,
  strings built with `window.location.origin`, or asset URLs the engine
  composes itself. `tests/unit/base-path-callsites.test.ts` guards the patterns
  it can see — read its comments for what it deliberately does not cover.
  Engine art and glyph URLs are wrapped at
  [`engine/asset-resolver.ts`](../engine/asset-resolver.ts), *not* in
  `engine/deck/story-assets.ts`: the pure note-state core value-imports that
  module, and a deck-format core should not depend on build-time env config.
  `asset-resolver.ts` is currently the only runtime importer of
  `storyAssetUrl` — a new DOM consumer that imports it directly would bypass
  the prefix and silently 404 under a sub-path.
- **`ENV HOSTNAME=0.0.0.0` in the runner stage is required, and has a
  side-effect.** Next's standalone `server.js` reads `process.env.HOSTNAME`,
  which Docker sets to the container id, so without it the server binds only to
  the container's eth0 address — published ports still work (they DNAT to it),
  which is exactly why the smoke test cannot catch it, but loopback inside the
  container is dead. The side-effect: log shippers that label containers from
  `$HOSTNAME` now see `0.0.0.0`. **Probing from inside the container must use
  `127.0.0.1`, not `localhost`** — the image is Alpine and musl resolves
  `localhost` to `::1`, where nothing listens, so `localhost` fails on a
  perfectly healthy container.

## Where

MM runs one private internal instance (Mycelium, container, gated) for
authoring MM deck content; it uses the repo's own `MORGANA_BASE_PATH`
sub-path support and no Morgana-side MM coupling. Deployment detail lives in
MM-internal docs, not here. The deployment target is otherwise deliberately
open — the product thesis is
"single self-hostable container on your own machine," so self-hosting is the
baseline and no hosted instance is ever required to use it.

## Design docs live in-repo (public-repo convention)

**Morgana's design docs, specs, and plans live in the Morgana repo itself**
(`docs/` — including `docs/superpowers/specs/` and `docs/superpowers/plans/`),
**not** in mm-documents. This is deliberate and follows the general MM
convention for **public** repos:

> A public repo keeps its own design documentation local to the repo, because
> outside contributors and downstream users may need those docs and have no
> access to mm-documents (which is private). The docs must travel with the
> code.

So for Morgana, mm-documents carries only this cross-cutting deep-dive (role,
lineage, positioning, cross-repo contracts) — the canonical MM per-service
summary. Anything a contributor needs to *build or extend* Morgana — the v1
design spec, the end-state ("north star") design, and every per-feature
brainstorm → spec → plan — is versioned inside the Morgana repo under `docs/`.
Notable in-repo docs:

- `docs/2026-06-23-morgana-design.md` — the v1 design spec (goals/non-goals,
  the effect-descriptor registry, the scrub compromise).
- `docs/2026-06-29-morgana-end-state-design.md` — the end-state ("north star")
  design; the tier roadmap (1.5 Hardening / 2 Depth / 3 Platform) lives here.
  **Tier 1.5 (Hardening) is complete as of 2026-07-27** — scene structural
  editing (reorder/delete/cross-scene beat move), the lint/Issues panel, and
  empty/error states (see `docs/superpowers/plans/2026-07-24-tier-1-5-hardening-sweep.md`).
  Tier 2 (Depth) is next.
- `docs/superpowers/specs/` + `docs/superpowers/plans/` — per-feature design
  specs and implementation plans.
- **Tier 2 §7 is decomposed** into §7a (time-pure note particles — spec
  `docs/superpowers/specs/2026-07-27-time-pure-particles-7a-design.md`), §7b (the seekable
  transport surface — spec/plan `docs/superpowers/plans/2026-07-28-transport-surface-7b.md`)
  and §7c (canvas swap + parity gate + `seek.ts` deletion). §7a and §7b are both landed.
- **Timed video is a six-part roadmap** driven by a Morgana-rendered festival submission video
  (spec `docs/superpowers/specs/2026-10-22-deck-clock-timed-player-design.md` §0.2): (1) deck
  clock + timed Player — **landed**; (2) soundtrack + deck media store — **landed** (spec
  `docs/superpowers/specs/2026-10-23-soundtrack-design.md`); (3) frame-stepped MP4 render —
  **landed** (spec `docs/superpowers/specs/2026-10-24-mp4-render-design.md`); (4) video
  clips + image uploads — **landed** (spec `docs/superpowers/specs/2026-10-23-video-clips-design.md`);
  (5) camera moves; (6) credits + text particles. Each later sub-project gets its own
  spec → plan.
  **Gotcha, now RESOLVED (§7b, 2026-07-28) — `CinematicSlide`'s GSAP master used to be a
  callback scheduler with time spacers, not a seekable representation**: effects were
  scheduled via `master.add(fn)` (a `delayedCall`), so the timelines the effect builders
  returned were orphaned and ran on wall-clock, which is why durations were re-declared as
  `master.to({}, {duration})` spacers and why `seek.ts` (see below) carried its own second
  copy of `introDuration`. `master.seek(t)` did not work. §7b replaced this wholesale inside
  `CinematicSlide`: see "`CinematicSlide` is seekable" below.
- **The canonical beat time axis lives in `engine/authoring/beat-clock.ts`.** It is a pure
  module — no DOM, no GSAP, no React — extracted from `engine/authoring/seek.ts` in §7b, which
  now imports `beatTimeline` from it instead of carrying its own copy. `beat-clock.ts` owns
  `beatTimeline`/`beatDuration`/`actionDuration`/`introDuration`/`foldAt`/`rebuildBoundary`:
  everything that answers "when does X happen in this beat" or "what is reached by time t"
  reads from here, and nowhere else derives a duration by reading a built GSAP timeline
  (Global Constraint D2 of the §7b plan). Both pure reducers —
  `engine/components/effects/note-state.ts` and `lib/editor/object-state.ts` — import from it
  to fold notes and objects to the same `t` CinematicSlide renders. Note that `seek.ts` itself
  is a separate, simpler renderer (`renderBeatAt`) still used for non-interactive preview paint
  (`DeckCanvas`, `BeatThumbnail`, the `/spike` page) — §7b did not delete or seekify it; only
  `CinematicSlide`'s own live-playback path became seekable. Unifying or deleting `seek.ts` is
  §7c's `seek.ts`-deletion item, not done here.
- **Note particles are pure functions of time** (`engine/components/effects/note-state.ts`).
  `NoteField` holds no time state: both `DeckCanvas` and `BeatStage` mount it and supply a
  clock. `CinematicRuntime` no longer carries `cue`/`emitter`/`noteCircle`/`stopNotes`/
  `stopCircles` — the `cue` *action kind* survives in `types.ts` for deck-format
  compatibility but is inert. Do not re-add per-sprite GSAP tweens: a second note animation
  implementation is exactly the drift liability §7 exists to remove.
  **Purity is a one-way import rule, and — as of §7b — it is enforced.**
  `note-state.ts`, `lib/editor/object-state.ts`, `engine/authoring/deck-clock.ts`,
  `engine/authoring/art-clock.ts` and `lib/timing/clock-format.ts` must not import anything that touches the DOM (`beat-clock.ts`
  included, since they depend on it): the dependency runs *toward* these pure cores and never
  back. `tests/unit/pure-import-graph.test.ts` walks each module's
  runtime import graph (type-only imports are erased, so they don't count) and fails if any
  reachable file contains a DOM token (`document.`, `.innerHTML`, `createElement(`). §7a
  shipped one near-miss before this existed — `randomGlyph` briefly lived in `notes.ts` (which
  calls `document.createElement`) and was hoisted into `note-state.ts` on 2026-07-28 — and it
  cost nothing to catch by hand only because both sides deferred the import to call time. That
  test is what makes the next near-miss cost something instead of nothing.
- **`CinematicSlide` is seekable.** It exposes `SlideTransport { seek, play, pause, duration }`
  via an imperative `transport` ref. Internally, every action kind renders from a single
  `renderAt(t)` that folds the beat's timeline (`foldAt`, from `beat-clock.ts`) to its state at
  `t` — building each action's real effect timeline once, paused, and driving it with
  `.time()`/`.progress(1)`, never running it on wall-clock. The old per-segment GSAP
  timelines, `scheduleAction`, and `masterRef` are gone; one time axis with gate boundaries
  replaced them. `duration()` is always `beatDuration(beat.timeline)` — the pure reading,
  never a GSAP timeline's own `.duration()`. Autoplay drives `t` from a `gsap.ticker` callback
  that pauses at each `click_gate` and hands `resume` to `runtime.onGate`, exactly as the old
  segment machinery did. **`seek(t)` pauses the autoplay ticker internally** — a caller does
  not pause() first. The alternative (require callers to pause before seeking) was tried and
  rejected as a footgun: it is too easy to forget, and the failure mode is a ticker silently
  racing a scrub. In static/print mode (reduced motion, a backgrounded tab, or PDF), the whole
  beat renders as `renderAt(duration())` — the fully-settled fold — rather than a hand-written
  end-state replay loop; see the deferred-issue gotcha below for the one sharp edge this
  merges in. The backgrounded-tab trigger applies **only to autoplay**: a host-driven slide
  (`autoplay={false}`, below) never goes static because a tab was hidden at mount, since it
  doesn't depend on rAF.
- **Host-driven mode: `autoplay={false}` (timed video sub-project 1).** `CinematicSlide` /
  `BeatStage` accept `autoplay={false}`: no ticker is ever registered, the mount paints `t=0`,
  and the host owns time via `transport.seek`. This is how the timed Player drives a deck, and
  how `/render` does. **A host-driven `CinematicSlide` never issues art or nightlight** — not on
  mount, not in `renderAt`'s fold, not in static mode (all gated on `autoplay`). The host paints
  them as a pure function of deck time (next bullet). The sub-project-1 workarounds (always
  re-issue entry art, backward-seek entry baseline, `BeatStage`'s `entryNight` prop,
  `runtime.resolveEntryNight`) were deleted in sub-project 3 — don't bring them back.
- **Art + nightlight are pure functions of deck time** (`engine/authoring/art-clock.ts`, sub-project
  3). `artEvents(doc)`/`artAt(events, T)` give the art layer stack (asset, opacity, scale, z,
  overlay) at any `T`; `nightEvents`/`nightAt` the nightlight. Eases are closed-form GSAP ports
  (`power2.inOut`, `back.out(2)`) and durations come from `ART_DURATION_MS`, shared with
  `ArtStage`. `ArtStage.renderState(layers, night)` paints that state statelessly (reconciles
  layers by asset, kills stale tweens, `transition: none` on the glow). `useDeckStage`
  (`components/player/DeckStage.tsx`) owns the one host `ArtStage` (`BeatStage art={false}`) and
  its `apply(T)` — the only writer of `T` — paints art + night every call. Deliberate
  differences from autoplay, all ruled: a mid-beat `art` action crossfades over its authored
  duration (autoplay cuts); a kept layer still fading in continues its fade (autoplay pops to 1);
  an empty pinned scene shows the current art on brown (not black).
  **Gotcha:** the host must pass `ArtStage` a **constant** `nightlight` prop — React rewrites the
  prop-derived inline filter/glow whenever the prop changes, clobbering what `renderState`
  painted. **Known divergence (parked):** thumbnails/editor (`resolveEntryArt`) still fold art
  that falls past an overrun pinned scene's cut; `/play` and the render drop it. Lint flags
  overruns; §7c's editor move to `artAt` resolves it.
- **MP4 render: `npm run render -- --deck <id> --out <file.mp4>`** (`scripts/render.ts`,
  `lib/render/{args,ffmpeg,run}.ts`; README "Render to MP4"). Runs on the user's machine against a
  running Morgana (`--base-url`, carries any sub-path — no `withBasePath` in the CLI). Playwright
  Chromium opens `/render?deck=<id>` (`components/player/RenderStage.tsx`, chrome-free, sets
  `html[data-render="1"]`, which also hides the Next dev indicator and `.cin__ending` end-cards),
  calls `window.__morganaRender.renderFrame(T)` (`flushSync(apply)` → image decode → fonts → 2
  rAFs), screenshots PNG, pipes to system ffmpeg (`FFMPEG_PATH`; H.264 yuv420p CRF 18 + AAC 192k,
  soundtrack `-ss <from>` + `apad`). **Security gotcha:** the soundtrack input is opened with a
  pinned demuxer (`AUDIO_DEMUXERS`, `-f <demuxer> -protocol_whitelist file`) and only a valid
  media-store id is accepted — ffmpeg sniffs content otherwise, so an uploaded "audio" file that
  is really an HLS/concat playlist would read local files or URLs into the video. Any future
  media input to ffmpeg (sub-project 4 video clips) must follow the same rule. Fonts and every `NOTE_GLYPHS` mask are preloaded before
  `ready`; decode failures are reported once per src, render continues. Exit codes: 0 ok, 1
  render failure (incl. page `ready:false`, frame timeout `FRAME_TIMEOUT_MS` 60 s, any
  `pageerror` — fatal on purpose: there's no error boundary, so a crashed root would otherwise
  encode black frames with exit 0), 2 usage/setup, 130 Ctrl-C (detected via `signal.aborted`,
  since a terminal Ctrl-C also kills Chromium/ffmpeg). Cleanup kills ffmpeg (SIGKILL — a graceful
  ffmpeg would finalise the partial file) and unlinks `--out` only if a frame was written.
  Determinism is gated by `e2e/render-page.spec.ts` (stepped vs jumped frames byte-equal). Width
  and height must be even; use 16:9 (no letterbox on `/render`). Prefer `npm run build && npm
  start` for final renders.
- **Video clips + uploaded images (sub-project 4).** `media:<mediaId>` refs
  (`engine/deck/media-ref.ts`, pure; `MEDIA_ID_PATTERN` gates resolution) work as art panels
  (`art.to/keep/out`, `ArtAsset = StoryAsset | MediaRef`) and as media-tile `src`. Clip options
  `{in, loop}` are per use (`art.clips[ref]`, tile `clip`) and come from the transition that
  **brought the layer in** — the same rule in `artAt`, the editor's `seek.ts` clip fold, ArtStage
  autoplay and lint. Clip time is pure (`engine/deck/clip-clock.ts` `clipTimeAt(since, T, opts,
  duration)`; holds the last frame unless `loop`). Art `since` is **deck** time; tile `since` is
  **beat-local**, paired with an unclamped beat clock (`transport.seek(t, clipT)`) so tiles keep
  playing through a pinned scene's hold. All clips are muted.
  **`engine/components/video-sync.ts` is the one place video time is applied:** `"play"` mode
  (`/play`) plays natively, re-seeks only past `DRIFT_SEC` 0.1 s and leads seeks by the measured
  per-element latency (≤0.5 s) — without that, long-GOP footage (OBS default) re-seeks forever;
  `"seek"` mode (scrub, `/render`) seeks exactly and registers a pending record that
  `renderFrame` awaits via `pendingVideoSeeks()`. **Determinism gotchas, all load-bearing:**
  Chromium does not present frames for opacity-0 videos (rVFC never fires) and can screenshot a
  stale frame when a video goes 0 → visible+seeked, so video layers/tiles never paint below
  `MIN_VIDEO_OPACITY` (1/1024, invisible); a fresh element waits `loadeddata` + one presented
  frame before its first seek (else the preroll frame can win); a 250 ms present fallback and a
  10 s per-record watchdog guarantee a frame never hangs (failures are reported, render
  continues). `DeckStage` owns a `clipMode` ref (TimedPlayer flips play/seek; scrub sets seek
  first) — never state, so the memoised `Stage` never re-renders. The editor canvas
  (`clipPlayback={false}`) shows the in-point frame paused and does not draw tiles under scrub.
  Editor UI: Deck settings media library (upload/drag-drop, copy ref, delete with
  `findMediaRefs` reference check) and an asset picker (`Field` type `"asset"`) with In-point/Loop.
  Lint: `media-missing`, `media-kind`, `clip-in-past-end`. **Client-safety gotcha:** never
  runtime-import `@/lib/store/*` from client code (it pulls `node:fs` into the editor bundle and
  only `next build` notices) — `pure-import-graph.test.ts` now also flags node builtins for
  `lint.ts`/`media-refs.ts`; shared helpers (`mediaKind`, `MEDIA_ID_PATTERN`) live in
  `engine/deck/media-ref.ts`.
- **`BeatStage` drives text, notes, and objects from one clock.** `CinematicSlide`'s `onTime`
  fires with the exact beat-local `t` it just painted (from the ticker, from `seek()`, or from
  the static-mode settle), and `BeatStage` paints `ObjectStage` and `NoteField` from that same
  callback rather than polling or running a second ticker. The long-standing KNOWN LIMITATION
  here — objects and notes riding an independent wall-clock timeline that desynced from text at
  gates — is gone along with the code that caused it; there is exactly one clock now.
- **The deck-wide time axis lives in `engine/authoring/deck-clock.ts`** (pure, built on
  `beat-clock.ts`). Scenes lay end to end; a scene's length is its pinned `durationSec` if set,
  else its content length. `locate(layout, T)` returns `{sceneIdx, beatIdx, flatIdx, localT,
  phase}` or `null` iff the deck has nothing to play. Semantics that callers rely on:
  scenes are half-open; **`hold`** means the scene's content has finished and returns the
  scene's *last* beat (zero-length or not) settled — so a trailing art-only beat is visible
  while the scene holds; **overrun** content past a pinned boundary is cut and later scenes
  never move (so music cue points stay put); **`empty`** is a zero-beat pinned scene.
  `sceneOverrun()` owns the one float tolerance (1e-6 s) — lint, the TimeBar, the filmstrip and
  MCP all read overruns through it, so never compare `contentLength > length` directly.
  Format: `meta.timing.targetSec` (present = timed deck) and `Scene.durationSec` — both
  optional under `version: 1`; turning "Timed deck" off must *remove* `timing`, never write
  `null` (validation rejects `null`).
- **The timed Player is `/play?deck=<id>[&t=<seconds>]`** (`components/player/TimedPlayer.tsx`).
  ONE `BeatStage` stays mounted (memoised per beat) with `autoplay={false}`, owned by
  `useDeckStage` (shared with `/render`); a single rAF loop
  advances deck time `T`, `locate(T)` picks the beat, the `beat` prop swaps on boundaries, and
  the seek for a new beat happens in a `useLayoutEffect` so the first painted frame is already
  at `localT` (child layout effects — `CinematicSlide`'s setup — run before the parent's). Same-
  beat frames seek directly. Pauses are preview-only: the exported video never pauses, and
  `click_gate` is skipped for free (it only halts autoplay's own ticker; `timed-interactive`
  lint warns). The editor gets a deck-time ruler (`components/editor/DeckRuler.tsx`, on the
  shared `components/timing/TimeBar.tsx`) that selects the beat under `T` and seeks the
  editor canvas — still the simpler `seek.ts` renderer; continuous whole-deck playback in the
  editor remains §7c's job. "Play deck" / "Play from here" call `useAutosave().flush()` before
  opening `/play`, because `/play` loads the *persisted* deck and autosave is debounced.
  **Gotcha:** the tab must be opened synchronously in the click (`window.open("", "_blank")`)
  and only navigated after the flush — Safari drops the user gesture across an `await`, so a
  `window.open` after the save is popup-blocked and Play silently does nothing
  (`components/editor/PlayLink.tsx`).
- **While the soundtrack plays, the audio IS the deck clock** (sub-project 2). A deck carries
  one pre-mixed track (`meta.soundtrack.media`); `lib/audio/soundtrack.ts` decodes it once
  (Web Audio) and its `now()` gives deck time from the audio hardware clock. The Player's rAF
  step feeds that into `apply()` — still the **only** writer of `T`, so the one-clock rule
  holds; past the track's end, before it loads, or with no soundtrack, the rAF timer drives.
  Load-bearing details:
  - `now()` is **latency-compensated and smoothed**: it reads `getOutputTimestamp().contextTime`
    (the time actually audible), extrapolates with `performance.now()` capped at **100 ms** and
    only while the context is `running`, holds at the play offset until sound is audible, and is
    monotonic per `play()`. Fallback without `getOutputTimestamp`: `currentTime −
    outputLatency`. Raw `currentTime` would let the picture lead the sound by the output latency
    (150–250 ms on Bluetooth) — an offset authors would bake into the export.
  - **Stall guard** (`TimedPlayer.tsx`, `AUDIO_STALL_MS = 500`): a non-null reading that doesn't
    advance for 0.5 s (e.g. autoplay blocked, context never resumed) hands `T` to the timer;
    when the audio moves again it is re-synced with one `play(T)`. The 100 ms extrapolation cap
    is deliberately below this window so a dead context still reads as "not advancing".
    **Known gap:** start-up (~170 ms measured in headless Chromium) + Bluetooth output latency
    can approach 500 ms and trip the guard → one audible re-sync skip; revisit the constant
    (e.g. 500 ms + `outputLatency`) if it shows up in practice.
  - `play-clock` exposes `data-clock="audio" | "timer"` — "audio" **only** on frames where the
    audio reading strictly advanced (frozen/first frames read "timer"). The e2e asserts it, which
    is the only end-to-end proof that sound drives picture.
  - Transport: arrows / Home / end-restart seek while playing and restart the track at the new
    `T`; the scrubber and marker clicks pause, then jump. `M` / HUD button mutes (preview only).
  - Decodes are cached per URL for the page (`lib/audio/use-soundtrack.ts`), shared by the
    Player, the ruler and Deck settings; `releaseSoundtracksExcept(deckId, keep)` frees a
    replaced/removed track (decoded PCM is ~90 MB for a few minutes of stereo).
  - The ruler and Player scrubber draw the waveform (`TimeBar` `peaks`, memoised on identity) and
    deck-time **cue markers** (`meta.markers`, "+ Marker" on the ruler, edited in Deck settings).
  - e2e needs Playwright `launchOptions.args: ["--autoplay-policy=no-user-gesture-required"]`
    (top-level `use` in `playwright.config.ts`); `e2e/audio-clock.spec.ts` is the gate that the
    Web Audio clock advances in the test browser at all.
- **The deck media store** (`lib/store/media-store.ts`, routes `app/api/decks/[id]/media/…`)
  holds audio, images (png/jpg/webp/gif) and video (mp4/webm). Files live at
  `MORGANA_DATA_DIR/media/<deckId>/<mediaId>` + a `<mediaId>.json` sidecar; ids are content
  hashes (`/^[0-9a-f]{16}\.[a-z0-9]{1,5}$/`, same bytes → same id). Every path passes the id
  regex AND a `resolve`/`startsWith(dir + sep)` containment check; `deleteDeckMedia`'s recursive
  `rm` has its own containment guard; `deleteDeck` cascades to media. Content-Type comes from
  an extension allowlist, never the client; GET adds `nosniff` + `CSP: sandbox` (ahead of SVG
  images). The upload cap (`MORGANA_MEDIA_MAX_MB`, default 200) is enforced **while the body
  streams in** — a Content-Length check alone is bypassable by chunked/lying bodies (found by a
  security review). Routes are unauthenticated like the deck routes (self-hosted model; a hosted
  instance is gated at the proxy). Delete removes the sidecar before the bytes (an orphan
  sidecar would make a re-upload skip rewriting the bytes).
  **Every upload is content-sniffed** (`lib/store/media-sniff.ts`, pure, fail-closed) before
  hashing: magic bytes per extension; MP4 walks every `trak`'s `stsd` lazily with caps (10k top /
  1k per container / 64 entries — a tiny-box file once cost 2.6 GB heap) against one allowlist
  (video avc1/avc3/vp09/av01, normal audio, benign tmcd/mebx/text…); anything else → 400 with a
  shell-quoted ffmpeg re-encode command. WebM: EBML + CodecID in the first 1 MiB. HEVC (iPhone) is
  rejected because Playwright's Chromium can't decode it. GET serves single byte ranges (206/416,
  streamed via `statMedia` + `createReadStream`) — required for `<video>` seeking. Sidecar carries
  client-reported `durationSec` (lint/display only).
  **Base-path gotcha:** `mediaPath()` is deliberately unprefixed because `loadSoundtrack`
  applies `withBasePath` itself; DOM consumers must use `mediaUrl()`. It carries an explicit,
  reasoned entry in `base-path-callsites.test.ts`'s allowlist — don't reshape code to dodge that
  guard.
- **Three deliberate behaviour changes from §7b, not bugs:** counters (`counterValueAt`) and
  media (`mediaStateAt`) are now computed from time rather than animated on wall-clock, and
  `rotateList` derives its currently-visible item from elapsed time (`rotateItemAt`,
  `engine/components/effects/cinematic-anim.ts`) instead of running an infinite GSAP loop. All
  three are consequences of the same shift: state is a pure function of `t`, not a live tween.
- **Gotcha — GSAP's power ease names run one ahead of their exponent.** `power1` is quadratic,
  `power2` is cubic, `power3` is quartic (`power3.inOut` is symmetric). Porting a GSAP ease to
  a closed-form function and getting this off-by-one wrong makes a scrubbed frame silently
  disagree with playback — precisely the drift §7 exists to remove — and it happened twice
  during §7b. The in-repo proof is `note-state.ts`'s `powerOut1`, GSAP's `power1.out`,
  implemented as `1 - (1 - p) * (1 - p)` (quadratic, not linear or cubic).
- **Deferred issue, recorded so §7c inherits it rather than rediscovering it.** In static/print
  mode, `CinematicSlide` calls `runtime.art(runtime.resolveEnd(), "cut")` explicitly and then
  `renderAt(duration())`'s own art-diffing re-issues this beat's mid-timeline `art` actions —
  a genuine double-issue. It is idempotent **by construction today only**: `applyArt` in
  `engine/deck/flatten.ts` unconditionally discards its input and resets to `[...to]` whenever
  a transition carries neither `keep` nor `out`, and no action anywhere in the codebase uses
  those fields yet. The moment one does, `keep`/`out` will filter against the wrong
  already-resolved stack in this branch and can produce duplicate layers or a wrong final
  composition. This was flagged and deliberately left unfixed during §7b (not in scope); fix
  it (e.g. suppress `renderAt`'s art dispatch for this one static call) before or alongside the
  first `keep`/`out`-bearing mid-timeline `art` action. (Static mode's explicit `resolveEnd`
  art is now autoplay-only, and host-driven mode no longer issues art at all — `art-clock.ts`
  folds `keep`/`out` against the true prior stack — so only the autoplay static path remains.)

When syncing this deep-dive after a Morgana change, remember the split:
architecture/role/contract facts belong **here**; feature design detail belongs
in the Morgana repo's `docs/`.

## Positioning (the invariant)

**Generic, standalone OSS — no Mycelium-specific coupling in the repo.** It
spins up in a container, stores portable JSON, and is fully usable by one
person with no account. Convergence with other MM consumers (notably
mm-website, whose investor-hub cinematic deck the engine was vendored from) is
an *interop outcome* of clean seams, not the organizing principle: mm-website
is one consumer of the deck format, not a dependency baked into Morgana. Any
proposal that would couple this repo to MM infrastructure (a specific CDN host,
mm-jenkins CI, an MM auth requirement to run) is out of scope by construction.

## Cross-repo contracts

- **Render engine lineage.** `engine/` is vendored from mm-website's
  investor-hub cinematic deck (GSAP + tsParticles). Package extraction into a
  shared `@musical-mycology/morgana` engine package is a Tier-3 roadmap item,
  gated on a `DeckDoc` format-version freeze (see the end-state design §14a).
  **The lineage is one-way, and `engine/` has now materially diverged** (§7a,
  2026-07-27): `CinematicRuntime` lost five members, `NoteField` was rewritten
  reducer-driven, and `makeNote`/`emitNote`/`launchNote` were deleted. Nothing
  downstream broke — the vendoring direction is *from* mm-website, not to it —
  but a future re-vendor in either direction will conflict in those files and
  should be treated as a merge, not a copy.
- **Export round-trip.** `deckDocToModule` (`lib/bridge/export-ts.ts`) emits a
  deck's scenes as a TS module the site can import; the round-trip closes when
  mm-website's hand-authored `investor-hub/lib/deck/` modules are authored in
  Morgana instead. **In-app export shipped** (the Export panel, `export-toggle`
  → `components/editor/ExportPanel.tsx`); **import is still roadmap**, so the
  round-trip is currently one-way.

## AI integration (MCP server)

Morgana exposes its deck-editing mutation API as an MCP server (`/api/mcp`,
Streamable HTTP, bearer-token auth generated by the instance itself). A user's
own Claude client (claude.ai Connectors, Claude Desktop) connects directly and
edits a deck using their own subscription — Morgana never calls the Anthropic
API and never stores an Anthropic credential of any kind. This preserves the
positioning invariant above (no account requirement, no external service
dependency baked into the container): the MCP server is opt-in, needs nothing
beyond the token Morgana generates for itself, and the rest of the app is
unchanged if it's never connected to. Design:
`docs/superpowers/specs/2026-07-23-morgana-mcp-server-design.md` (in-repo,
supersedes the end-state design's earlier §12 "in-app AI assistant" sketch,
which had assumed a third-party "Sign in with Claude" OAuth product that
doesn't exist). As of the Tier 1.5 hardening sweep, the tool surface also
includes scene-structural tools with `scene_index` addressing:
`move_scene_by`, `append_beat_to_scene`, and `delete_scene_at` (which also
accepts `scene_index` directly, in addition to `beat_index`).

**Contract change to an already-published tool (2026-07-27):** `move_beat_by`
used to no-op at a scene boundary; it now *transfers* the beat into the
adjacent scene, and is a no-op only when no adjacent scene exists in that
direction. Connected Claude clients see the changed behavior immediately —
there is no version negotiation on the tool surface — so the tool's own
`description` and the README were updated in the same change. Treat any future
change to a shipped tool's semantics the same way: the description is the only
contract a remote model reads.

**Contract widening via the registry (2026-07-27, §7a):** `lib/mcp/tool-defs.ts`
derives `ACTION_KINDS` from `Object.keys(REGISTRY)` and publishes it as the
`enum` for `add_action.kind` and `convert_action.new_kind`. So **adding a
descriptor to `lib/editor/registry.ts` silently widens the MCP tool surface** —
completing the note descriptors added `note_circle`, `stop_notes`, and
`stop_circle` as callable kinds for connected Claude clients, and changing
`note_emitter`'s `decay` default (`1` → `1000`; it was one *millisecond*,
clamped by the engine to a 0.1s floor) changed what `add_action` inserts.
Neither needed a tool-description edit, but both reached remote clients the
moment they shipped. Remember this coupling when touching the registry: it is
an editor-metadata file with a published-API side effect.

**Timing tools (2026-10-22):** `set_scene_duration(deck_id, scene_index, seconds | null)` pins
or un-pins a scene's length; `read_deck_timing(deck_id)` returns the computed layout (target,
total, per-scene start/length/content/overrun, per-beat start/duration) so a remote model
never sums action durations itself; `update_meta` with path `timing` and value `null` makes a
deck untimed (the only path where `null` deletes). `callTool`'s return type is now
`DeckDoc | DeckTiming | …`, not `DeckDoc` alone.

**Soundtrack tools (2026-10-23):** `list_media(deck_id)` lists the deck's uploaded files;
`set_soundtrack(deck_id, media_id | null)` picks one (rejects ids not in the deck's media) or
clears it; `set_markers(deck_id, markers[])` replaces the cue-marker list (entries are reduced
to `{id, label.trim(), t}` before validation, so extra keys never persist). Binary upload is
**not** possible over MCP — the descriptions tell the model to have the user upload in the
editor. Setting `soundtrack` via `update_meta` skips the media-list check (lint still flags a
missing file), which the `update_meta` description now says.

## CI / ops

CI runs in **GitHub Actions** (unit + e2e), keeping the repo free of MM infra
coupling — mm-jenkins is intentionally *not* used here. The e2e job `apt-get install`s ffmpeg for
`e2e/render-cli.spec.ts` (ffprobe-checked MP4), which skips locally without ffmpeg but
**fails** under `CI`. No Kuma monitor and no
hosting target yet (`ci_pipeline: none`, `expected_kuma_monitor: none` in
`mm-meta.yml`) until a deployment is chosen.

**Gotcha — a scene with no beats is legal, and must stay reachable.** The
filmstrip originally derived its scene groups from the *flat beat list*, so a
scene whose last beat was deleted became invisible: unselectable, unfillable,
undeletable, and still present in the saved JSON. Since the Tier 1.5 sweep the
filmstrip iterates `doc.scenes` (`sceneGroups` in `lib/editor/flatten-beats.ts`)
and renders an empty scene with its header plus an empty-state row, and a
`scene-empty` lint warning surfaces it. Cross-scene beat move can legitimately
empty a scene, so this is a normal authoring state, not a defect. Do **not**
"tidy" it by auto-pruning empty scenes — that silently restores the orphan bug
and removes the only way to refill a scene. Any new code that maps scene→beat
indices must tolerate a zero-beat scene (`flatIndexOf` returns `-1` for one,
which is why lint rows located only to a scene are deliberately not jumpable).

**Gotcha — the e2e build step must not move into a Playwright `globalSetup`.**
The suite needs one `next build` up front (three `webServer` entries share it:
`next start` on :3000/:3200 and the standalone server on :3100). That build runs
from the `test:e2e` **npm script** (`scripts/prepare-standalone.sh && playwright
test`), *not* from `globalSetup`, because Playwright launches `webServer` entries
during plugin setup — which happens **before** `globalSetups`. A build in
`globalSetup` is therefore always too late, and every server dies instantly with
`Could not find a production build in the '.next' directory`. This is not
theoretical: it was the configuration from the CI workflow's introduction
(2026-07-20) until 2026-07-24, and CI failed on *every* run in that window,
before a single test executed. Corollaries: run the suite as `npm run test:e2e`
(a bare `npx playwright test` assumes a prepared build), and treat any future
"move the build into globalSetup" tidy-up as a regression.

**Gotcha — `library.spec.ts` "empty state" fails with `EXDEV` on WSL.** The spec renames deck
files into `os.tmpdir()`; where `/tmp` is a different filesystem from the checkout (typical
WSL), `rename` fails with `EXDEV: cross-device link not permitted`. It is environment-only (it
fails identically on `main`); CI's runner is unaffected. Fix by copy+unlink or a temp dir on the
same device if it starts to matter locally. The `/dev/seekbench` page + `e2e/seek-bench.spec.ts`
are a standing perf gate: mean per-frame forward `seek` on a deliberately busy beat must stay
< 8 ms (measured 0.25 ms when the seek-driven Player landed).
