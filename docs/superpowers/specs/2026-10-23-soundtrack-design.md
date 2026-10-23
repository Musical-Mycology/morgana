# Soundtrack — Design Spec (Timed Video, sub-project 2 of 6)

**Status:** implemented (sub-project 2)
**Date:** 2026-10-23
**Builds on:** [Deck clock + timed Player (sub-project 1)](2026-10-22-deck-clock-timed-player-design.md) — PR #36
**Driving use case:** the Alt-Ctrl Festival 2027 storyboard — a 2:00 video cut to music
(1–2 s silence → *Deux Arabesques* → drop-beat Debussy → back to *Arabesques*)

---

## 0. Context

### 0.1 Decisions taken during brainstorming

- **One pre-mixed track.** The music is mixed in a DAW and arrives as a single file covering the
  whole video (silence, crossfades and the drop already baked in). Morgana plays it from deck
  `T = 0` locked to the deck clock. No clip arranging, trims, fades or gain inside Morgana.
- **Alignment aids: waveform + named cue markers.** The ruler and the Player scrubber draw the
  track's waveform; deck-time markers ("drop" @ 40.2 s) show as labelled ticks. Scene lengths stay
  numeric fields — no draggable/snapping boundaries.
- **Audio is the master clock while it plays** (Web Audio), not an `<audio>` element nudged to
  follow a timer.

### 0.2 Findings verified against the code

1. **Morgana has no media ingestion at all.** No upload route, no media library. `image` objects
   take a hand-typed `src` URL (`components/editor/object-content.tsx`, `lib/editor/object-registry.ts`).
   The built-in art set is a fixed list in `engine/deck/story-assets.ts` whose files are not in this
   repo's `public/`. So the soundtrack needs a store first — and the storyboard's own images and
   (sub-project 4) video need the same one. This spec builds it **generically**.
2. Decks live at `MORGANA_DATA_DIR/decks/<id>.deck.json` (`lib/store/deck-store.ts`);
   `deleteDeck` only unlinks that file.
3. The deck API (`app/api/decks/...`) is unauthenticated (self-hosted model); the MCP route has its
   own bearer auth. A hosted instance is gated at the proxy. Media routes follow the deck routes.
4. The Player (`components/player/TimedPlayer.tsx`) owns deck time `T` through one `apply(to)`
   writer and a single rAF loop; it opens paused, so the first Play is always a user gesture.
5. `TimeBar` (`components/timing/TimeBar.tsx`) is shared by the Player HUD and the editor
   `DeckRuler`.

---

## 1. Approach

**(chosen) Web Audio clock.** The track is fetched once and decoded to an `AudioBuffer`. While it
plays, deck time is read from the audio hardware clock:
`T = startT + (ctx.currentTime − ctxStartedAt)`. Seeking stops the current
`AudioBufferSourceNode` and starts a new one at the new offset. The same decode yields the waveform
peaks.

- Sync is exact; visuals follow the sound, which is also the export's reference direction.
- No HTTP Range support is needed (whole-file fetch).
- A 2-minute stereo 48 kHz track is ≈ 45 MB decoded — acceptable.

Rejected: an `<audio>` element corrected toward the timer (drift correction is audible; seeking
needs Range); a separate audio clock alongside the timer (two clocks — what §7 removed).

---

## 2. The deck media store

Generic, per-deck, filesystem-backed. Reused by images (later) and video (sub-project 4).

- **Layout:** `MORGANA_DATA_DIR/media/<deckId>/<mediaId>` where `mediaId` = first 16 hex chars of
  the SHA-256 of the file contents + `.` + a sanitised lowercase extension (e.g.
  `3f9a…c1.mp3`). Same bytes → same id → stored once (idempotent re-upload). A JSON sidecar
  `<mediaId>.json` records `{ id, name, mime, bytes, uploadedAt }` (`name` = original filename,
  for display only).
- **Module:** `lib/store/media-store.ts` — `saveMedia(deckId, file: { name, bytes: Uint8Array,
  mime })`, `listMedia(deckId)`, `readMedia(deckId, mediaId)`, `deleteMedia(deckId, mediaId)`,
  `deleteDeckMedia(deckId)`. Every id is validated against
  `/^[0-9a-f]{16}\.[a-z0-9]{1,5}$/` and every resolved path is checked to stay inside the deck's
  media directory (no traversal).
- **Allowlist (this sub-project: audio only):** `mp3` (`audio/mpeg`), `m4a`/`aac` (`audio/mp4`,
  `audio/aac`), `wav` (`audio/wav`, `audio/x-wav`), `ogg` (`audio/ogg`), `flac` (`audio/flac`).
  The extension must be on the list; the served `Content-Type` comes from the extension, never from
  the client.
- **Size cap:** `MORGANA_MEDIA_MAX_MB` env, default `200`. Over-cap → 413.
- **Routes:**
  - `POST /api/decks/<id>/media` — multipart `file` field → `201 { id, name, mime, bytes }`;
    400 unsupported type, 404 unknown deck, 413 too large.
  - `GET /api/decks/<id>/media` → `{ media: MediaInfo[] }`.
  - `GET /api/decks/<id>/media/<mediaId>` → the bytes, `Content-Type` from the extension,
    `Cache-Control: private, max-age=31536000, immutable` (ids are content hashes).
  - `DELETE /api/decks/<id>/media/<mediaId>` → 204.
- **Deck deletion** also deletes `media/<deckId>/` (`deleteDeck` → `deleteDeckMedia`).
- **Client:** `lib/api/media-client.ts` (`uploadMedia`, `listMedia`, `mediaUrl`) — every URL via
  `withBasePath()`.

Deck JSON stays a pure reference (`media` id); the deck + its media folder are the portable unit.

---

## 3. Data model

Optional fields under `version: 1` — no bump, no migration
([policy](deck-format-version-policy.md)).

```ts
// engine/deck-doc.ts — DeckMeta
soundtrack?: { media: string };                          // media id; plays from deck T = 0
markers?: { id: string; label: string; t: number }[];    // deck-time cue points
```

Validation (`validateDeckDoc`): `soundtrack.media` matches the media-id pattern; each marker has a
non-empty `id` (unique within the list), a non-empty `label` (≤ 40 chars), and a finite `t ≥ 0`.
Messages are prefixed `meta.soundtrack…` / `meta.markers[i]…`.

No offset / gain / fade fields (mixing happens in the DAW; trivially additive later).

### Lint (warnings)

| Rule | Fires when |
| --- | --- |
| `soundtrack-missing` | `meta.soundtrack.media` is not in the deck's media list |
| `soundtrack-length` | track duration and deck total differ by more than 0.5 s — "track is 2:03, deck is 1:58 — video would play 5 s of music past the last frame" (or "…end 4 s early in silence") |
| `marker-out-of-range` | a marker's `t` exceeds the deck total |

`soundtrack-missing` and `soundtrack-length` need data the pure `lintDeck(doc)` doesn't have, so
`lintDeck` gains an optional second argument `ctx?: { mediaIds?: string[]; soundtrackSec?: number }`
supplied by the editor's `useLint` (from `listMedia` and the decoded duration); without it those two
rules are skipped.

---

## 4. Playback

### 4.1 Soundtrack module — `lib/audio/soundtrack.ts` (browser-only)

```ts
export interface Soundtrack {
  readonly duration: number;          // seconds
  readonly peaks: Float32Array;       // ~2000 buckets, max |sample| per bucket, 0–1
  play(fromT: number): void;          // start at deck time fromT (no-op past duration)
  pause(): void;
  now(): number | null;               // deck time from the audio clock; null when not playing
  setMuted(muted: boolean): void;
  dispose(): void;
}
export function loadSoundtrack(url: string, ctx?: AudioContext): Promise<Soundtrack>;
export function computePeaks(buffer: AudioBuffer, buckets: number): Float32Array; // pure, exported for tests
```

- One shared `AudioContext` per page, created lazily; `play()` calls `ctx.resume()` (autoplay
  policy: the Player's first Play is a user gesture).
- `play(fromT)` stops any current source, starts a new `AudioBufferSourceNode` at offset
  `fromT` through a `GainNode` (mute = gain 0), and records `ctxStartedAt = ctx.currentTime`,
  `startT = fromT`. `now()` returns `startT + (ctx.currentTime − ctxStartedAt)` while playing, and
  `null` once paused or past `duration`.

### 4.2 Player integration (`/play`)

- On load, if `meta.soundtrack` is set: fetch + decode; HUD shows "loading audio…" until ready.
  Play is allowed during loading (it runs on the timer and the track joins in at the current `T`
  when ready).
- **Clock source:** while playing, each frame takes `T = soundtrack.now()` when it is non-null;
  otherwise the existing timer advances `T` (before load, past the track's end, or with no
  soundtrack). One writer (`apply`) is unchanged.
- **Transport mapping:** play → `soundtrack.play(T)`; pause → `soundtrack.pause()`. Arrows, Home
  and Play-at-the-end (restart from 0) seek while playing and restart the audio at the new `T`
  (`soundtrack.play(newT)`). The scrubber and a marker click pause first (the audio stops with
  them), then jump; playback resumes from the new `T` on Play. Seeks while paused are silent.
- **Mute:** `M` key + HUD button (preview only; never affects export).
- **Failure:** decode/fetch error → HUD notice "Soundtrack unavailable — playing silent"; playback
  continues on the timer.
- The editor canvas stays silent (single-beat preview via `seek.ts`); listening happens in the
  Player, one click away via "Play from here".

### 4.3 Waveform + markers on `TimeBar`

New optional props: `peaks?: Float32Array` and `markers?: { id; label; t }[]` plus
`onMarkerClick?: (t) => void`.
- Peaks render as a single SVG path behind the scene segments, mapped onto the same time scale
  (`timeBarScale`), covering `[0, duration]`.
- Markers render as ticks (`data-testid="timebar-marker"`, `title=label`) with a short label;
  clicking one calls `onMarkerClick(t)` (scrubs there) instead of a plain scrub.

---

## 5. Editor

- **Deck settings → Soundtrack** (`components/editor/SoundtrackSettings.tsx`):
  - "Upload audio…" (`<input type=file accept="audio/*">`) → `uploadMedia` → `updateMeta("soundtrack",
    { media: id })`. Upload progress/error shown inline.
  - When set: file name, duration (from decode), "Replace" (same upload flow), "Remove" (sets
    `soundtrack` to `undefined`; the file stays on disk so Undo works).
- **Markers:**
  - "+ Marker" on the deck ruler adds `{ id: newId, label: "marker N", t: <ruler T> }`; rename it in
    Deck settings.
  - Deck settings lists markers sorted by `t`: label and time (`m:ss.s`) editable, delete button.
  - Marker edits are undoable store commits (no-op edits record no history — same rule as
    sub-project 1's timing inputs).
- **Ruler:** `DeckRuler` passes peaks (decoded once per soundtrack media id, cached for the page)
  and markers to `TimeBar`; marker click jumps the editor to that time like a scrub.

---

## 6. MCP

- `list_media(deck_id)` — read-only `{ media: [{ id, name, mime, bytes }] }`.
- `set_soundtrack(deck_id, media_id | null)` — sets/clears `meta.soundtrack`; rejects an id not in
  the deck's media list. Description: uploads happen in the editor (binary isn't sent over MCP); the
  track plays from deck 0:00 and should match the deck's total length.
- `set_markers(deck_id, markers[])` — replaces the whole list (validated as §3). Description
  explains markers are deck-time cue points shown on the ruler and Player scrubber.

---

## 7. Export contract (consumed by sub-project 3)

The MP4 render muxes the **original** `meta.soundtrack` file from the deck's media folder, starting
at deck `T = 0`, trimmed or padded with silence to the deck total. Markers are not rendered. This
sub-project only guarantees the original bytes are stored unchanged and addressable by id.

---

## 8. Testing

- **Unit — media store:** save → list → read round-trip; content-hash id + dedupe; extension
  allowlist (`.exe`, no extension, `.MP3` normalised); traversal ids rejected (`../x`,
  `..%2f`, absolute); size cap via env; `deleteDeck` removes the media folder.
- **Unit — routes:** POST 201/400/404/413, GET list, GET bytes + content-type + cache header,
  DELETE 204, unknown id 404.
- **Unit — soundtrack module:** `computePeaks` on a synthetic buffer; clock math against a fake
  `AudioContext` (`now()` advances with `currentTime`, `null` after `pause()` and past
  `duration`, `play(fromT)` restarts the offset); mute sets gain 0.
- **Unit — Player:** clock source switches to `soundtrack.now()` while playing and back to the
  timer past the end; seek-while-playing calls `play(newT)`; decode failure shows the notice and
  keeps playing silently.
- **Unit — TimeBar:** waveform path present when `peaks` given; marker ticks + click callback.
- **Unit — lint + validation + MCP tools** as §3/§6.
- **E2E:** the test generates a 3-second sine WAV in memory, uploads it to a throwaway deck, sets
  the soundtrack, opens `/play`, asserts the waveform renders and that Play advances the clock.
  Headless Chromium needs `--autoplay-policy=no-user-gesture-required` (Playwright `launchOptions`);
  plan Task 1 verifies Web Audio runs under the e2e config before anything builds on it.

---

## 9. Out of scope

Multi-clip arranging, trims, fades, gain; scrub audio while paused; audio in the editor canvas;
a cross-deck shared media library and orphan-media cleanup; image/video upload UI (the store is
generic, the UI here is audio-only); uploads over MCP; rendering markers into the video.

## 10. Risks

- **Upload size through Next route handlers.** Verify `request.formData()` handles a 200 MB body
  in the standalone server without a framework body limit; if not, stream the body to disk.
- **Decode support differs by browser** (e.g. older Safari and Ogg/Vorbis). The upload accepts the
  allowlist; the Player's failure path covers an undecodable file. Recommend MP3/M4A/WAV in the UI hint.
- **Memory** for very long tracks (decoded PCM). Fine for minutes-long tracks; documented.
