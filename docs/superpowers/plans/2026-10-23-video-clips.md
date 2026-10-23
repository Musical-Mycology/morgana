# Video Clips + Image Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uploaded images and muted video clips can be used as full-frame art layers and as positioned media tiles. Clip time is a pure function of deck time, so `/play` and the MP4 render show the right frame.

**Architecture:**
- **Store:** the deck media store accepts content-checked images and videos, and serves byte ranges.
- **References:** decks reference uploads as `media:<id>` wherever an art panel key or tile `src` goes.
- **Clip time:** a pure `clipTimeAt(since, T, opts, duration)` gives each clip's time.
- **Since:** `artAt` and `mediaStateAt` carry the deck time each layer or tile appeared (`since`).
- **Painting:** a small DOM helper `syncVideo` plays natively with drift correction in `/play`, and seeks exactly when scrubbing or rendering.
- **Render:** `renderFrame` waits for pending seeks.
- **Editor:** a media library and an asset picker.

**Tech Stack:** Next.js 15, React 19, TypeScript, GSAP, Vitest (jsdom), Playwright, system ffmpeg (fixtures + render CLI).

**Spec:** `docs/superpowers/specs/2026-10-23-video-clips-design.md`

## Global Constraints

- Accepted uploads:
  - IMAGE_TYPES `png→image/png, jpg→image/jpeg, jpeg→image/jpeg, webp→image/webp, gif→image/gif`;
  - VIDEO_TYPES `mp4→video/mp4, webm→video/webm`;
  - existing AUDIO_TYPES unchanged.
  - No SVG.
- Every upload is content-checked against its extension.
  - Allowed MP4 video sample entries: `avc1`, `avc3`, `vp09`, `av01`.
  - Allowed WebM CodecIDs: `V_VP8`, `V_VP9`, `V_AV1`, found within the first 1 MiB.
- Unsupported-codec message (exact): `unsupported video codec (<fourcc>) — convert with: ffmpeg -i '<name>' -c:v libx264 -crf 18 -pix_fmt yuv420p -an out.mp4` (`<name>` single-quoted, each `'` escaped as `'\''`)
- Content mismatch message (exact): `<name> is not a valid <ext> file`
- Media ref form: `media:<mediaId>` (prefix `MEDIA_REF_PREFIX = "media:"`); video refs end in `.mp4` or `.webm`.
- `ClipOpts = { in?: number; loop?: boolean }`, in seconds; defaults `in: 0`, no loop.
  - Art clip options come from the transition that brought the layer in.
- `HOLD_EPSILON = 0.001` s; `DRIFT_SEC = 0.1` s.
- Clips are always muted, `playsInline`, `preload="auto"` (`"metadata"` where clip playback is off: editor canvas, library thumbnails), and never `autoplay`.
- `durationSec` in the sidecar is client-supplied. Store it only if finite and > 0. It is for lint and display only.
- Range support on media GET: single range, `206` + `Content-Range` + `Accept-Ranges: bytes`; unsatisfiable → `416`. Keep `nosniff`, `CSP: sandbox` and the immutable cache headers.
- The base path is applied only in the asset resolver (`mediaUrl`). Never hand-build `/api/decks/...` URLs in components.
- `apply(T)` stays the only writer of deck time. Clip mode lives in a ref and must never re-render the memoised `Stage`.
- Pure modules (`media-ref.ts`, `clip-clock.ts`, `media-sniff.ts`, `art-clock.ts`, `media-state.ts`) must have DOM-free runtime import graphs (`tests/unit/pure-import-graph.test.ts`).
- No new npm dependencies.
- Commit messages: conventional (`feat(…)`, `fix(…)`, `test(…)`, `docs(…)`), with no attribution lines.

## Review Focus

1. A clip that is shorter than its time on screen should hold its last frame: not loop, not go black, and not throw (Task 3 + Task 9 e2e).
2. The same clip used twice at once (as an art layer and as a tile, or in two tiles) should play as independent elements, each at its own clip time (Task 8).
3. Media that is deleted while still referenced should give a lint warning. In the render it should be reported as a failed src, and the frame must not hang (Task 9 + Task 10).
4. A backward scrub across the moment a clip appears should remove that clip's element (tile) or fade it out (art), and the clip's time must never go negative (Task 3, Task 7, Task 9).
5. Uppercase extensions (`.MP4`, `.JPG`) should be accepted, content-checked, and give lowercase ids (Task 1).

---

### Task 1: Media store — image/video types, content sniffing, duration, fixtures

**Files:**
- Create: `lib/store/media-sniff.ts`, `tests/unit/media-sniff.test.ts`, `e2e/fixtures/media/{clip-h264.mp4,clip-vp9.webm,clip-hevc.mp4,still.png,README.md}`
- Modify: `lib/store/media-store.ts`, `app/api/decks/[id]/media/route.ts`, `tests/unit/media-store.test.ts` (add cases), any existing route test for uploads

**Interfaces — Produces:**
```ts
// lib/store/media-store.ts
export const IMAGE_TYPES: Record<string, string>;
export const VIDEO_TYPES: Record<string, string>;
export type MediaKind = "audio" | "image" | "video";
export function mediaKind(mime: string): MediaKind | null;   // by mime prefix audio/ image/ video/
export interface MediaInfo { id: string; name: string; mime: string; bytes: number; uploadedAt: string; durationSec?: number }
export async function saveMedia(deckId: string, file: { name: string; bytes: Uint8Array; durationSec?: number }): Promise<MediaInfo>;
// lib/store/media-sniff.ts (pure)
export function sniffMedia(ext: string, bytes: Uint8Array): { ok: true } | { ok: false; reason: "mismatch" } | { ok: false; reason: "codec"; fourcc: string };
```

- [ ] **Step 1: Fixtures.**
  - Generate them with ffmpeg; it is installed: `which ffmpeg` gives `/usr/bin/ffmpeg`.
  - Commit the outputs and a README that lists these exact commands:
    ```bash
    ffmpeg -y -f lavfi -i "testsrc2=size=320x180:rate=30:duration=2" -vf "drawtext=text='%{frame_num}':x=10:y=10:fontsize=40:fontcolor=white:box=1:boxcolor=black" -c:v libx264 -pix_fmt yuv420p -g 30 -an e2e/fixtures/media/clip-h264.mp4
    ffmpeg -y -f lavfi -i "testsrc2=size=320x180:rate=30:duration=2" -vf "drawtext=text='%{frame_num}':x=10:y=10:fontsize=40:fontcolor=white:box=1:boxcolor=black" -c:v libvpx-vp9 -b:v 200k -g 30 -an e2e/fixtures/media/clip-vp9.webm
    ffmpeg -y -f lavfi -i "testsrc2=size=320x180:rate=30:duration=1" -c:v libx265 -tag:v hvc1 -an e2e/fixtures/media/clip-hevc.mp4
    ffmpeg -y -f lavfi -i "testsrc2=size=320x180:rate=1:duration=1" -frames:v 1 e2e/fixtures/media/still.png
    ```
  - If `drawtext` is not available (no fontconfig), drop the `-vf` argument. Note in the README that `testsrc2` already varies per frame.
  - Each file must be under 100 KB. If one isn't, lower `-b:v` or `-crf`.
- [ ] **Step 2: Failing tests.** In `tests/unit/media-sniff.test.ts`, read the fixtures with `readFileSync`:
  - `sniffMedia("mp4", h264)` and `sniffMedia("webm", vp9)` → `{ ok: true }`; `sniffMedia("png", png)` → ok.
  - `sniffMedia("mp4", hevc)` → `{ ok: false, reason: "codec", fourcc: "hvc1" }`.
  - `sniffMedia("mp4", Buffer.from("#EXTM3U\n#EXTINF:1,\nfile:///etc/hostname\n"))` → mismatch; the same for `webm` and for `png`.
  - A `png` given JPEG bytes → mismatch.
  - Positive synthetic cases:
    - jpg `FF D8 FF E0…`;
    - gif `GIF89a`;
    - webp `RIFF\0\0\0\0WEBP`;
    - mp3 `ID3` and `FF FB`;
    - wav `RIFF\0\0\0\0WAVE`;
    - ogg `OggS`;
    - flac `fLaC`;
    - m4a: a minimal `ftyp` box `00 00 00 10 'ftyp' 'M4A ' 00 00 00 00`;
    - aac `FF F1`.
  - An MP4 with an `ftyp` box but no `moov` → mismatch. (A video MP4 must have a `vide` track.)
  - A WebM whose header is followed by `V_MPEG4/ISO/AVC` and no allowed CodecID → `{ reason: "codec", fourcc: "V_MPEG4/ISO/AVC" }`.
  - Media-store cases in `tests/unit/media-store.test.ts`:
    - `saveMedia(deck, { name: "Clip.MP4", bytes: h264 })` → id ends `.mp4` and mime is `video/mp4`;
    - `{ name: "x.mp4", bytes: hevc }` → `MediaError` 400 whose message equals the exact unsupported-codec message with `<fourcc>` = `hvc1` and `<name>` = `x.mp4`;
    - `{ name: "x.png", bytes: jpegBytes }` → 400 `x.png is not a valid png file`;
    - `durationSec: 2` is stored, while `NaN`, `-1` and `Infinity` are dropped;
    - `mediaKind("video/webm") === "video"`.
- [ ] **Step 3: Run** `npx vitest run tests/unit/media-sniff.test.ts tests/unit/media-store.test.ts` and expect them to FAIL.
- [ ] **Step 4: Implement `lib/store/media-sniff.ts`:**
```ts
/** Content checks for uploads (spec §1): the bytes must be what the extension claims, so no
 *  consumer (browser, ffmpeg) is ever handed a disguised playlist or document. Pure. */
const ascii = (b: Uint8Array, at: number, s: string) => s.split("").every((c, i) => b[at + i] === c.charCodeAt(0));
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const VIDEO_ENTRIES = new Set(["avc1", "avc3", "vp09", "av01"]);
const WEBM_CODECS = ["V_VP8", "V_VP9", "V_AV1"];

interface Box { type: string; start: number; end: number; body: number }
function* boxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  let at = from;
  while (at + 8 <= to) {
    let size = u32(b, at);
    const type = fourcc(b, at + 4);
    let body = at + 8;
    if (size === 1) { if (at + 16 > to) return; size = u32(b, at + 8) * 2 ** 32 + u32(b, at + 12); body = at + 16; }
    else if (size === 0) size = to - at;
    if (size < body - at || at + size > to) return;
    yield { type, start: at, end: at + size, body };
    at += size;
  }
}
const child = (b: Uint8Array, box: Box, type: string) => { for (const c of boxes(b, box.body, box.end)) if (c.type === type) return c; return undefined; };

/** Every `vide` track's sample-entry fourccs; null if this isn't a parseable ISO-BMFF file. */
function mp4VideoEntries(b: Uint8Array): string[] | null {
  const top = [...boxes(b, 0, b.length)];
  if (top[0]?.type !== "ftyp") return null;
  const moov = top.find((x) => x.type === "moov");
  if (!moov) return null;
  const out: string[] = [];
  for (const trak of boxes(b, moov.body, moov.end)) {
    if (trak.type !== "trak") continue;
    const mdia = child(b, trak, "mdia");
    const hdlr = mdia && child(b, mdia, "hdlr");
    if (!mdia || !hdlr || fourcc(b, hdlr.body + 8) !== "vide") continue;
    const stbl = (() => { const minf = child(b, mdia, "minf"); return minf && child(b, minf, "stbl"); })();
    const stsd = stbl && child(b, stbl, "stsd");
    if (!stsd) { out.push("????"); continue; }
    for (const entry of boxes(b, stsd.body + 8, stsd.end)) out.push(entry.type);
  }
  return out;
}

export type SniffResult = { ok: true } | { ok: false; reason: "mismatch" } | { ok: false; reason: "codec"; fourcc: string };

export function sniffMedia(ext: string, b: Uint8Array): SniffResult {
  const bad: SniffResult = { ok: false, reason: "mismatch" };
  const ok: SniffResult = { ok: true };
  switch (ext) {
    case "png": return ascii(b, 0, "\x89PNG\r\n\x1a\n") ? ok : bad;
    case "jpg": case "jpeg": return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? ok : bad;
    case "gif": return ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a") ? ok : bad;
    case "webp": return ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP") ? ok : bad;
    case "wav": return ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE") ? ok : bad;
    case "ogg": return ascii(b, 0, "OggS") ? ok : bad;
    case "flac": return ascii(b, 0, "fLaC") ? ok : bad;
    case "mp3": return ascii(b, 0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) ? ok : bad;
    case "aac": return b[0] === 0xff && (b[1] & 0xf6) === 0xf0 ? ok : bad;
    case "m4a": return b.length >= 8 && fourcc(b, 4) === "ftyp" ? ok : bad;
    case "mp4": {
      const entries = mp4VideoEntries(b);
      if (!entries || entries.length === 0) return bad;
      const unsupported = entries.find((e) => !VIDEO_ENTRIES.has(e));
      return unsupported ? { ok: false, reason: "codec", fourcc: unsupported } : ok;
    }
    case "webm": {
      if (!(b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)) return bad;
      const head = new TextDecoder("latin1").decode(b.subarray(0, Math.min(b.length, 1 << 20)));
      if (!head.includes("webm")) return bad;
      if (WEBM_CODECS.some((c) => head.includes(c))) return ok;
      const m = /V_[A-Z0-9/._-]+/.exec(head);
      return m ? { ok: false, reason: "codec", fourcc: m[0] } : bad;
    }
    default: return bad;
  }
}
```
- [ ] **Step 5: Wire up `media-store.ts`.**
  - Add `IMAGE_TYPES`, `VIDEO_TYPES`, `ALL_TYPES = { ...AUDIO_TYPES, ...IMAGE_TYPES, ...VIDEO_TYPES }` (not exported) and `mediaKind`.
  - In `saveMedia`, check the extension against `ALL_TYPES`, then the size cap, then `sniffMedia(ext, bytes)`:
    - `mismatch` → `new MediaError(400, \`${file.name} is not a valid ${ext} file\`)`;
    - `codec` → `new MediaError(400, \`unsupported video codec (${r.fourcc}) — convert with: ffmpeg -i ${shellQuote(file.name)} -c:v libx264 -crf 18 -pix_fmt yuv420p -an out.mp4\`)`, where `shellQuote` single-quotes the name (`'` → `'\''`).
  - Sniff before the content hash, and before the dedupe early-return.
  - Store `durationSec` when `typeof d === "number" && Number.isFinite(d) && d > 0`.
  - Use `mime: ALL_TYPES[ext]`.
  - Update the doc comment: "Generic: audio, images, video."
- [ ] **Step 6: Upload route** (`app/api/decks/[id]/media/route.ts`): after the existing `file` extraction, read the form's `durationSec` field (`Number(form.get("durationSec"))`) and pass it to `saveMedia`. Keep the parsed `FormData` in a variable to make this possible.
- [ ] **Step 7: Run tests.**
  - Run the two test files, plus `tests/unit/media-routes*.test.ts` or whichever route tests exist (`ls tests/unit | grep -i media`). Expect PASS.
  - Existing soundtrack tests that upload synthetic audio must still pass. If one uploads bytes that aren't valid for their extension, give it real magic bytes (e.g. `sineWav` from `e2e/helpers/wav.ts` or a `RIFF…WAVE` header). Do not weaken the sniffer.
  - Then run `npm test` and `npx tsc --noEmit`.
  - Then run `npm run test:e2e -- e2e/soundtrack.spec.ts e2e/render-cli.spec.ts --project=default`.
- [ ] **Step 8: Commit.** Message: `feat(media): accept content-checked images and video; record clip duration`.

---

### Task 2: Media GET serves byte ranges (streamed)

**Files:** Modify `app/api/decks/[id]/media/[mediaId]/route.ts`, `lib/store/media-store.ts`; Test `tests/unit/media-range.test.ts`.

**Interfaces — Produces:**
```ts
// lib/store/media-store.ts
export async function statMedia(deckId: string, mediaId: string): Promise<{ info: MediaInfo; path: string; size: number }>; // 404 MediaError if absent
export function parseRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null; // null = no/ignored Range → full body
```

- [ ] **Step 1: Failing tests.**
  - `parseRange` cases (`size` = 1000):
    - `null` → `null`;
    - `"bytes=0-99"` → `{0,99}`;
    - `"bytes=900-"` → `{900,999}`;
    - `"bytes=-100"` → `{900,999}`;
    - `"bytes=990-2000"` → `{990,999}`;
    - `"bytes=1000-"` → `"unsatisfiable"`;
    - `"bytes=5-2"` → `"unsatisfiable"`;
    - `"bytes=0-1,5-6"` (multi-range) → `null`, so the full body is served;
    - `"items=0-1"` → `null`.
  - Route tests: import the route handlers directly, as the existing media route tests do; check `ls tests/unit | grep -i media` and copy their deck/data-dir setup.
    - With no Range: 200, `Accept-Ranges: bytes`, full length.
    - `Range: bytes=10-19`: 206, `Content-Range: bytes 10-19/<size>`, body equal to `bytes.slice(10,20)`, `Content-Length: 10`.
    - `Range: bytes=999999-`: 416 with `Content-Range: bytes */<size>`.
    - Headers keep `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`.
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.**
  - `statMedia`: use `mediaPath` (which already validates), read the sidecar, and `stat` the file.
  - Route GET:
    - `const { info, path, size } = await statMedia(...)`;
    - `const r = parseRange(req.headers.get("range"), size)`;
    - `"unsatisfiable"` → 416;
    - otherwise stream the slice with `createReadStream(path, { start, end })` (from `node:fs`), wrapped as a web `ReadableStream` via `Readable.toWeb` (`node:stream`), with status 206 or 200.
  - Keep `readMedia` for other callers. Grep its callers; if only the GET route used it, leave it exported anyway, since the MCP or tests may use it.
- [ ] **Step 4: Run** the test, `npm test` and tsc, then `npm run test:e2e -- e2e/soundtrack.spec.ts e2e/audio-clock.spec.ts --project=default`. The soundtrack is fetched through this route.
- [ ] **Step 5: Commit.** Message: `feat(media): byte-range GET (206/416) streamed from disk`.

---

### Task 3: Media refs, ArtAsset type, clip clock (pure)

**Files:**
- Create: `engine/deck/media-ref.ts`, `engine/deck/clip-clock.ts`, `tests/unit/media-ref.test.ts`, `tests/unit/clip-clock.test.ts`
- Modify: `engine/deck/types.ts` (ArtTransition, media action), `engine/deck/story-assets.ts` (`isOverlay` accepts any string), every file `tsc` then flags for `StoryAsset` art stacks: `engine/deck/flatten.ts`, `engine/authoring/runtime.ts`, `engine/components/layouts/CinematicSlide.tsx` (types only), `engine/components/ArtStage.tsx` (types only), `engine/authoring/art-clock.ts` (types only), `tests/unit/pure-import-graph.test.ts` (add the two modules).

**Interfaces — Produces:**
```ts
// engine/deck/media-ref.ts
export const MEDIA_REF_PREFIX = "media:";
export type MediaRef = `media:${string}`;
export function isMediaRef(s: unknown): s is MediaRef;
export function mediaRefId(ref: MediaRef): string;
export function toMediaRef(id: string): MediaRef;
export function isVideoRef(s: unknown): s is MediaRef;          // media ref whose id ends .mp4/.webm (case-insensitive)
// engine/deck/types.ts
export type ArtAsset = StoryAsset | MediaRef;
export interface ClipOpts { in?: number; loop?: boolean }
// ArtTransition: to: ArtAsset | ArtAsset[]; keep?: ArtAsset[]; out?: ArtAsset[]; clips?: Record<MediaRef, ClipOpts>
// media action gains: clip?: ClipOpts
// engine/deck/clip-clock.ts
export const HOLD_EPSILON = 0.001;
export function clipTimeAt(since: number, T: number, opts: ClipOpts | undefined, duration?: number): number;
```

- [ ] **Step 1: Failing tests.**
  - `media-ref`:
    - `isMediaRef("media:0123456789abcdef.mp4")` is true, while `"1.01"`, `"media:"` and `42` are false;
    - `mediaRefId` round-trips with `toMediaRef`;
    - `isVideoRef("media:x.MP4")` is true; `"media:x.png"` and `"1.01"` are false.
  - `clip-clock`:
    - `clipTimeAt(10, 12, undefined, 5)` = 2;
    - `clipTimeAt(10, 9, undefined, 5)` = 0, since it is never negative;
    - `clipTimeAt(10, 12, { in: 1 }, 5)` = 3;
    - hold: `clipTimeAt(10, 20, undefined, 5)` = 5 − 0.001;
    - loop: `clipTimeAt(10, 16, { loop: true }, 5)` ≈ 1, and `clipTimeAt(10, 16, { in: 1, loop: true }, 5)` = 1 + ((6) mod 4) = 3;
    - unknown duration: `clipTimeAt(0, 7, undefined, NaN)` = 7, and with `undefined` it is also 7;
    - an in-point past the end is clamped: `clipTimeAt(0, 0, { in: 9 }, 5)` = 5 − 0.001;
    - loop with `duration <= in` falls back to hold.
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.**
```ts
// engine/deck/media-ref.ts
/** `media:<mediaId>` — a reference to this deck's uploaded media, usable wherever an art panel key
 *  or a media tile src goes (spec §2). Pure. */
export const MEDIA_REF_PREFIX = "media:";
export type MediaRef = `media:${string}`;
export function isMediaRef(s: unknown): s is MediaRef { return typeof s === "string" && s.startsWith(MEDIA_REF_PREFIX) && s.length > MEDIA_REF_PREFIX.length; }
export function mediaRefId(ref: MediaRef): string { return ref.slice(MEDIA_REF_PREFIX.length); }
export function toMediaRef(id: string): MediaRef { return `${MEDIA_REF_PREFIX}${id}` as MediaRef; }
export function isVideoRef(s: unknown): s is MediaRef { return isMediaRef(s) && /\.(mp4|webm)$/i.test(s); }
```
```ts
// engine/deck/clip-clock.ts
/** A clip's own time as a pure function of deck time (spec §3). Pure. */
import type { ClipOpts } from "@/engine/deck/types";
export const HOLD_EPSILON = 0.001;
export function clipTimeAt(since: number, T: number, opts: ClipOpts | undefined, duration?: number): number {
  const known = typeof duration === "number" && Number.isFinite(duration) && duration > 0;
  const last = known ? duration! - HOLD_EPSILON : Infinity;
  const inPt = Math.min(Math.max(0, opts?.in ?? 0), last);
  const t = inPt + Math.max(0, T - since);
  if (!known) return t;
  if (opts?.loop && duration! - inPt > HOLD_EPSILON) return inPt + ((t - inPt) % (duration! - inPt));
  return Math.min(t, last);
}
```
  - **Types:**
    - In `types.ts`, import `MediaRef` as a type from `./media-ref` and add `ArtAsset` and `ClipOpts`.
    - Change `ArtTransition` as given in Interfaces, and add `clip?: ClipOpts` to the `media` action variant.
    - Then run `npx tsc --noEmit` and change art-stack element types from `StoryAsset` to `ArtAsset` wherever tsc complains: flatten `applyArt`/`foldBeat`/`resolve*Art`, runtime `resolveEntry`/`resolveEnd`, CinematicSlide's runtime interface, ArtStage's handle/props/`current` ref, and art-clock's `ArtEvent.to` / `ArtLayerState.asset` / `fades` map.
  - `isOverlay(asset: string)`: overlays stay panel-key based, so a media ref is never an overlay.
  - `ArtStage`'s `img.src = assetsRef.current.story(l.asset)` will not type-check for a media ref. For now, guard it: `isMediaRef(asset) ? "" : assetsRef.current.story(asset)`, with the comment `// media refs: resolved in Task 5/7`. Task 7 replaces it.
  - Add both new modules to the pure-import-graph list.
- [ ] **Step 4: Run** the new tests, `tests/unit/pure-import-graph.test.ts`, `npm test` and tsc. Expect PASS, with no behaviour change elsewhere.
- [ ] **Step 5: Commit.** Message: `feat(engine): media:<id> refs, ArtAsset type and pure clipTimeAt`.

---

### Task 4: `since` + clip options in artAt and mediaStateAt

**Files:** Modify `engine/authoring/art-clock.ts`, `engine/deck/media-state.ts`, `engine/components/layouts/CinematicSlide.tsx` (the `mediaFold.push` line only); Test `tests/unit/art-clock-art.test.ts` (new describe), `tests/unit/media-state.test.ts` (or the existing media-state test file; `ls tests/unit | grep -i media-state`).

**Interfaces — Produces:**
```ts
// art-clock.ts
export interface ArtEvent { start: number; duration: number; mode: ArtMode; to: ArtAsset[]; clips?: Record<MediaRef, ClipOpts> }
export interface ArtLayerState { asset: ArtAsset; opacity: number; scale: number; z: number; overlay: boolean; since: number; clip?: ClipOpts }
// media-state.ts
export interface MediaFold { action: Action; p: number; start: number }   // start = beat-local start of this action
export interface MediaRenderState { x: number; y: number; scale: number; opacity: number; since: number; clip?: ClipOpts }
```

- [ ] **Step 1: Failing tests.**
  - **Art.** Build decks with the helpers already used in `art-clock-art.test.ts`. Use a beat with `art: { to: "media:a.mp4", mode: "crossfade", clips: { "media:a.mp4": { in: 2, loop: true } } }` at deck time 0. A later mid-beat action at t=3 is `{ to: "media:b.webm", mode: "crossfade", keep: ["media:a.mp4"] }`. Expect:
    - at T=1: layer a has `since: 0` and `clip: { in: 2, loop: true }`;
    - at T=3.5: a still has `since: 0` (kept), and b has `since: 3` and `clip: undefined`;
    - a third event at t=5 with `to: "1.01"` (no keep): during its crossfade at T=5.2, the outgoing a and b keep `since` 0 and 3;
    - at T=10 only 1.01 is left, with `since: 5`;
    - a layer re-added while still fading out (outgoing, then back in a later event within the fade) keeps its original `since`;
    - existing tests are unchanged, apart from adding `since` to `toEqual` expectations where needed. Prefer `toMatchObject` to avoid churn, and list any test you edit in the report.
  - **Media.**
    - `mediaStateAt([{ action: { kind: "media", id: "t", pos, src: "media:c.mp4", clip: { in: 1 } }, p: 1, start: 0.5 }], 2)` → `t.since === 0.5` and `t.clip` deep-equals `{ in: 1 }`.
    - Through a later `media_move` (start 1.5), `since` stays 0.5.
    - Through `media_out`, `since` is kept.
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.**
  - **artEvents:** `push` carries `clips: art.clips`.
  - **artAt:** keep a `since` map next to `fades`: `let since = new Map<ArtAsset, { at: number; clip?: ClipOpts }>()`.
    - On each event, for an incoming layer: if `prev.has(asset)`, use `since.get(asset)` (kept or re-added); otherwise use `{ at: e.start, clip: e.clips?.[asset as MediaRef] }`.
    - Build `nextSince` from the incoming layers.
    - Outgoing layers keep the `since`/`clip` already on their `ArtLayerState`. They carry them because `visible` holds full states.
    - Set `since = nextSince`, but keep entries for still-outgoing layers so a re-add within the fade finds them: merge with the old map for assets in `outgoing`.
    - Every returned layer has `since` (number) and `clip` (or undefined).
  - **mediaStateAt:**
    - A `media` action sets `{ ..., since: entry.start, clip: a.clip }`.
    - `media_move` and `media_out` spread `cur`, so they keep it.
    - Change the loop to destructure `{ action: a, p, start }`.
  - **CinematicSlide:** `mediaFold.push({ action: f.action, p: f.p, start: f.start })`, where `FoldEntry` already has `start`.
- [ ] **Step 4: Run** the art-clock and media-state tests, `npm test` and tsc. Expect PASS.
- [ ] **Step 5: Commit.** Message: `feat(engine): art layers and media tiles carry since + clip options`.

---

### Task 5: Deck-scoped asset resolver for media refs

**Files:**
- Modify: `engine/asset-resolver.ts`, `engine/asset-resolver-react.tsx`, `app/play/page.tsx` (or `components/player/TimedPlayer.tsx`, whichever renders the stage; read both), `app/render/page.tsx`, `app/editor/page.tsx`
- Test: `tests/unit/asset-resolver.test.ts` (new or existing)

**Interfaces — Produces:**
```ts
// engine/asset-resolver.ts
export interface AssetResolver { story(key: StoryAsset): string; brand(file: SporekleAsset | string): string; media(ref: MediaRef): string }
export const defaultAssetResolver: AssetResolver;           // media(ref) → "" (no deck)
// engine/asset-resolver-react.tsx (client)
export function DeckAssetsProvider({ deckId, children }: { deckId: string; children: React.ReactNode }): JSX.Element;
// lib/api/media-client.ts gains nothing; the deck resolver uses mediaUrl(deckId, mediaRefId(ref))
export function deckAssetResolver(deckId: string): AssetResolver;   // in engine/asset-resolver.ts
```

- [ ] **Step 1: Failing tests.**
  - `deckAssetResolver("d1").media("media:0123456789abcdef.mp4")` equals `mediaUrl("d1","0123456789abcdef.mp4")`.
  - With the base path set, it is prefixed. Look at how the existing base-path tests set it: grep `withBasePath` in `tests/unit` and mirror that.
  - `story("1.01")` is unchanged.
  - `defaultAssetResolver.media(...)` returns `""`.
  - `base-path-callsites.test.ts` must still pass. The resolver is the sanctioned seam; if the test's allowlist needs an entry, add one with a reason, as `mediaPath` has.
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.**
  - In the resolver: `deckAssetResolver = (deckId) => ({ ...defaultAssetResolver, media: (ref) => mediaUrl(deckId, mediaRefId(ref)) })`.
  - In `DeckAssetsProvider`: `useMemo(() => deckAssetResolver(deckId), [deckId])`, then `<AssetResolverProvider value=…>`.
  - Wrap the stage in `/play`, `/render` (around `RenderStage`) and the editor page's canvas region (inside the existing `DeckMediaContext.Provider`, using the loaded deck's id).
  - Importing `mediaUrl` from `lib/api/media-client.ts` into `engine/asset-resolver.ts` is acceptable. `asset-resolver.ts` already imports `lib/base-path`, and `media-client` imports only `withBasePath` plus a type.
- [ ] **Step 4: Run** the tests, `npm test` and tsc, then `npm run test:e2e -- e2e/play.spec.ts e2e/render-page.spec.ts --project=default`.
- [ ] **Step 5: Commit.** Message: `feat(engine): deck-scoped asset resolver for media refs`.

---

### Task 6: `syncVideo` — the one place video time is applied

**Files:** Create `engine/components/video-sync.ts`, `tests/unit/video-sync.test.ts`.

**Interfaces — Produces:**
```ts
export type ClipMode = "play" | "seek";
export const DRIFT_SEC = 0.1;
export function createClipVideo(src: string): HTMLVideoElement;          // muted, playsInline, preload=auto, no autoplay
export function syncVideo(el: HTMLVideoElement, clipT: (duration: number) => number, mode: ClipMode): void;
export function pendingVideoSeeks(): Promise<string[]>;                 // resolves when all issued seeks have presented; returns srcs that errored since last call
export function releaseVideo(el: HTMLVideoElement): void;               // pause, removeAttribute("src"), load()
```
`clipT` is a function of the element's duration, so the caller passes `(d) => clipTimeAt(since, T, clip, d)`. syncVideo calls it once the duration is known; before metadata loads, it waits.

- [ ] **Step 1: Failing tests.** Use a fake `HTMLVideoElement`: a real jsdom `<video>` with `currentTime`, `paused`, `readyState`, `duration`, `play`, `pause` and `requestVideoFrameCallback` stubbed via `Object.defineProperty`, plus `dispatchEvent` for `seeked`, `loadedmetadata` and `error`. Cases:
  - **Seek mode, metadata ready** (`readyState` 1, duration 5): `syncVideo(el, () => 2, "seek")` sets `currentTime` to 2 and pauses. `pendingVideoSeeks()` stays unresolved until `seeked` is dispatched *and* the rVFC callback fires, then resolves to `[]`.
  - **Seek mode, already within 1e-4:** no write to `currentTime`, and `pendingVideoSeeks()` resolves immediately.
  - **Seek mode, metadata not ready** (`readyState` 0): no seek until `loadedmetadata`. Then it seeks using the now-known duration: `clipT` receives 5.
  - **Seek mode, error:** dispatching `error` resolves the pending promise, and `pendingVideoSeeks()` returns `[el.src]` once (and `[]` on the next call).
  - **Play mode, paused:** sets `currentTime` and calls `play()`.
  - **Play mode, playing with drift 0.05:** no seek.
  - **Play mode, drift 0.2:** re-seek.
  - **Play mode, held at end** (`clipT` returns `duration − HOLD_EPSILON`): pause, don't loop.
  - `createClipVideo` sets `muted`, `playsInline`, `preload="auto"` and `autoplay=false`.
  - `releaseVideo` pauses and clears `src`.
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.** This is a module-level `Set<Promise<void>>` of pending seeks plus a `failed: string[]` queue.
  - Seek-mode flow: `await metadata()`, then `t = clipT(el.duration)`, then:
    - if `Math.abs(el.currentTime − t) > 1e-4`, set `el.currentTime = t`;
    - then await `seeked`, then await one `requestVideoFrameCallback`, falling back to `requestAnimationFrame` when rVFC is absent.
  - `error` resolves the promise and records `el.currentSrc || el.src`.
  - Register each pending promise in the set and remove it when settled.
  - `pendingVideoSeeks` awaits a snapshot of the set in a loop until it is empty, then returns and drains `failed`.
  - Play mode: if `readyState < 1`, do nothing this frame; the next paint retries.
    - Otherwise `t = clipT(el.duration)`.
    - If `t >= el.duration − 2*HOLD_EPSILON` and not looping, which is visible as `t` being clamped, set `currentTime = t` and pause.
    - Else if paused, set `currentTime = t` and `play().catch(() => {})`.
    - Else if `|currentTime − t| > DRIFT_SEC`, set `currentTime = t`.
- [ ] **Step 4: Run** the test, `npm test` and tsc. Expect PASS.
- [ ] **Step 5: Commit.** Message: `feat(engine): syncVideo — deck-time-driven clip playback (play + exact seek)`.

---

### Task 7: Clips as art layers (ArtStage + DeckStage + TimedPlayer)

**Files:**
- Modify: `engine/components/ArtStage.tsx`, `components/player/DeckStage.tsx`, `components/player/TimedPlayer.tsx`, `components/editor/DeckCanvas.tsx` (only if it calls `renderState`, which it should not; leave autoplay paths alone otherwise)
- Test: `tests/unit/art-stage-render-state.test.tsx` (add cases), `tests/unit/deck-stage.test.tsx` (add cases), `tests/unit/art-stage-video.test.tsx` (new, for the autoplay show path)

**Interfaces — Consumes:** Task 3, Task 4 (`ArtLayerState.since/clip`), Task 5 (`assets.media`), Task 6 (`createClipVideo`, `syncVideo`, `releaseVideo`).
**Produces:**
```ts
// ArtStageHandle
renderState(layers: ArtLayerState[], night: number, T?: number, mode?: ClipMode): void; // T/mode default 0/"seek"
// useDeckStage return gains:
clipMode: React.MutableRefObject<ClipMode>;   // TimedPlayer sets "play" while playing; RenderStage leaves "seek"
```

- [ ] **Step 1: Failing tests.**
  - **renderState with a video layer.** Use `{ asset: "media:a.mp4", opacity: 1, scale: 1, z: 1, overlay: false, since: 2 }` under a `DeckAssetsProvider deckId="d1"`, with T=3.5 and mode `"seek"`. Expect:
    - a `<video class="artstage__layer" data-asset="media:a.mp4">` whose `src` is `mediaUrl("d1","a.mp4")`, `muted`;
    - `syncVideo` is called with a `clipT` that yields 1.5 for duration 10 (spy on the module via `vi.mock("@/engine/components/video-sync", …)` while keeping `createClipVideo` real, or assert `currentTime === 1.5` with a fake `readyState`);
    - a second `renderState` with the same asset reuses the element, so there is no new video;
    - removing the layer calls `releaseVideo` on it;
    - an image media ref (`media:p.png`) creates an `<img>` with `assets.media` src.
  - **Autoplay show.** `show(["media:a.mp4"], "fade")` creates a video and calls `play()` from `in` 0. The test needs `HTMLMediaElement.prototype.play` stubbed to resolve.
  - **DeckStage.**
    - A deck whose beat art is `media:a.mp4` at T=0: `apply(1.25)` leaves the art video's `currentTime` at 1.25 in seek mode (fake readyState/duration via prototype stubs in the test).
    - `clipMode.current = "play"` then `apply(1.3)` uses play mode: `play` is called.
    - A scrub back to 0.5 seeks to 0.5.
  - **TimedPlayer.** Toggling play sets `clipMode.current` to `"play"`, and pausing sets it to `"seek"`. Assert through the hook's ref, exposed in the test via a test-only prop, or through an observable effect such as `play` being called on the art video. The existing timed-player tests must pass unchanged.
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.**
  - **ArtStage.** Add a helper `makeLayerEl(asset)`:
    - a video ref → `createClipVideo(assets.media(ref))`;
    - an image media ref → `<img src=assets.media(ref)>`;
    - otherwise the existing story `<img>`.
    - In all cases it sets `className`, `data-asset` and, for a video, `data-video="1"`.
  - Use `makeLayerEl` in both `render()` (autoplay) and `renderState`. The layer query becomes `.artstage__layer` over `HTMLElement`, not `HTMLImageElement`.
  - In `render()`, for a newly added video layer: `el.currentTime = clipIn(asset)`, where the in-point comes from the transition's `clips` passed down (extend `render(targets, mode, durationMs, clips?)`; `apply` passes `transition.clips`, and `show` passes none, so it uses 0), then `el.play().catch(() => {})`.
  - Removed layers: `releaseVideo` for videos, in both paths, including the outgoing fade's `onComplete`.
  - In `renderState(layers, night, T = 0, mode = "seek")`: for each video layer, `syncVideo(el, (d) => clipTimeAt(l.since, T, l.clip, d), mode)`.
  - CSS: `.artstage__layer` already uses `object-fit: contain`, which applies to `<video>` too, so add nothing.
  - **DeckStage.**
    - `const clipMode = useRef<ClipMode>("seek")`.
    - `paintArt` passes `T.current` and `clipMode.current`.
    - Return `clipMode`.
    - Pass `clipModeRef={clipMode}` to the memoised `Stage` → `BeatStage` (Task 8 consumes it; add the prop to `BeatStage` and `CinematicSlide` now, typed `React.RefObject<ClipMode> | undefined`, and leave it unused until Task 8).
  - **TimedPlayer:** in the effect that follows `playing` (around line 55), also set `clipMode.current = playing ? "play" : "seek"`, and call `apply(T.current)` once so the clips switch mode immediately.
  - **Editor (`DeckCanvas` via `seek.ts`):** autoplay/snap paths create video layers through `render()`. For the editor's static paint, a video layer should show its in-point and stay paused.
    - In `snap()` (used by jump nav and the editor), do not `play()`: set `currentTime = in` and pause. Make `render()` play only when `mode !== "cut"` or when not called from `snap`. Add a `play: boolean` argument.
    - Document that the editor shows the in-point frame (spec §6).
- [ ] **Step 4: Run** the focused tests, `npm test` and tsc, then `npm run test:e2e -- e2e/play.spec.ts e2e/render-page.spec.ts e2e/deck-canvas.spec.ts --project=default`.
- [ ] **Step 5: Commit.** Message: `feat(player): clips as art layers — deck-time video in ArtStage, play/seek clip mode`.

---

### Task 8: Clips and images as media tiles

**Files:** Modify `engine/components/layouts/CinematicSlide.tsx` (`makeMediaEl`, `paintMedia`, `clearMedia`, props), `engine/authoring/BeatStage.tsx` (prop passthrough); Test `tests/unit/cinematic-media-video.test.tsx` (new).

**Interfaces — Consumes:** Task 4 (`MediaRenderState.since/clip`), Task 5, Task 6, Task 7 (`clipModeRef` prop).
**Produces:** CinematicSlide prop `clipModeRef?: React.RefObject<ClipMode>`. BeatStage forwards it.

- [ ] **Step 1: Failing tests.** Render `BeatStage` host-driven (`autoplay={false}`, transport ref) under `DeckAssetsProvider deckId="d1"`. The beat is `media { id: "t", src: "media:c.mp4", pos: {x:.5,y:.5}, clip: { in: 1 } }` at t=0, then `wait 3000`.
  - `transport.seek(2)` → `.cin__media video` exists, `muted`, with src `mediaUrl("d1","c.mp4")`, and is seeked to clip time 3 (in 1 + 2 s), using fake `readyState`/`duration` = 10.
  - With `clipModeRef.current = "play"`, `seek(2.5)` → `play` is called.
  - A backward seek before the media action (seek 0 when the media action is at 0.5 in a variant fixture) → the tile is removed and `releaseVideo` is called.
  - An image ref `media:p.png` creates an `<img>` with `assets.media` src.
  - **Review Focus #2:** the same `media:c.mp4` as both a tile and the art layer (mount ArtStage via BeatStage `art` default true, autoplay false) gives two distinct video elements.
  - In autoplay (`autoplay` true), a video tile `play()`s.
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.**
  - In `makeMediaEl`, when `a.src` is a media ref, resolve it with `assets.media` (CinematicSlide gets the resolver via `useAssetResolver()`; check how it gets `assets` today, since it already resolves brand assets). A video ref → `createClipVideo(url)` with `className = "cin__media-img"` (plus `--round`) inside the `figure`. An image ref → `<img>` as today.
  - `paintMedia`: after setting position and opacity, if the tile holds a video: `syncVideo(video, (d) => clipTimeAt(s.since, t, s.clip, d), autoplay ? "play" : (clipModeRef?.current ?? "seek"))`. `paintMedia` needs `t`, so pass it from the `renderAt` call site.
  - Removing a tile, in either `paintMedia` or `clearMedia`, calls `releaseVideo` on any video inside it.
  - `BeatStage`: accept `clipModeRef` and pass it to `CinematicSlide`.
  - `DeckStage`'s `Stage`: pass `clipModeRef` through. It is a stable ref, so `memo` is unaffected.
- [ ] **Step 4: Run** the focused tests, `npm test` and tsc, then `npm run test:e2e -- e2e/play.spec.ts e2e/beatstage.spec.ts --project=default`.
- [ ] **Step 5: Commit.** Message: `feat(engine): media tiles play deck-time clips and uploaded images`.

---

### Task 9: Render waits for clip seeks; clip determinism and clip e2e

**Files:**
- Modify: `components/player/RenderStage.tsx`, `lib/render/run.ts` (only if the warning text needs "media" instead of "image"), `e2e/render-page.spec.ts`, `e2e/render-cli.spec.ts`, `e2e/play.spec.ts`
- Test: `tests/unit/render-stage.test.tsx` (add case)

- [ ] **Step 1: Failing unit test.** In `render-stage.test.tsx`, mock `@/engine/components/video-sync`'s `pendingVideoSeeks` to return a promise controlled by the test. `renderFrame(1)` must not resolve until that promise resolves. Its resolved srcs appear in `result.failed`, alongside image failures and de-duplicated with them.
- [ ] **Step 2: Implement.** In `renderFrame`, after `flushSync(() => apply(T))` and the `nextFrame()`, call `const videoFailed = await pendingVideoSeeks(); videoFailed.forEach(fail)`. This runs before the image decodes. The CLI's warning text currently says "image failed to decode". Make it "media failed to decode", and update the matching unit test in `render-run.test.ts`.
- [ ] **Step 3: e2e.** Upload the fixtures via `request.post(\`/api/decks/${id}/media\`, { multipart: { file: { name, mimeType, buffer: readFileSync(...) } } })`, using the pattern from `e2e/render-cli.spec.ts`.
  - **`render-page.spec.ts`, "clips are deterministic":**
    - The deck: beat a is art `media:<h264 id>` (crossfade) with `clips: { [ref]: { in: 0.5 } }`, then wait 2 s. Beat b crossfades to `media:<vp9 id>`, plus a tile with `src: media:<h264 id>` and `clip: { loop: true }`, then wait 3 s.
    - Compare the step-reached and jump-reached screenshots, and the DOM (`video.currentTime` rounded to 3 dp per `data-asset`/tile), at:
      - T=1.2 (mid beat a);
      - T=2.3 (mid crossfade between the clips);
      - T=4.6 (the tile loop has wrapped: the h264 clip is 2 s long, and the tile appeared at about 2);
      - a backward jump from 4.6 to 1.2.
    - Also assert the art video's `currentTime` at T=1.2 ≈ 0.5 + 1.2 within 1e-3, and that the tile's time at 4.6 is less than 2, which proves it wrapped.
  - **`render-cli.spec.ts`, "renders a clip":**
    - A 2 s deck whose art is the h264 clip. Render at 10 fps and 320×180, and check with ffprobe that there is one h264 stream.
    - Then extract frames 5 and 15 with `ffmpeg -ss <t> -frames:v 1 -f image2pipe -vcodec png -`, run with `spawnSync` and its stdout taken as the buffer. The two PNG buffers must differ, which proves the clip advances.
    - This test runs only where ffmpeg exists, with the same guard as the existing test.
  - **`play.spec.ts`, "clip follows the deck clock":**
    - A deck with clip art. Open `/play?deck=…&t=1`. The art video's `currentTime` should be within 0.15 of 1, after waiting for `readyState >= 2`.
    - Press play, wait about 1 s, and `currentTime` should have advanced by more than 0.5.
    - Scrub back to 0.3 via the existing scrub helper, and `currentTime` should be within 0.15 of 0.3.
  - **Review Focus #3:** a deck that references `media:0000000000000000.mp4`, which is not uploaded. `/render` `renderFrame(0.5)` resolves within 10 s, and `failed` contains that media URL.
- [ ] **Step 4: Run** the unit tests, `npm test` and tsc, then `npm run test:e2e -- e2e/render-page.spec.ts e2e/render-cli.spec.ts e2e/play.spec.ts --project=default`. Run `--repeat-each=3` once on render-page. If the byte equality is flaky, report it with evidence. Do not loosen it.
- [ ] **Step 5: Commit.** Message: `feat(render): renderFrame waits for clip seeks; clip determinism and render e2e`.

---

### Task 10: Lint + MCP for media refs

**Files:** Modify `lib/editor/lint.ts`, `app/editor/page.tsx` (pass `media`), `lib/editor/use-lint.ts` (memo deps), `lib/mcp/tool-handlers.ts`, `lib/mcp/tool-defs.ts`; Create `lib/editor/media-refs.ts`; Test `tests/unit/lint-media.test.ts`, `tests/unit/media-refs.test.ts`, `tests/unit/mcp-tool-handlers.test.ts` (add case).

**Interfaces — Produces:**
```ts
// lib/editor/media-refs.ts (pure)
export interface MediaRefUse { ref: MediaRef; sceneIdx: number; beatIdx: number; actionIdx?: number; where: "art" | "tile" | "clip-opts" }
export function findMediaRefs(doc: DeckDoc): MediaRefUse[];        // beat.art (to/keep/out/clips keys), art actions, media action src
// lint.ts
export interface LintContext { mediaIds?: string[]; soundtrackSec?: number; media?: MediaInfo[] }
```

- [ ] **Step 1: Failing tests.**
  - `findMediaRefs` finds refs in:
    - beat `art.to` (string and array), `keep`, `out` and `clips` keys;
    - mid-beat `art` actions, with `actionIdx`;
    - media action `src`.
  - It ignores panel keys and plain URLs.
  - Lint with `ctx.media = [{ id: "a.mp4", mime: "video/mp4", durationSec: 2, … }, { id: "s.mp3", mime: "audio/mpeg", … }]`:
    - a ref to `media:zzz.mp4` → `media-missing` (warning, `at` the beat/action);
    - `art.to: "media:s.mp3"` → `media-kind`;
    - `clips: { "media:a.mp4": { in: 2 } }` → `clip-in-past-end`; with `in: 1.5` → nothing;
    - a media tile `clip: { in: 3 }` on `media:a.mp4` → `clip-in-past-end`;
    - with no `ctx.media`, none of these rules fire.
  - MCP: `list_media` entries include `kind` (`"video"` / `"image"` / `"audio"`) and `durationSec` when stored.
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.**
  - Write `findMediaRefs`.
  - Add `mediaWarnings(doc, ctx)` to `lint.ts`, called next to `soundtrackWarnings` and on the same structurally-clean path. Messages:
    - `media "<id>" is not in this deck's media — upload it again`;
    - `media "<id>" is <kind> — art and tiles take images or video`;
    - `clip in-point <in>s is at or past the clip's end (<dur>s)`.
  - Editor page: pass `media: deckMedia.media ?? undefined`, and add it to the `use-lint` memo deps.
  - MCP `list_media`: map to `{ ...m, kind: mediaKind(m.mime) }`.
  - `tool-defs`: in the `list_media` description, add that uploads happen in the editor or via `POST /api/decks/<id>/media` (multipart `file`, optional `durationSec`), and that `media:<id>` refs work as art `to`/`keep`/`out` and as media tile `src`, with clip options `art.clips[ref]` / `clip`.
  - Find where art/media action shapes are documented in tool-defs (grep `"art"`) and add the same note there.
- [ ] **Step 4: Run** the tests, `npm test` and tsc.
- [ ] **Step 5: Commit.** Message: `feat(editor): lint and MCP understand media refs and clips`.

---

### Task 11: Media library in Deck settings

**Files:** Create `components/editor/MediaLibrary.tsx`, `lib/editor/media-duration.ts`; Modify `components/editor/DeckSettings.tsx`, `lib/api/media-client.ts` (`uploadMedia` takes an optional `durationSec`; add `deleteMedia` if it doesn't exist; grep first), `components/editor/SoundtrackSettings.tsx` (filter to audio only, if it doesn't already); Test `tests/unit/media-library.test.tsx`.

**Interfaces — Produces:**
```ts
// lib/editor/media-duration.ts (client)
export function readMediaDuration(file: File): Promise<number | undefined>;   // <video>/<audio> loadedmetadata → duration; undefined for images or on error/timeout (5 s)
// lib/api/media-client.ts
export async function uploadMedia(deckId: string, file: File, durationSec?: number): Promise<MediaInfo>;
```

- [ ] **Step 1: Failing tests** (React Testing Library). Mock `media-client`, and wrap in `DeckMediaContext` with a fake `refresh`.
  - The grid renders:
    - an image item with an `<img>` thumbnail;
    - a video item with a `<video preload="metadata" muted>` and its duration as `0:02`, using `formatClock` from `lib/timing/clock-format`;
    - an audio item as a row.
  - Each item shows its name and size, and has a "Copy ref" button that writes `media:<id>` to `navigator.clipboard.writeText` (stubbed).
  - Uploading two files calls `uploadMedia` for each, with `durationSec` from a mocked `readMediaDuration`, then `refresh()`.
  - A failed upload shows the server's error message inline next to that file's name; use the exact HEVC message from Global Constraints.
  - Deleting an unreferenced item calls `deleteMedia` without confirming. Deleting an item referenced by the doc (from the editor store; see how `DeckSettings` reads `doc`) opens a confirmation that lists the referencing beats (scene id / beat id from `findMediaRefs`). Cancel → no delete.
  - The soundtrack picker lists only audio items.
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.**
  - Follow `SoundtrackSettings.tsx`'s structure and styling (CSS vars `--ed-*`).
  - Drag-drop: `onDragOver` preventDefault, `onDrop` → `e.dataTransfer.files`.
  - The file `<input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/*">` is labelled "Upload media".
  - Add `data-testid`s: `media-library`, `media-item-<id>`, `media-upload`, `media-error`, `media-delete-<id>`, `media-copy-<id>`.
- [ ] **Step 4: Run** the tests, `npm test` and tsc, then `npm run test:e2e -- e2e/deck-settings.spec.ts e2e/soundtrack.spec.ts --project=default`.
- [ ] **Step 5: Commit.** Message: `feat(editor): media library — upload, browse, copy ref, delete with reference check`.

---

### Task 12: Asset picker for art and media tiles (+ clip options) and the library e2e

**Files:** Create `components/editor/AssetPicker.tsx`, `e2e/media-library.spec.ts`; Modify `lib/editor/registry.ts` (`FieldType` + specs), `components/editor/Field.tsx`, `components/editor/Inspector.tsx`; Test `tests/unit/asset-picker.test.tsx`.

**Interfaces — Produces:**
```ts
// registry.ts
export type FieldType = "text" | "textarea" | "number" | "select" | "range" | "checkbox" | "objectRef" | "asset";
export interface Field { /* existing */ multiple?: boolean; accept?: ("panel" | "overlay" | "image" | "video")[]; clipKey?: string }
// art: { key: "art.to", label: "Panel(s)", type: "asset", multiple: true, accept: ["panel","overlay","image","video"], clipKey: "art.clips" }
// media: { key: "src", label: "Source", type: "asset", accept: ["image","video"], clipKey: "clip" }
// components/editor/AssetPicker.tsx
export function AssetPicker(props: { value: string | string[] | undefined; multiple?: boolean; accept: Field["accept"]; clips?: unknown; onChange(v: string | string[]): void; onClipsChange?(v: unknown): void }): JSX.Element;
```
Clip value shapes:
- For art (`clipKey: "art.clips"`), the value is a `Record<MediaRef, ClipOpts>`.
- For a tile (`clipKey: "clip"`), it is a single `ClipOpts`.
- `AssetPicker` knows which shape applies from `multiple`: art is multiple; a tile is single.

- [ ] **Step 1: Failing tests.** Wrap in `DeckMediaContext` with an image, a video and an audio item.
  - Opening the picker lists:
    - the built-in `PANELS` (`1.01` …) and `MusicScore` under "Built-in", when `accept` includes panel/overlay;
    - uploads under "This deck" as image and video only; audio is never listed.
  - Choosing items in multiple mode appends them in order. Removing a chip removes it, and the up/down buttons reorder.
  - `onChange` gets a string when there is one item and an array otherwise, which keeps today's `to` shape.
  - Single mode (tile) replaces the value. Free text entry (a URL, or a key typed by hand) still calls `onChange` on blur/Enter.
  - When a selected item is a video ref, clip controls appear:
    - In-point (number, s, min 0, step 0.1) and Loop (checkbox).
    - Editing them calls `onClipsChange`: art → `{ [ref]: { in: 1.5 } }`, merged and leaving other refs alone; tile → `{ in: 1.5 }`.
    - Clearing both removes that ref's entry: `{}` → for art, the key is deleted; for a tile, `undefined`.
  - `Field` with `type: "asset"` renders `AssetPicker`.
  - Inspector passes `clips={getPath(action, spec.clipKey)}` and `onClipsChange={(v) => updateAction(selected, selectedAction, spec.clipKey, v)}`.
- [ ] **Step 2: Run, and expect FAIL.**
- [ ] **Step 3: Implement.**
  - Build it as a popover, styled like the existing editor popovers; grep for an existing popover or menu component and reuse it. Chips show the thumbnail and the label (panel key, or the media name from `DeckMediaContext`).
  - `Field`: add an `extra?: { clips?: unknown; onClipsChange?(v: unknown): void }` prop.
  - Inspector: pass `extra` for asset fields.
  - Beat-level entry art: if the Inspector edits `beat.art.to` anywhere (grep `"art.to"` / `beat.art`), give it the same picker.
- [ ] **Step 4: e2e** `e2e/media-library.spec.ts` against the default project:
  - Create a deck through the API with one cinematic beat and open it in the editor (copy the setup from `e2e/deck-settings.spec.ts`).
  - Open Deck settings and upload `still.png` and `clip-h264.mp4` through `setInputFiles` on `media-upload`. Both items appear.
  - Upload `clip-hevc.mp4`. `media-error` contains `unsupported video codec (hvc1)` and `convert with: ffmpeg -i 'clip-hevc.mp4' -c:v libx264`.
  - Add an Art action through the existing timeline UI; copy the pattern from `e2e/timeline-actions.spec.ts`.
  - In the picker, choose the clip, and set In-point 0.5.
  - The editor canvas shows a `video.artstage__layer`. Within 5 s its `currentTime` is ≈ 0.5, because the editor shows the in-point frame.
  - Reload: the saved doc has `art.clips["media:<id>"].in === 0.5`.
- [ ] **Step 5: Run** the unit tests, `npm test` and tsc, then `npm run test:e2e -- e2e/media-library.spec.ts e2e/inspector.spec.ts e2e/timeline-actions.spec.ts --project=default`.
- [ ] **Step 6: Commit.** Message: `feat(editor): asset picker with uploads + clip in-point/loop; media library e2e`.

---

### Task 13: Docs

**Files:** Modify `README.md`, `docs/superpowers/specs/2026-10-23-video-clips-design.md` (status line).

- [ ] **Step 1: README.** Add a "Images and video clips" section after the soundtrack / timed-deck material. Read the README to find that spot. It covers:
  - accepted formats, and that HEVC and other codecs are rejected with the ffmpeg fix;
  - `media:<id>` refs in art and tiles;
  - in-point and loop, and hold-last-frame;
  - clips are muted, with game audio going into the soundtrack mix;
  - the media library and picker;
  - that the editor canvas shows the in-point frame;
  - a render tip: re-encode long-GOP recordings with `-g 30` for faster renders (`ffmpeg -i in.mp4 -c:v libx264 -crf 18 -g 30 -pix_fmt yuv420p -an out.mp4`).
- [ ] **Step 2:** Set the spec status to `implemented (sub-project 4)`.
- [ ] **Step 3: Commit.** Message: `docs: images and video clips`.

---

## Self-review notes (plan author)

- **Spec coverage:**

  | Spec section | Covered by |
  |---|---|
  | §1 types, sniff, duration | T1 |
  | §1 ranges | T2 |
  | §2 refs and types | T3 |
  | §2 resolver | T5 |
  | §3 clip clock and since | T3–T4 |
  | §4 syncVideo | T6 |
  | §4 art | T7 |
  | §4 tiles | T8 |
  | §4 render | T9 |
  | §5 library | T11 |
  | §5 picker | T12 |
  | §5 MCP and lint | T10 |
  | §7 tests | across T1–T12 |
  | §8 GOP tip | T13 |

- **Review Focus coverage:**
  - #1 hold: T3 unit + T9 e2e (an `in` past the end, and a tile beyond its length).
  - #2 two uses at once: T8.
  - #3 deleted media: T9 + T10.
  - #4 backward scrub: T3, T8, T9.
  - #5 uppercase extensions: T1.
- **Deep-dive sync:** `docs/MM_MORGANA.md` is synced at closeout via mm-deepdive-sync.
