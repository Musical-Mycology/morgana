# Video clips + image uploads — design

**Status:** implemented (sub-project 4)
**Roadmap:** timed-video sub-project 4 of 6 — see
[Deck clock + timed Player](2026-10-22-deck-clock-timed-player-design.md) §0.2. Builds on
[Soundtrack + deck media store](2026-10-23-soundtrack-design.md) (#37) and
[MP4 render](2026-10-24-mp4-render-design.md) (#38, plus the demuxer-pinning fix #39).
**Driving use case:** the Alt-Ctrl 2027 festival video's Background section (16–40 s, a
photo/video collage) and Gameplay section (40–90 s, full-frame footage), playing in `/play` and
rendering frame-accurately into the MP4.

---

## 0. Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Where footage appears | **Both**: full-frame as an **art layer** (crossfades, keep/out like panels) and positioned as a **media tile** (collage) |
| Clip audio | **Always muted** — the soundtrack is the one pre-mixed track |
| Unplayable uploads (e.g. iPhone HEVC) | **Rejected with a copy-paste ffmpeg fix**; no server-side transcoding |
| Clip time | Starts at an optional **in-point** when its layer/tile appears, plays at **1×** locked to deck time, **holds its last frame** past its end; optional per-use **loop** |
| Editor | **Media library** in Deck settings + **pickers** on art and tile source fields |
| Approach | **`media:<id>` references** inside the existing art and tile systems (not a new video layer, not CLI frame extraction) |

Fact established during brainstorming: Playwright's headless Chromium (the renderer) plays H.264,
VP9 and AV1 and supports `requestVideoFrameCallback`; it does **not** play HEVC.

## 1. Media store: images + video, content-checked

`lib/store/media-store.ts` gains, next to `AUDIO_TYPES`:

- `IMAGE_TYPES`: `png → image/png`, `jpg`/`jpeg → image/jpeg`, `webp → image/webp`, `gif → image/gif`.
- `VIDEO_TYPES`: `mp4 → video/mp4`, `webm → video/webm`.
- `mediaKind(mime) → "audio" | "image" | "video"`.

**Content check (new, every upload):** `saveMedia` verifies the bytes match the extension
(`lib/store/media-sniff.ts`, pure). A mismatch is a 400 `"<name> is not a valid <ext> file"`:

| ext | check |
|---|---|
| png | `89 50 4E 47 0D 0A 1A 0A` |
| jpg/jpeg | `FF D8 FF` |
| gif | `GIF87a` / `GIF89a` |
| webp | `RIFF????WEBP` |
| mp4 | ISO-BMFF: first box is `ftyp`; walk `moov → trak → mdia → minf → stbl → stsd` and every video sample entry's fourcc must be one of `avc1`, `avc3`, `vp09`, `av01` (HEVC `hvc1`/`hev1` and anything else → 400 with the fix below). No video track → 400. |
| webm | EBML magic `1A 45 DF A3`, DocType `webm`, and a `CodecID` of `V_VP8`, `V_VP9` or `V_AV1` within the first 1 MiB |
| audio (existing types) | mp3: `ID3` or an MPEG frame sync; wav: `RIFF????WAVE`; ogg: `OggS`; flac: `fLaC`; m4a: ISO-BMFF `ftyp`; aac: ADTS sync `FFF` |

The HEVC / unsupported-codec rejection message carries the fix:
`unsupported video codec (<fourcc>) — convert with: ffmpeg -i '<name>' -c:v libx264 -crf 18 -pix_fmt yuv420p -an out.mp4`.
The name is POSIX single-quoted (a `'` inside it becomes `'\''`), so pasting the command never
runs shell syntax from an uploaded file name.

This closes the content-sniffing class behind #39 for every consumer (browser, ffmpeg).
Existing files are not re-checked. SVG stays unsupported (active content).

**Sidecar:** `MediaInfo` gains optional `durationSec?: number` (video/audio). The upload form may
send a `durationSec` field (the editor reads it from a `<video>`/`<audio>` element's metadata
before uploading); the server stores a finite positive number or drops it. It is used only for
lint and display, never for security.

**Byte ranges (required for video seeking):** `GET /api/decks/<id>/media/<mediaId>` honours a
single `Range: bytes=a-b` / `a-` / `-n` with `206` + `Content-Range` + `Accept-Ranges: bytes`;
unsatisfiable → `416`. Full responses also send `Accept-Ranges: bytes`. Reads stream from disk
(`open` + `read` of the requested slice; `readMedia` no longer buffers whole files for GET).
Headers otherwise unchanged (`nosniff`, `CSP: sandbox`, immutable cache).

## 2. References: `media:<id>`

- `engine/deck/media-ref.ts` (pure): `MEDIA_REF_PREFIX = "media:"`, `isMediaRef(s)`,
  `mediaRefId(ref)`, `toMediaRef(id)`, `isVideoRef(ref)` (extension `mp4`/`webm`).
  A `MediaRef` is `` `media:${string}` ``.
- `ArtTransition.to`, `.keep`, `.out` accept `ArtAsset = StoryAsset | MediaRef`. Media refs are
  never overlays (`isOverlay` stays panel-key based).
- `ArtTransition.clips?: Record<MediaRef, ClipOpts>` and the media tile's
  `clip?: ClipOpts`, where `ClipOpts = { in?: number; loop?: boolean }` (seconds; defaults `in: 0`,
  no loop). For an art layer the options come from the transition that **brought it in**; a later
  keep does not change them.
- The media tile `src` accepts a `MediaRef` or a URL (unchanged).
- **Resolution:** `AssetResolver` gains `media(ref: MediaRef): string`, and `story()` keeps
  handling panel keys. A deck-scoped resolver `deckAssetResolver(deckId)` maps a media ref to
  `mediaUrl(deckId, id)` (base path applied, the one seam). `/play`, `/render` and the editor
  wrap their stages in the existing `AssetResolverProvider` with it. The default resolver (no
  deck) resolves media refs to `""` and logs nothing.

Deck validation stays permissive (art strings were never validated); lint (§5) catches bad refs.

## 3. Clip time

`engine/deck/clip-clock.ts` (pure, in the pure-import-graph test):

```ts
export interface ClipOpts { in?: number; loop?: boolean }
/** Seconds into the clip at deck time T for a clip that appeared at `since`. `duration` is the
 *  clip's media duration (NaN/undefined until known → treated as unbounded). */
export function clipTimeAt(since: number, T: number, opts: ClipOpts | undefined, duration?: number): number
```

- `t = in + max(0, T − since)`.
- Unknown duration → `t`.
- `loop` and `duration > in` → `in + ((t − in) mod (duration − in))`.
- Otherwise hold the last frame: `min(t, duration − HOLD_EPSILON)` with `HOLD_EPSILON = 0.001`.
- `in` is clamped to `[0, duration − HOLD_EPSILON]`.

**Art layers:** `ArtLayerState` gains `since: number` (deck time the layer entered) and
`clip?: ClipOpts`. In `artAt`:
- a new layer takes `since = e.start` and the event's `clips[asset]`;
- a kept layer keeps its `since` and `clip`;
- an outgoing layer keeps both while it fades;
- a layer re-added while still visible counts as kept and continues.

**Tiles:** the media fold already knows each show action's beat-local start. `MediaRenderState`
gains `since` (beat-local start of the `media` action that showed it) and `clip`.

## 4. Painting video

`engine/components/video-sync.ts` (DOM, small):

```ts
export type ClipMode = "play" | "seek";
export function syncVideo(el: HTMLVideoElement, clipT: number, mode: ClipMode): void
export function pendingVideoSeeks(): Promise<void>   // resolves when every seek issued by syncVideo has presented a frame
```

- `"play"`: if paused, `play()` (muted), seeking first only if `|currentTime − clipT| > DRIFT_SEC`
  (0.1). If playing and `|currentTime − clipT| > DRIFT_SEC`, re-seek. A play-mode seek aims ahead
  by the element's last measured seek latency (write → `seeked`, capped at 0.5 s), so on long-GOP
  footage it lands where the deck will be instead of re-seeking forever. Holding past the end:
  when `clipT` is clamped at the end, pause.
- `"seek"`: `pause()`; if `|currentTime − clipT| > 1e-4`, set `currentTime = clipT` and register a
  pending promise that resolves on `seeked` followed by one `requestVideoFrameCallback` (or on
  `error`, recording a failure). If `readyState < 1`, wait for `loadedmetadata` first (the
  duration is needed for hold/loop), then compute and seek.
- Every video is created `muted`, `playsInline`, `preload="auto"`, with no `autoplay`. Where clip
  playback is off (the editor canvas and library thumbnails, `clipPlayback={false}`) art layers use
  `preload="metadata"`; the in-point seek still fetches and shows that frame.

**Who passes the mode:** `useDeckStage` owns a `clipMode` ref: `"play"` while TimedPlayer is
playing, `"seek"` otherwise. RenderStage keeps it at `"seek"` always. It reaches CinematicSlide
through `BeatStage` as a stable ref prop (`clipModeRef`), read at paint time, so mode changes
never re-render the memoised `Stage`.

- **`ArtStage.renderState(layers, night, T, mode)`:** layers whose asset is a video ref get a
  `<video class="artstage__layer">` instead of an `<img>`. The video is reconciled by asset like
  images. It is painted with opacity, scale and z, then `syncVideo(el, clipTimeAt(l.since, T,
  l.clip, el.duration), mode)`. Image media refs get an `<img>` resolved via
  `assets.media(ref)`.
- **Autoplay `show`/`apply`:** a new video layer is created and `play()`s from its in-point,
  muted. There is no deck clock in autoplay.
- **Editor canvas:** it shows the in-point frame. A video layer is seeked to `in` and paused.
- **Media tiles** (`CinematicSlide.makeMediaEl` / `paintMedia`): a `src` that is a video ref
  creates a `<video class="cin__media-img">` inside the figure, and an image ref creates an
  `<img>`. On each paint, `syncVideo(el, clipTimeAt(state.since, t, state.clip, el.duration),
  clipModeRef.current)`. Here `t` is the beat-local time CinematicSlide just painted — except in a
  pinned scene's hold, where the beat's `t` is clamped at its end: there the host passes the
  unclamped elapsed beat time (`transport.seek(t, clipT)`), so tile clips keep running like art
  layers. In autoplay the mode is `"play"`. A tile whose `media_out` has settled is removed (its
  video released); a later re-show builds a fresh element.
- **Leaving the stage:** when a video element is removed from the DOM it is paused, and its
  `src` is cleared so the decoder is released.

**Render** (`RenderStage.renderFrame`): after `flushSync(apply)`, it awaits `pendingVideoSeeks()`
before the image decodes and fonts. Video errors (`error` event / failed seek) join the
image-failure report as `failed` srcs (warned once, render continues). The 60 s per-frame
timeout covers a seek that never lands.

## 5. Editor, MCP, lint

- **Media library** (`components/editor/MediaLibrary.tsx`, in `DeckSettings` under the
  soundtrack):
  - Upload via button and drag-drop, multi-file, with per-file errors shown inline (the server
    message, including the ffmpeg fix).
  - The client reads `durationSec` from a hidden media element before uploading video/audio.
  - Grid: image thumbnail; video first frame (muted `<video preload="metadata">`) with the
    duration; audio shown as a row with the duration.
  - Each item has its name, size, a copy-ref button (`media:<id>`) and delete.
  - Delete of media referenced by the deck asks for confirmation, listing the referencing beats
    (`findMediaRefs(doc, ref)`).
  - Shares `DeckMediaContext` / `refresh()` with the soundtrack picker. The soundtrack picker
    keeps listing audio only.
- **Asset picker** (new `Field` type `"asset"`, `components/editor/AssetPicker.tsx`):
  - A popover listing the built-in panels (`PANELS`, `OVERLAYS`) and this deck's image + video
    uploads.
  - Art "Panel(s)" (`art.to`) becomes a multi-select ordered list using it. Typing a key or ref
    still works.
  - Media tile "Source" uses it too: single, images + videos, with URL entry still allowed.
  - When the chosen asset is a video ref, the field also shows **In-point (s)** and **Loop**,
    which write `art.clips[ref]` or the tile's `clip`.
- **MCP:**
  - `list_media` adds `kind` and `durationSec` and documents that uploads go through the editor
    or `POST /api/decks/<id>/media`.
  - The art and tile action docs mention `media:<id>` and `clips`/`clip`.
  - There is no binary upload tool.
- **Lint** (`LintContext` gains `media?: MediaInfo[]` alongside the existing `mediaIds`, which
  the soundtrack rules keep using):
  - `media-missing` (warning): a ref whose id isn't in the deck's media.
  - `media-kind` (warning): audio used as art or tile, or a non-media ref in clip options.
  - `clip-in-past-end` (warning): `in ≥ durationSec`.
  - The rules are skipped when the media facts are absent.

## 6. Out of scope

- Clip audio.
- Transcoding.
- Playback speed.
- Masks and picture-in-picture inside panels.
- SVG uploads.
- Camera moves (sub-project 5).
- Seeking the editor canvas to a clip's mid-point: the editor is still `seek.ts`, which shows
  the in-point; §7c owns the editor's move to deck time.
- Re-checking files uploaded before this change.

## 7. Testing

- **Unit tests:**
  - `media-sniff`: every type's good and bad magic, an MP4 with avc1, vp09 or av01 passes, hvc1
    or hev1 is rejected with the fix text, a playlist disguised as `.mp4`/`.webm` is rejected, and
    an MP4 with no video track is rejected.
  - `saveMedia` content check.
  - Range parsing and the 206/416 route responses.
  - `clipTimeAt`: hold, loop wrap, in-point clamp, unknown duration, `T < since`.
  - `artAt` `since`/`clip` for new, kept, outgoing and re-added layers.
  - `mediaStateAt` `since`/`clip`.
  - The `media-ref` helpers.
  - The resolver under a base path.
  - `syncVideo` with a fake `HTMLVideoElement`: drift re-seek in play mode, exact seek plus a
    pending promise in seek mode, no seek when already there, waiting for metadata.
  - `ArtStage.renderState` creating `<video>` for video refs.
  - Tile video elements.
  - Asset picker and media library: upload error shown, delete confirmation lists refs.
  - Lint rules.
  - MCP `list_media` kind.
- **Fixtures** (`e2e/fixtures/media/`, committed, each under 100 KB):
  - `clip-h264.mp4` and `clip-vp9.webm`: 2 s, 320×180, 30 fps, from ffmpeg `testsrc2` with a
    frame counter;
  - `clip-hevc.mp4`, for rejection;
  - `still.png`.
  - The ffmpeg commands that produced them live in `e2e/fixtures/media/README.md`.
- **e2e tests:**
  - `render-page` determinism with a clip as an art layer and as a tile. Stepped and jumped
    frames must be byte-equal, including a crossfade between two clips, a backward jump, and a
    tile whose `loop` wraps.
  - `render-cli`, which uses real ffmpeg and ffprobe, renders a deck with a clip. A frame
    sampled at a known T must differ from the frame one clip-second earlier, which proves the
    clip advances.
  - `play.spec`: a clip art layer's `currentTime` is within 0.15 s of `clipTimeAt` after a
    scrub, and it advances while playing.
  - `media-library.spec`:
    - upload a PNG and the H.264 clip, which then appear in the grid;
    - uploading the HEVC fixture shows the ffmpeg fix;
    - pick the clip as art via the picker, and the canvas shows a `<video>`.

## 8. Risks

- **Seek cost:** each rendered frame seeks every visible clip. H.264 decodes from the previous
  keyframe, so a long GOP (OBS default: 250 frames) makes seeks slow. The README advises
  re-encoding with `-g 30` for faster renders. Correctness is unaffected.
- **Re-seeking on drift in `/play`** can visibly hitch on slow machines. `DRIFT_SEC` is the knob;
  the seek-latency lead keeps long-GOP footage from re-seeking in a loop, but each seek is still
  slow, so re-encoding with a short GOP helps `/play` too.
- **Many clips at once** (a collage of 6 tiles) means 6 decoders. This is fine in Chromium at
  1080p, but `preload="auto"` on large files uses memory. Tiles not yet shown are not created
  until reached.
