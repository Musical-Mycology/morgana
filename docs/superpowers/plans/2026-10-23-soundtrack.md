# Soundtrack + Deck Media Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a timed deck carry one pre-mixed soundtrack — uploaded into a new per-deck media store, played in the `/play` Player with the audio as master clock, drawn as a waveform with named cue markers on the Player scrubber and editor ruler.

**Architecture:** A filesystem media store (`lib/store/media-store.ts`) behind `/api/decks/<id>/media` routes holds content-hashed files per deck. A browser-only Web Audio module (`lib/audio/soundtrack.ts`) decodes the track once and exposes an audio-clock `now()`; the Player reads `T` from it while playing and falls back to its timer otherwise. `TimeBar` learns to draw peaks and markers; the editor gains Soundtrack + Markers settings.

**Tech Stack:** Next.js 15 route handlers (Node runtime), Web Audio API, React 19, Zustand, Vitest (jsdom + node), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-23-soundtrack-design.md` — read it before starting any task. Builds on sub-project 1 (`docs/superpowers/specs/2026-10-22-deck-clock-timed-player-design.md`).

## Global Constraints

- New deck fields are **optional under `version: 1`** — no version bump, no migration.
- Media ids match exactly `/^[0-9a-f]{16}\.[a-z0-9]{1,5}$/` (first 16 hex of SHA-256 of the bytes + `.` + lowercase extension).
- Audio allowlist (extension → served Content-Type): `mp3 → audio/mpeg`, `m4a → audio/mp4`, `aac → audio/aac`, `wav → audio/wav`, `ogg → audio/ogg`, `flac → audio/flac`. Content-Type always comes from the extension, never the client.
- Size cap: env `MORGANA_MEDIA_MAX_MB`, default `200`.
- Media files live at `MORGANA_DATA_DIR/media/<deckId>/<mediaId>` with a sidecar `<mediaId>.json`.
- Every hand-built URL goes through `withBasePath()` (`lib/base-path.ts`); `tests/unit/base-path-callsites.test.ts` must stay green.
- The Player's `apply(to)` stays the ONLY writer of deck time `T` (one clock).
- New lint rules are **warnings** (an error means "the server rejects this save").
- MCP tool descriptions are the only contract a remote model reads — describe semantics fully.
- Pure modules (`engine/authoring/deck-clock.ts`, `lib/timing/clock-format.ts`, …) stay DOM-free; `lib/audio/soundtrack.ts` is browser-only and must NOT be imported by a pure module.
- Unit: `npx vitest run <file>`; full `npm test` (baseline at branch start: 118 files / 659 tests). E2E: `export LD_LIBRARY_PATH=/tmp/claude-1000/-home-chris-oltyan-projects-morgana--claude-worktrees-morgana-time-animation-78c764/7e066baf-f84a-45f2-ae64-4ba1724b162c/scratchpad/libs/usr/lib/x86_64-linux-gnu` then `npm run test:e2e -- e2e/<name>.spec.ts --project=default`. `library.spec.ts:46` fails with `EXDEV` in this WSL env and on `main` — known, leave it.

## Review Focus

1. **A crafted media id in the URL** (`..%2F..%2Fdecks%2Fx.deck.json`, `../x`, an absolute path) → 404 and no file outside `media/<deckId>/` is read (Task 3 test).
2. **The soundtrack's file is missing** (deleted, or a deck copied without its media folder) → the Player shows "Soundtrack unavailable — playing silent" and keeps playing on its timer; the editor lints `soundtrack-missing`; nothing throws (Tasks 5, 8 tests).
3. **Seeking while playing** (arrows, Home, scrubber, marker click) restarts the audio at the new `T`, so sound and picture stay together (Task 8 test).
4. **Track shorter than the deck**: past the track's end the clock keeps running on the timer to the deck's end (Task 8 test).
5. **Uploading the same file twice / Replace with the same file** keeps one stored copy and one id (Task 2 test).

---

### Task 1: Web Audio soundtrack module + headless-audio gate

**Files:**
- Create: `lib/audio/soundtrack.ts`
- Create: `app/dev/audioclock/page.tsx`
- Create: `e2e/audio-clock.spec.ts`
- Modify: `playwright.config.ts` (add `launchOptions` to the shared `use`)
- Test: `tests/unit/soundtrack.test.ts`

**Interfaces:**
- Produces (exact):

```ts
export interface Soundtrack {
  readonly duration: number;
  readonly peaks: Float32Array;     // PEAK_BUCKETS values, 0–1
  play(fromT: number): void;
  pause(): void;
  now(): number | null;
  setMuted(muted: boolean): void;
  dispose(): void;
}
export const PEAK_BUCKETS = 2000;
export function computePeaks(buffer: AudioBuffer, buckets: number): Float32Array;
export function createSoundtrack(buffer: AudioBuffer, ctx: AudioContext): Soundtrack;
export function loadSoundtrack(url: string, ctx?: AudioContext): Promise<Soundtrack>;
```

- [ ] **Step 1: Write the failing unit test** — `tests/unit/soundtrack.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import { computePeaks, createSoundtrack, PEAK_BUCKETS } from "@/lib/audio/soundtrack";

function fakeBuffer(samples: number[], sampleRate = 10): AudioBuffer {
  const data = Float32Array.from(samples);
  return { duration: samples.length / sampleRate, length: samples.length, numberOfChannels: 1, sampleRate,
    getChannelData: () => data } as unknown as AudioBuffer;
}
function fakeCtx() {
  const sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: unknown }[] = [];
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const ctx = {
    currentTime: 100, destination: {}, resume: vi.fn(() => Promise.resolve()),
    createGain: () => gain,
    createBufferSource: () => {
      const s = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as unknown };
      sources.push(s); return s;
    },
  };
  return { ctx: ctx as unknown as AudioContext & { currentTime: number }, sources, gain };
}

test("computePeaks takes the max |sample| per bucket across channels, clamped to 1", () => {
  const p = computePeaks(fakeBuffer([0, 0.5, -0.9, 0.1, 2, 0]), 3);
  expect(Array.from(p)).toEqual([0.5, 0.9, 1]);
  expect(computePeaks(fakeBuffer([]), 4)).toEqual(new Float32Array(4));
});

test("now() follows the audio clock from the play offset, null when paused or past the end", () => {
  const { ctx, sources } = fakeCtx();
  const st = createSoundtrack(fakeBuffer(new Array(50).fill(0)), ctx); // 5 s
  expect(st.duration).toBe(5);
  expect(st.peaks.length).toBe(PEAK_BUCKETS);
  expect(st.now()).toBeNull();
  st.play(2);
  expect(sources[0].start).toHaveBeenCalledWith(0, 2);
  expect(st.now()).toBeCloseTo(2);
  (ctx as { currentTime: number }).currentTime += 1.5;
  expect(st.now()).toBeCloseTo(3.5);
  (ctx as { currentTime: number }).currentTime += 2;
  expect(st.now()).toBeNull(); // 5.5 ≥ duration
  st.play(1);                  // restart: old source stopped, new one at offset 1
  expect(sources[1].stop).not.toHaveBeenCalled();
  expect(sources[1].start).toHaveBeenCalledWith(0, 1);
  st.pause();
  expect(sources[1].stop).toHaveBeenCalled();
  expect(st.now()).toBeNull();
});

test("play past the duration does nothing; mute sets gain 0", () => {
  const { ctx, sources, gain } = fakeCtx();
  const st = createSoundtrack(fakeBuffer(new Array(20).fill(0)), ctx); // 2 s
  st.play(2);
  expect(sources).toHaveLength(0);
  st.setMuted(true);
  expect(gain.gain.value).toBe(0);
  st.setMuted(false);
  expect(gain.gain.value).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/soundtrack.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `lib/audio/soundtrack.ts`**

```ts
/** The deck soundtrack, played through Web Audio. Browser-only — never import from a pure module.
 *  While a track plays, the audio hardware clock IS the deck clock (spec §1): `now()` returns
 *  `startT + (ctx.currentTime − ctxStartedAt)`. Seeking = stop the source, start a new one. */
export interface Soundtrack {
  readonly duration: number;
  readonly peaks: Float32Array;
  play(fromT: number): void;
  pause(): void;
  now(): number | null;
  setMuted(muted: boolean): void;
  dispose(): void;
}

export const PEAK_BUCKETS = 2000;

let shared: AudioContext | null = null;
function sharedContext(): AudioContext {
  return (shared ??= new AudioContext());
}

/** Max |sample| per bucket across all channels, clamped to [0, 1]. Pure; exported for tests. */
export function computePeaks(buffer: AudioBuffer, buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  const len = buffer.length;
  if (len === 0) return out;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const per = len / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * per);
    const end = Math.max(start + 1, Math.min(len, Math.floor((b + 1) * per)));
    let max = 0;
    for (const ch of channels) {
      for (let i = start; i < end && i < len; i++) {
        const v = Math.abs(ch[i]);
        if (v > max) max = v;
      }
    }
    out[b] = Math.min(1, max);
  }
  return out;
}

export function createSoundtrack(buffer: AudioBuffer, ctx: AudioContext): Soundtrack {
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const peaks = computePeaks(buffer, PEAK_BUCKETS);
  let source: AudioBufferSourceNode | null = null;
  let startT = 0;
  let ctxStartedAt = 0;

  const stop = () => {
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch { /* already stopped */ }
    source.disconnect();
    source = null;
  };

  return {
    duration: buffer.duration,
    peaks,
    play(fromT) {
      stop();
      if (fromT >= buffer.duration) return;
      void ctx.resume?.();
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.connect(gain);
      startT = Math.max(0, fromT);
      ctxStartedAt = ctx.currentTime;
      s.start(0, startT);
      s.onended = () => { if (source === s) source = null; };
      source = s;
    },
    pause() { stop(); },
    now() {
      if (!source) return null;
      const t = startT + (ctx.currentTime - ctxStartedAt);
      return t >= buffer.duration ? null : t;
    },
    setMuted(muted) { gain.gain.value = muted ? 0 : 1; },
    dispose() { stop(); gain.disconnect(); },
  };
}

export async function loadSoundtrack(url: string, ctx: AudioContext = sharedContext()): Promise<Soundtrack> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`soundtrack fetch failed (${res.status})`);
  const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
  return createSoundtrack(buffer, ctx);
}
```

- [ ] **Step 4: Run** `npx vitest run tests/unit/soundtrack.test.ts` → PASS.

- [ ] **Step 5: Headless-audio gate page** — `app/dev/audioclock/page.tsx`:

```tsx
"use client";
import { useState } from "react";
import { createSoundtrack } from "@/lib/audio/soundtrack";

// Gate for the soundtrack sub-project (plan Task 1): does the Web Audio clock advance in the
// e2e browser? Builds a 3 s, 440 Hz buffer in-page (no upload), plays it, reports now() after 600 ms.
export default function Page() {
  const [result, setResult] = useState("idle");
  const run = () => {
    const ctx = new AudioContext();
    const rate = ctx.sampleRate;
    const buf = ctx.createBuffer(1, rate * 3, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / rate);
    const st = createSoundtrack(buf, ctx);
    st.play(0);
    setTimeout(() => { setResult(`now=${(st.now() ?? -1).toFixed(3)} state=${ctx.state}`); st.dispose(); }, 600);
  };
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <button data-testid="audio-run" onClick={run}>Run</button>
      <output data-testid="audio-now" style={{ marginLeft: 12 }}>{result}</output>
    </main>
  );
}
```

- [ ] **Step 6: Playwright launch flag** — in `playwright.config.ts`, add a top-level `use` (merged into every project) with:

```ts
  use: { launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } },
```

Keep the existing per-project `use: { baseURL }` entries unchanged (Playwright merges top-level and project `use`).

- [ ] **Step 7: Gate e2e** — `e2e/audio-clock.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

// Soundtrack plan Task 1 gate: the Web Audio clock must advance in the e2e browser, or every later
// audio e2e is meaningless.
test("the Web Audio clock advances in the e2e browser", async ({ page }) => {
  await page.goto("/dev/audioclock");
  await page.getByTestId("audio-run").click();
  const out = page.getByTestId("audio-now");
  await expect(out).toContainText("now=");
  const text = (await out.textContent())!;
  console.log(`[audio-clock] ${text}`);
  const now = Number(/now=(-?[\d.]+)/.exec(text)![1]);
  expect(now).toBeGreaterThan(0.2);
});
```

- [ ] **Step 8: Run the gate** — `npm run test:e2e -- e2e/audio-clock.spec.ts --project=default` (with `LD_LIBRARY_PATH` exported). Expected PASS with `now≈0.6`. **Record the printed line.** If `now` is ≤ 0.2 or the state is not `running`, try adding `--use-fake-ui-for-media-stream` and `--disable-features=AudioServiceOutOfProcess` to the args; if it still fails, STOP and report BLOCKED with the output — the Player's audio e2e cannot be built on this.

- [ ] **Step 9: Full unit suite + tsc, commit**

```bash
git add lib/audio/soundtrack.ts app/dev/audioclock/page.tsx e2e/audio-clock.spec.ts playwright.config.ts tests/unit/soundtrack.test.ts
git commit -m "feat(audio): Web Audio soundtrack clock + headless-audio gate"
```

---

### Task 2: The deck media store

**Files:**
- Create: `lib/store/media-store.ts`
- Modify: `lib/store/deck-store.ts` (export `dataDir`; `deleteDeck` also removes media)
- Test: `tests/unit/media-store.test.ts`

**Interfaces:**
- Produces (exact):

```ts
export const MEDIA_ID_RE: RegExp;                        // /^[0-9a-f]{16}\.[a-z0-9]{1,5}$/
export const AUDIO_TYPES: Record<string, string>;        // ext → mime (Global Constraints)
export interface MediaInfo { id: string; name: string; mime: string; bytes: number; uploadedAt: string }
export class MediaError extends Error { readonly status: 400 | 404 | 413 }
export function mediaMaxBytes(): number;
export function saveMedia(deckId: string, file: { name: string; bytes: Uint8Array }): Promise<MediaInfo>;
export function listMedia(deckId: string): Promise<MediaInfo[]>;          // sorted by uploadedAt then id
export function readMedia(deckId: string, mediaId: string): Promise<{ info: MediaInfo; bytes: Uint8Array }>;
export function deleteMedia(deckId: string, mediaId: string): Promise<void>;
export function deleteDeckMedia(deckId: string): Promise<void>;
```

- [ ] **Step 1: Write the failing test** — `tests/unit/media-store.test.ts`:

```ts
// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveMedia, listMedia, readMedia, deleteMedia, deleteDeckMedia, MediaError, MEDIA_ID_RE } from "@/lib/store/media-store";
import { createDeck, deleteDeck } from "@/lib/store/deck-store";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "morgana-")); process.env.MORGANA_DATA_DIR = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MORGANA_DATA_DIR; delete process.env.MORGANA_MEDIA_MAX_MB; });

const bytes = (s: string) => new TextEncoder().encode(s);

test("save → list → read round-trip with a content-hash id and extension-derived mime", async () => {
  const info = await saveMedia("d1", { name: "Mix Final.MP3", bytes: bytes("abc") });
  expect(info.id).toMatch(MEDIA_ID_RE);
  expect(info.id.endsWith(".mp3")).toBe(true);
  expect(info).toMatchObject({ name: "Mix Final.MP3", mime: "audio/mpeg", bytes: 3 });
  expect((await listMedia("d1")).map((m) => m.id)).toEqual([info.id]);
  const read = await readMedia("d1", info.id);
  expect(new TextDecoder().decode(read.bytes)).toBe("abc");
  expect(read.info.id).toBe(info.id);
});

test("the same bytes upload once (same id, one listing entry)", async () => {
  const a = await saveMedia("d1", { name: "a.wav", bytes: bytes("same") });
  const b = await saveMedia("d1", { name: "renamed.wav", bytes: bytes("same") });
  expect(b.id).toBe(a.id);
  expect(await listMedia("d1")).toHaveLength(1);
});

test.each(["virus.exe", "noext", "song.MP3X", ".mp3"])("rejects unsupported file %s with 400", async (name) => {
  await expect(saveMedia("d1", { name, bytes: bytes("x") })).rejects.toMatchObject({ status: 400 });
});

test("enforces the size cap from MORGANA_MEDIA_MAX_MB with 413", async () => {
  process.env.MORGANA_MEDIA_MAX_MB = "0.000001"; // ~1 byte
  await expect(saveMedia("d1", { name: "a.mp3", bytes: bytes("too big") })).rejects.toMatchObject({ status: 413 });
});

test.each(["../x", "..%2Fx", "/etc/passwd", "0123456789abcdef.mp3/../../x", "UPPERCASE0000000.mp3"])(
  "rejects crafted media id %s with 404 and reads nothing", async (id) => {
    mkdirSync(join(dir, "decks"), { recursive: true });
    writeFileSync(join(dir, "decks", "x.deck.json"), "secret");
    await expect(readMedia("d1", id)).rejects.toBeInstanceOf(MediaError);
    await expect(readMedia("d1", id)).rejects.toMatchObject({ status: 404 });
  });

test("rejects an invalid deck id", async () => {
  await expect(saveMedia("../evil", { name: "a.mp3", bytes: bytes("x") })).rejects.toMatchObject({ status: 404 });
});

test("delete removes the file and its sidecar; listing an empty deck is []", async () => {
  const info = await saveMedia("d1", { name: "a.ogg", bytes: bytes("x") });
  await deleteMedia("d1", info.id);
  expect(await listMedia("d1")).toEqual([]);
  expect(await listMedia("nothing-here")).toEqual([]);
  await expect(readMedia("d1", info.id)).rejects.toMatchObject({ status: 404 });
});

test("deleting a deck deletes its media folder", async () => {
  await createDeck({ id: "d2", title: "D2" });
  await saveMedia("d2", { name: "a.flac", bytes: bytes("x") });
  expect(existsSync(join(dir, "media", "d2"))).toBe(true);
  await deleteDeck("d2");
  expect(existsSync(join(dir, "media", "d2"))).toBe(false);
  await deleteDeckMedia("never-had-media"); // no throw
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/media-store.test.ts` → FAIL.

- [ ] **Step 3: Export `dataDir` from deck-store** — in `lib/store/deck-store.ts` change `const dataDir = () => …` to `export const dataDir = () => …` (same body).

- [ ] **Step 4: Implement `lib/store/media-store.ts`**

```ts
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, unlink, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { DECK_ID_RE } from "@/engine/deck-doc";
import { dataDir } from "./deck-store";

/** Per-deck, content-addressed media (spec §2). Generic: audio today, images/video later. */
export const MEDIA_ID_RE = /^[0-9a-f]{16}\.[a-z0-9]{1,5}$/;
export const AUDIO_TYPES: Record<string, string> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac",
};

export interface MediaInfo { id: string; name: string; mime: string; bytes: number; uploadedAt: string }

export class MediaError extends Error {
  constructor(readonly status: 400 | 404 | 413, message: string) { super(message); }
}

export function mediaMaxBytes(): number {
  const mb = Number(process.env.MORGANA_MEDIA_MAX_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 200) * 1024 * 1024;
}

function deckMediaDir(deckId: string): string {
  if (typeof deckId !== "string" || !DECK_ID_RE.test(deckId)) throw new MediaError(404, `unknown deck: ${deckId}`);
  return join(dataDir(), "media", deckId);
}

/** The on-disk path for a media id, or a 404 — never a path outside the deck's media folder. */
function mediaPath(deckId: string, mediaId: string): string {
  if (typeof mediaId !== "string" || !MEDIA_ID_RE.test(mediaId)) throw new MediaError(404, "unknown media");
  const dir = resolve(deckMediaDir(deckId));
  const p = resolve(dir, mediaId);
  if (!p.startsWith(dir + sep)) throw new MediaError(404, "unknown media");
  return p;
}

function extOf(name: string): string | null {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  return m && m.index > 0 ? m[1].toLowerCase() : null;
}

export async function saveMedia(deckId: string, file: { name: string; bytes: Uint8Array }): Promise<MediaInfo> {
  const ext = extOf(file.name);
  if (!ext || !(ext in AUDIO_TYPES)) throw new MediaError(400, `unsupported file type: ${file.name}`);
  if (file.bytes.byteLength > mediaMaxBytes()) throw new MediaError(413, `file too large (max ${mediaMaxBytes()} bytes)`);
  const id = `${createHash("sha256").update(file.bytes).digest("hex").slice(0, 16)}.${ext}`;
  const path = mediaPath(deckId, id);
  await mkdir(deckMediaDir(deckId), { recursive: true });
  const existing = await readFile(`${path}.json`, "utf8").then((s) => JSON.parse(s) as MediaInfo, () => null);
  if (existing) return existing;
  const info: MediaInfo = { id, name: file.name, mime: AUDIO_TYPES[ext], bytes: file.bytes.byteLength, uploadedAt: new Date().toISOString() };
  await writeFile(path, file.bytes);
  await writeFile(`${path}.json`, JSON.stringify(info), "utf8");
  return info;
}

export async function listMedia(deckId: string): Promise<MediaInfo[]> {
  const dir = deckMediaDir(deckId);
  const files = await readdir(dir).catch(() => [] as string[]);
  const out: MediaInfo[] = [];
  for (const f of files.filter((n) => n.endsWith(".json"))) {
    try { out.push(JSON.parse(await readFile(join(dir, f), "utf8")) as MediaInfo); } catch { /* skip corrupt sidecar */ }
  }
  return out.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt) || a.id.localeCompare(b.id));
}

export async function readMedia(deckId: string, mediaId: string): Promise<{ info: MediaInfo; bytes: Uint8Array }> {
  const path = mediaPath(deckId, mediaId);
  try {
    const info = JSON.parse(await readFile(`${path}.json`, "utf8")) as MediaInfo;
    return { info, bytes: new Uint8Array(await readFile(path)) };
  } catch {
    throw new MediaError(404, "unknown media");
  }
}

export async function deleteMedia(deckId: string, mediaId: string): Promise<void> {
  const path = mediaPath(deckId, mediaId);
  await unlink(path).catch(() => {});
  await unlink(`${path}.json`).catch(() => {});
}

export async function deleteDeckMedia(deckId: string): Promise<void> {
  await rm(deckMediaDir(deckId), { recursive: true, force: true });
}
```

- [ ] **Step 5: Deck deletion removes media** — in `lib/store/deck-store.ts`, change `deleteDeck` to:

```ts
export async function deleteDeck(id: string): Promise<void> {
  await unlink(fileFor(id));
  const { deleteDeckMedia } = await import("./media-store"); // lazy: media-store imports dataDir from here
  await deleteDeckMedia(id);
}
```

- [ ] **Step 6: Run** `npx vitest run tests/unit/media-store.test.ts tests/unit/api-decks.test.ts` → PASS; `npm test` → all pass; `npx tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add lib/store/media-store.ts lib/store/deck-store.ts tests/unit/media-store.test.ts
git commit -m "feat(store): per-deck content-addressed media store"
```

---

### Task 3: Media routes + browser client

**Files:**
- Create: `app/api/decks/[id]/media/route.ts`
- Create: `app/api/decks/[id]/media/[mediaId]/route.ts`
- Create: `lib/api/media-client.ts`
- Test: `tests/unit/api-media.test.ts`, `tests/unit/media-client.test.ts`

**Interfaces:**
- Consumes: Task 2 store API; `loadDeck` from `lib/store/deck-store.ts` (throws for an unknown deck).
- Produces: routes per spec §2; client:

```ts
export function mediaUrl(deckId: string, mediaId: string): string;            // withBasePath(`/api/decks/${deckId}/media/${mediaId}`)
export function uploadMedia(deckId: string, file: File): Promise<MediaInfo>;  // throws Error(server message)
export function listMedia(deckId: string): Promise<MediaInfo[]>;
```

- [ ] **Step 1: Write the failing route test** — `tests/unit/api-media.test.ts`:

```ts
// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeck } from "@/lib/store/deck-store";
import { GET as listGET, POST as uploadPOST } from "@/app/api/decks/[id]/media/route";
import { GET as fileGET, DELETE as fileDELETE } from "@/app/api/decks/[id]/media/[mediaId]/route";

let dir: string;
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), "morgana-")); process.env.MORGANA_DATA_DIR = dir; await createDeck({ id: "d1", title: "D1" }); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MORGANA_DATA_DIR; delete process.env.MORGANA_MEDIA_MAX_MB; });

const deckCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const fileCtx = (id: string, mediaId: string) => ({ params: Promise.resolve({ id, mediaId }) });
const upload = (deck: string, name: string, body: string, type = "audio/mpeg") => {
  const fd = new FormData();
  fd.append("file", new File([body], name, { type }));
  return uploadPOST(new Request(`http://t/api/decks/${deck}/media`, { method: "POST", body: fd }), deckCtx(deck));
};

test("upload → list → fetch bytes → delete", async () => {
  const res = await upload("d1", "mix.mp3", "abc");
  expect(res.status).toBe(201);
  const info = await res.json();
  expect(info).toMatchObject({ name: "mix.mp3", mime: "audio/mpeg", bytes: 3 });
  expect((await (await listGET(new Request("http://t"), deckCtx("d1"))).json()).media.map((m: { id: string }) => m.id)).toEqual([info.id]);
  const file = await fileGET(new Request("http://t"), fileCtx("d1", info.id));
  expect(file.status).toBe(200);
  expect(file.headers.get("Content-Type")).toBe("audio/mpeg");
  expect(file.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
  expect(await file.text()).toBe("abc");
  expect((await fileDELETE(new Request("http://t", { method: "DELETE" }), fileCtx("d1", info.id))).status).toBe(204);
  expect((await fileGET(new Request("http://t"), fileCtx("d1", info.id))).status).toBe(404);
});

test("served Content-Type comes from the extension, not the client", async () => {
  const info = await (await upload("d1", "a.wav", "x", "text/html")).json();
  expect((await fileGET(new Request("http://t"), fileCtx("d1", info.id))).headers.get("Content-Type")).toBe("audio/wav");
});

test("400 unsupported type, 400 missing file, 404 unknown deck, 413 too large", async () => {
  expect((await upload("d1", "evil.exe", "x")).status).toBe(400);
  expect((await uploadPOST(new Request("http://t", { method: "POST", body: new FormData() }), deckCtx("d1"))).status).toBe(400);
  expect((await upload("nope", "a.mp3", "x")).status).toBe(404);
  process.env.MORGANA_MEDIA_MAX_MB = "0.000001";
  expect((await upload("d1", "a.mp3", "too big")).status).toBe(413);
});

test.each(["..%2F..%2Fdecks%2Fd1.deck.json", "../../decks/d1.deck.json", "%2Fetc%2Fpasswd"])(
  "a crafted media id %s is a 404 and reads nothing", async (mediaId) => {
    mkdirSync(join(dir, "media", "d1"), { recursive: true });
    writeFileSync(join(dir, "secret.txt"), "secret");
    const res = await fileGET(new Request("http://t"), fileCtx("d1", decodeURIComponent(mediaId)));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("secret");
  });
```

- [ ] **Step 2: Run to verify it fails** → FAIL (modules not found).

- [ ] **Step 3: Implement `app/api/decks/[id]/media/route.ts`**

```ts
import { loadDeck } from "@/lib/store/deck-store";
import { listMedia, saveMedia, MediaError, mediaMaxBytes } from "@/lib/store/media-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const fail = (e: unknown) =>
  e instanceof MediaError
    ? Response.json({ error: e.message }, { status: e.status })
    : Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try { return Response.json({ media: await listMedia(id) }); } catch (e) { return fail(e); }
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  try { await loadDeck(id); } catch { return Response.json({ error: "not found" }, { status: 404 }); }
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > mediaMaxBytes() + 64 * 1024) {
    return Response.json({ error: "file too large" }, { status: 413 });
  }
  let file: FormDataEntryValue | null;
  try { file = (await req.formData()).get("file"); } catch { return Response.json({ error: "expected multipart form data" }, { status: 400 }); }
  if (!(file instanceof File)) return Response.json({ error: "missing \"file\" field" }, { status: 400 });
  try {
    const info = await saveMedia(id, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return Response.json(info, { status: 201 });
  } catch (e) { return fail(e); }
}
```

- [ ] **Step 4: Implement `app/api/decks/[id]/media/[mediaId]/route.ts`**

```ts
import { readMedia, deleteMedia, MediaError } from "@/lib/store/media-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; mediaId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id, mediaId } = await params;
  try {
    const { info, bytes } = await readMedia(id, mediaId);
    return new Response(bytes, {
      headers: { "Content-Type": info.mime, "Cache-Control": "private, max-age=31536000, immutable", "Content-Length": String(bytes.byteLength) },
    });
  } catch (e) {
    return Response.json({ error: e instanceof MediaError ? e.message : "not found" }, { status: 404 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, mediaId } = await params;
  try { await deleteMedia(id, mediaId); return new Response(null, { status: 204 }); }
  catch (e) { return Response.json({ error: e instanceof MediaError ? e.message : "not found" }, { status: 404 }); }
}
```

Note: `readMedia` sets `Content-Type` from the sidecar's `mime`, which `saveMedia` derived from the extension — never the client's type.

- [ ] **Step 5: Client** — read `lib/api/decks-client.ts` first and follow its `req`/`withBasePath` pattern. Create `lib/api/media-client.ts`:

```ts
import { withBasePath } from "@/lib/base-path";
import type { MediaInfo } from "@/lib/store/media-store";

export function mediaUrl(deckId: string, mediaId: string): string {
  return withBasePath(`/api/decks/${deckId}/media/${mediaId}`);
}

export async function uploadMedia(deckId: string, file: File): Promise<MediaInfo> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(withBasePath(`/api/decks/${deckId}/media`), { method: "POST", body });
  if (!res.ok) {
    const msg = await res.json().then((j: { error?: string }) => j.error, () => undefined);
    throw new Error(msg ?? `upload failed (${res.status})`);
  }
  return res.json();
}

export async function listMedia(deckId: string): Promise<MediaInfo[]> {
  const res = await fetch(withBasePath(`/api/decks/${deckId}/media`));
  if (!res.ok) throw new Error(`could not list media (${res.status})`);
  return ((await res.json()) as { media: MediaInfo[] }).media;
}
```

`tests/unit/media-client.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";
import { listMedia, mediaUrl, uploadMedia } from "@/lib/api/media-client";

afterEach(() => vi.restoreAllMocks());

test("mediaUrl", () => {
  expect(mediaUrl("d1", "0123456789abcdef.mp3")).toBe("/api/decks/d1/media/0123456789abcdef.mp3");
});

test("uploadMedia posts multipart and surfaces the server's error message", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: "x" }), { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: "unsupported file type: a.exe" }), { status: 400 }));
  expect(await uploadMedia("d1", new File(["a"], "a.mp3"))).toEqual({ id: "x" });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/decks/d1/media");
  expect((init as RequestInit).body).toBeInstanceOf(FormData);
  await expect(uploadMedia("d1", new File(["a"], "a.exe"))).rejects.toThrow("unsupported file type: a.exe");
});

test("listMedia unwraps the media array", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ media: [{ id: "m" }] })));
  expect(await listMedia("d1")).toEqual([{ id: "m" }]);
});
```

- [ ] **Step 6: Run** both test files + `tests/unit/base-path-callsites.test.ts` → PASS; `npm test`, `npx tsc --noEmit`.

- [ ] **Step 7: Commit**

```bash
git add app/api/decks/[id]/media lib/api/media-client.ts tests/unit/api-media.test.ts tests/unit/media-client.test.ts
git commit -m "feat(api): deck media upload/list/serve/delete routes + client"
```

---

### Task 4: `meta.soundtrack` + `meta.markers` in the format

**Files:**
- Modify: `engine/deck-doc.ts` (`DeckMeta`, `validateDeckDoc`)
- Test: `tests/unit/deck-doc-soundtrack.test.ts`

**Interfaces:**
- Produces: `DeckMeta.soundtrack?: { media: string }`; `DeckMeta.markers?: DeckMarker[]`; exported `interface DeckMarker { id: string; label: string; t: number }`. Messages (exact): `meta.soundtrack.media must be a media id`, `` `meta.markers[${i}].id must be a non-empty string` ``, `` `meta.markers[${i}].id "${id}" duplicated` ``, `` `meta.markers[${i}].label must be 1–40 characters` ``, `` `meta.markers[${i}].t must be a finite number ≥ 0` ``, `meta.markers must be an array`.
- Note: `engine/deck-doc.ts` must not import `lib/store/media-store.ts` (Node fs). Duplicate the media-id regex locally as `const MEDIA_ID_PATTERN = /^[0-9a-f]{16}\.[a-z0-9]{1,5}$/;` with a comment pointing at `MEDIA_ID_RE`, and add a unit test asserting the two regexes have the same `.source`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";
import { MEDIA_ID_RE } from "@/lib/store/media-store";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [] });
const errs = (d: DeckDoc) => validateDeckDoc(d).errors;

test("soundtrack and markers are optional and valid when well-formed", () => {
  const d = base();
  d.meta.soundtrack = { media: "0123456789abcdef.mp3" };
  d.meta.markers = [{ id: "m1", label: "drop", t: 40.2 }, { id: "m2", label: "start", t: 0 }];
  expect(validateDeckDoc(d)).toEqual({ ok: true, errors: [] });
  expect(validateDeckDoc(base()).ok).toBe(true);
});

test("soundtrack.media must be a media id", () => {
  const d = base();
  (d.meta as unknown as Record<string, unknown>).soundtrack = { media: "../x.mp3" };
  expect(errs(d)).toContain("meta.soundtrack.media must be a media id");
});

test("marker validation", () => {
  const d = base();
  (d.meta as unknown as Record<string, unknown>).markers = [
    { id: "", label: "a", t: 1 }, { id: "m", label: "", t: 1 }, { id: "m", label: "b", t: -1 },
    { id: "n", label: "x".repeat(41), t: Number.NaN },
  ];
  const e = errs(d);
  expect(e).toContain("meta.markers[0].id must be a non-empty string");
  expect(e).toContain("meta.markers[1].label must be 1–40 characters");
  expect(e).toContain('meta.markers[2].id "m" duplicated');
  expect(e).toContain("meta.markers[2].t must be a finite number ≥ 0");
  expect(e).toContain("meta.markers[3].label must be 1–40 characters");
  expect(e).toContain("meta.markers[3].t must be a finite number ≥ 0");
  (d.meta as unknown as Record<string, unknown>).markers = "nope";
  expect(errs(d)).toContain("meta.markers must be an array");
});

test("the format's media-id pattern matches the store's", async () => {
  const { MEDIA_ID_PATTERN } = await import("@/engine/deck-doc");
  expect(MEDIA_ID_PATTERN.source).toBe(MEDIA_ID_RE.source);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — in `engine/deck-doc.ts`:

```ts
/** Same pattern as lib/store/media-store.ts MEDIA_ID_RE (kept local: the format must not import fs code). */
export const MEDIA_ID_PATTERN = /^[0-9a-f]{16}\.[a-z0-9]{1,5}$/;

/** A deck-time cue point shown on the ruler and Player scrubber. */
export interface DeckMarker { id: string; label: string; t: number }
```

Add to `DeckMeta` (after `timing?`):

```ts
  /** The pre-mixed soundtrack: a media id in this deck's media store, played from deck T = 0. */
  soundtrack?: { media: string };
  /** Deck-time cue points (e.g. "drop" @ 40.2). */
  markers?: DeckMarker[];
```

In `validateDeckDoc`'s meta `else` branch, after the timing check:

```ts
    const meta = d.meta as { soundtrack?: unknown; markers?: unknown };
    if (meta.soundtrack !== undefined) {
      const media = (meta.soundtrack as { media?: unknown } | null)?.media;
      if (typeof media !== "string" || !MEDIA_ID_PATTERN.test(media)) e.push("meta.soundtrack.media must be a media id");
    }
    if (meta.markers !== undefined) {
      if (!Array.isArray(meta.markers)) e.push("meta.markers must be an array");
      else {
        const seen = new Set<string>();
        meta.markers.forEach((m: Record<string, unknown>, i) => {
          if (typeof m?.id !== "string" || !m.id) e.push(`meta.markers[${i}].id must be a non-empty string`);
          else if (seen.has(m.id)) e.push(`meta.markers[${i}].id "${m.id}" duplicated`);
          else seen.add(m.id);
          if (typeof m?.label !== "string" || m.label.length < 1 || m.label.length > 40) e.push(`meta.markers[${i}].label must be 1–40 characters`);
          if (typeof m?.t !== "number" || !Number.isFinite(m.t) || m.t < 0) e.push(`meta.markers[${i}].t must be a finite number ≥ 0`);
        });
      }
    }
```

- [ ] **Step 4: Run** the new test + `tests/unit/deck-doc*.test.ts` → PASS; `npm test`; `tsc`.

- [ ] **Step 5: Commit**

```bash
git add engine/deck-doc.ts tests/unit/deck-doc-soundtrack.test.ts
git commit -m "feat(format): optional meta.soundtrack and meta.markers"
```

---

### Task 5: Soundtrack lint rules

**Files:**
- Modify: `lib/editor/lint.ts`
- Test: `tests/unit/lint-soundtrack.test.ts`

**Interfaces:**
- Consumes: `deckLayout` (deck-clock), `formatClock` (clock-format), `DeckMeta.soundtrack/markers` (Task 4).
- Produces: `export interface LintContext { mediaIds?: string[]; soundtrackSec?: number }`; `lintDeck(doc: DeckDoc, ctx?: LintContext): LintIssue[]`. Rules (warnings, no `at`): `soundtrack-missing`, `soundtrack-length`, `marker-out-of-range`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { lintDeck } from "@/lib/editor/lint";
import type { DeckDoc } from "@/engine/deck-doc";

const ID = "0123456789abcdef.mp3";
const deck = (): DeckDoc => ({
  version: 1, meta: { id: "d", title: "D", timing: { targetSec: 10 }, soundtrack: { media: ID },
    markers: [{ id: "m1", label: "drop", t: 4 }, { id: "m2", label: "late", t: 99 }] },
  scenes: [{ id: "s", durationSec: 10, beats: [{ id: "a", timeline: [{ kind: "wait", ms: 1000 }] }] }],
});
const rule = (d: DeckDoc, r: string, ctx?: Parameters<typeof lintDeck>[1]) => lintDeck(d, ctx).filter((i) => i.rule === r);

test("soundtrack-missing only when the media list is known and lacks the id", () => {
  expect(rule(deck(), "soundtrack-missing")).toEqual([]);                       // no ctx → skipped
  expect(rule(deck(), "soundtrack-missing", { mediaIds: [ID] })).toEqual([]);
  const [i] = rule(deck(), "soundtrack-missing", { mediaIds: [] });
  expect(i).toMatchObject({ severity: "warning" });
  expect(i.message).toBe("the soundtrack file is missing from this deck's media — upload it again");
});

test("soundtrack-length compares the track with the deck total beyond 0.5 s", () => {
  expect(rule(deck(), "soundtrack-length", { soundtrackSec: 10.4 })).toEqual([]);
  expect(rule(deck(), "soundtrack-length", { soundtrackSec: 12 })[0].message)
    .toBe("track is 0:12, deck is 0:10 — 2.0s of music would play past the last frame");
  expect(rule(deck(), "soundtrack-length", { soundtrackSec: 7 })[0].message)
    .toBe("track is 0:07, deck is 0:10 — the video would end 3.0s in silence");
  expect(rule(deck(), "soundtrack-length")).toEqual([]);                        // duration unknown → skipped
});

test("marker-out-of-range flags markers past the deck total", () => {
  const issues = rule(deck(), "marker-out-of-range");
  expect(issues).toHaveLength(1);
  expect(issues[0].message).toBe('marker "late" at 1:39 is past the end of the deck (0:10)');
});

test("no soundtrack → no soundtrack rules even with ctx", () => {
  const d = deck(); delete d.meta.soundtrack;
  expect(rule(d, "soundtrack-missing", { mediaIds: [] })).toEqual([]);
  expect(rule(d, "soundtrack-length", { soundtrackSec: 99 })).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — in `lib/editor/lint.ts` add:

```ts
export interface LintContext { mediaIds?: string[]; soundtrackSec?: number }

function soundtrackWarnings(doc: DeckDoc, ctx: LintContext): LintIssue[] {
  const out: LintIssue[] = [];
  const total = deckLayout(doc).total;
  const media = doc.meta.soundtrack?.media;
  if (media && ctx.mediaIds && !ctx.mediaIds.includes(media)) {
    out.push({ rule: "soundtrack-missing", severity: "warning", message: "the soundtrack file is missing from this deck's media — upload it again" });
  }
  if (media && ctx.soundtrackSec !== undefined) {
    const diff = ctx.soundtrackSec - total;
    if (Math.abs(diff) > 0.5) {
      const head = `track is ${formatClock(ctx.soundtrackSec, { tenths: false })}, deck is ${formatClock(total, { tenths: false })}`;
      out.push({ rule: "soundtrack-length", severity: "warning",
        message: diff > 0 ? `${head} — ${diff.toFixed(1)}s of music would play past the last frame`
                          : `${head} — the video would end ${(-diff).toFixed(1)}s in silence` });
    }
  }
  for (const m of doc.meta.markers ?? []) {
    if (m.t > total) {
      out.push({ rule: "marker-out-of-range", severity: "warning",
        message: `marker "${m.label}" at ${formatClock(m.t, { tenths: false })} is past the end of the deck (${formatClock(total, { tenths: false })})` });
    }
  }
  return out;
}
```

Change the signature to `export function lintDeck(doc: DeckDoc, ctx: LintContext = {}): LintIssue[]` and, inside the existing `if (errors.length === 0) {` block next to `warnings.push(...timingWarnings(doc));`, add `warnings.push(...soundtrackWarnings(doc, ctx));`.

- [ ] **Step 4: Run** the new test + `tests/unit/lint*.test.ts` → PASS; `npm test`; `tsc`.

- [ ] **Step 5: Commit**

```bash
git add lib/editor/lint.ts tests/unit/lint-soundtrack.test.ts
git commit -m "feat(lint): soundtrack-missing, soundtrack-length, marker-out-of-range"
```

---

### Task 6: MCP — `list_media`, `set_soundtrack`, `set_markers`

**Files:**
- Modify: `lib/mcp/tool-defs.ts`, `lib/mcp/tool-handlers.ts`, `README.md` (MCP section)
- Test: `tests/unit/mcp-tool-defs.test.ts`, `tests/unit/mcp-tool-handlers.test.ts` (append)

**Interfaces:**
- Consumes: `listMedia` from `lib/store/media-store.ts`; `DeckMarker` (Task 4); `mutate()`/`loadDeck` in tool-handlers.
- Produces: tools `list_media(deck_id)` → `{ media: MediaInfo[] }`; `set_soundtrack(deck_id, media_id: string | null)`; `set_markers(deck_id, markers: {id,label,t}[])`.

- [ ] **Step 1: Failing tests.** Append to `tests/unit/mcp-tool-defs.test.ts`:

```ts
test("includes the soundtrack tools with descriptions that state the contract", () => {
  const byName = Object.fromEntries(TOOL_DEFS.map((t) => [t.name, t]));
  expect(byName.list_media).toBeDefined();
  expect(byName.set_soundtrack.description).toMatch(/upload.*editor/i);
  expect(byName.set_soundtrack.description).toMatch(/0:00/);
  expect(byName.set_markers.description).toMatch(/replaces/i);
});
```

Append to `tests/unit/mcp-tool-handlers.test.ts` (it already imports `createDeck`, `loadDeck`, `callTool`; add `saveMedia` from `@/lib/store/media-store`):

```ts
test("list_media, set_soundtrack and set_markers", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  const info = await saveMedia("demo", { name: "mix.mp3", bytes: new TextEncoder().encode("x") });
  expect(await callTool("list_media", { deck_id: "demo" })).toEqual({ media: [info] });
  await callTool("set_soundtrack", { deck_id: "demo", media_id: info.id });
  expect((await loadDeck("demo")).meta.soundtrack).toEqual({ media: info.id });
  await expect(callTool("set_soundtrack", { deck_id: "demo", media_id: "ffffffffffffffff.mp3" })).rejects.toThrow(/not in this deck's media/);
  await callTool("set_soundtrack", { deck_id: "demo", media_id: null });
  expect((await loadDeck("demo")).meta.soundtrack).toBeUndefined();
  await callTool("set_markers", { deck_id: "demo", markers: [{ id: "m1", label: "drop", t: 40.2 }] });
  expect((await loadDeck("demo")).meta.markers).toEqual([{ id: "m1", label: "drop", t: 40.2 }]);
  await expect(callTool("set_markers", { deck_id: "demo", markers: [{ id: "m1", label: "", t: 1 }] })).rejects.toThrow(/label/);
  await callTool("set_markers", { deck_id: "demo", markers: [] });
  expect((await loadDeck("demo")).meta.markers).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify failures.**

- [ ] **Step 3: Tool defs** — append to `TOOL_DEFS` in `lib/mcp/tool-defs.ts`:

```ts
  {
    name: "list_media",
    description: "Read-only. Lists the files in this deck's media store (id, original name, mime type, size in bytes). Media is uploaded by the user in the editor (Deck settings → Soundtrack); it cannot be uploaded over MCP.",
    inputSchema: schema({ ...DECK_ID }, ["deck_id"]),
  },
  {
    name: "set_soundtrack",
    description: "Set the deck's soundtrack to a media id from list_media, or pass media_id: null to remove it. The soundtrack is one pre-mixed track that plays from deck time 0:00 in the timed Player and in exported video; its length should match the deck's total (read_deck_timing). Files must be uploaded in the editor first — binary uploads are not possible over MCP. Removing the soundtrack keeps the file in the media store.",
    inputSchema: schema({
      ...DECK_ID,
      media_id: { type: ["string", "null"], description: "A media id from list_media, or null to remove the soundtrack." },
    }, ["deck_id", "media_id"]),
  },
  {
    name: "set_markers",
    description: "Replaces the deck's whole list of cue markers. A marker is a named deck-time point (e.g. { id: \"m1\", label: \"drop\", t: 40.2 }) shown as a tick on the editor ruler and the Player scrubber — use them to line scene lengths up with the music. ids must be unique and non-empty, labels 1–40 characters, t ≥ 0 seconds. Pass [] to clear all markers.",
    inputSchema: schema({
      ...DECK_ID,
      markers: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, t: { type: "number" } }, required: ["id", "label", "t"] } },
    }, ["deck_id", "markers"]),
  },
```

- [ ] **Step 4: Handlers** — in `lib/mcp/tool-handlers.ts` import `listMedia, type MediaInfo` from `@/lib/store/media-store` and add cases before `default`:

```ts
    case "list_media":
      return { media: await listMedia(deckId) };
    case "set_soundtrack": {
      const mediaId = a.media_id;
      if (mediaId !== null && typeof mediaId !== "string") throw new ToolCallError('"media_id" must be a string or null');
      if (mediaId !== null && !(await listMedia(deckId)).some((m) => m.id === mediaId)) {
        throw new ToolCallError(`media "${mediaId}" is not in this deck's media — upload it in the editor first`);
      }
      return mutate(deckId, (doc) => {
        const meta = { ...doc.meta };
        if (mediaId === null) delete meta.soundtrack; else meta.soundtrack = { media: mediaId };
        return { ...doc, meta };
      });
    }
    case "set_markers": {
      if (!Array.isArray(a.markers)) throw new ToolCallError('"markers" must be an array');
      const markers = a.markers as DeckMarker[];
      return mutate(deckId, (doc) => {
        const meta = { ...doc.meta };
        if (markers.length === 0) delete meta.markers; else meta.markers = markers;
        return { ...doc, meta };
      });
    }
```

(import `type DeckMarker` from `@/engine/deck-doc`). Widen `callTool`'s declared return type with `| { media: MediaInfo[] }`.

- [ ] **Step 5: README** — in the MCP section next to the timing tools sentence add: "Soundtrack: `list_media` lists the deck's uploaded files, `set_soundtrack` picks one (uploads happen in the editor), and `set_markers` replaces the deck's cue markers."

- [ ] **Step 6: Run** both MCP test files → PASS; `npm test`; `tsc`.

- [ ] **Step 7: Commit**

```bash
git add lib/mcp/tool-defs.ts lib/mcp/tool-handlers.ts README.md tests/unit/mcp-tool-defs.test.ts tests/unit/mcp-tool-handlers.test.ts
git commit -m "feat(mcp): list_media, set_soundtrack, set_markers"
```

---

### Task 7: `TimeBar` waveform + markers

**Files:**
- Modify: `components/timing/TimeBar.tsx`
- Test: `tests/unit/time-bar.test.tsx` (append)

**Interfaces:**
- Consumes: `DeckMarker` (Task 4).
- Produces: new optional props on `TimeBarProps`: `peaks?: Float32Array`, `peaksDuration?: number` (seconds the peaks cover), `markers?: DeckMarker[]`, `onMarkerClick?: (t: number) => void`. Test ids: `timebar-waveform` (an `<svg>` with one `<path>`), `timebar-marker` (one per marker, `title` = label, `data-marker-id`).

- [ ] **Step 1: Failing tests** (append; reuse the file's existing `layout` fixture and `firePointer` helper):

```tsx
test("draws the waveform under the segments when peaks are given", () => {
  const peaks = Float32Array.from([0, 0.5, 1, 0.5]);
  render(<TimeBar layout={layout} sceneIds={["a", "b", "c"]} value={0} targetSec={12} onScrub={() => {}} testId="tb" peaks={peaks} peaksDuration={6} />);
  const svg = screen.getByTestId("timebar-waveform");
  expect(svg.querySelectorAll("path")).toHaveLength(1);
  expect(svg.style.width).toBe(`${(6 / 12) * 100}%`); // covers [0, peaksDuration] on the bar's scale
  expect(svg.getAttribute("pointer-events")).toBe("none");
});

test("no waveform without peaks", () => {
  render(<TimeBar layout={layout} sceneIds={["a", "b", "c"]} value={0} onScrub={() => {}} testId="tb" />);
  expect(screen.queryByTestId("timebar-waveform")).toBeNull();
});

test("markers render as labelled ticks; clicking one jumps there instead of scrubbing", () => {
  const onScrub = vi.fn();
  const onMarkerClick = vi.fn();
  render(<TimeBar layout={layout} sceneIds={["a", "b", "c"]} value={0} targetSec={12} onScrub={onScrub} testId="tb"
    markers={[{ id: "m1", label: "drop", t: 6 }]} onMarkerClick={onMarkerClick} />);
  const tick = screen.getByTestId("timebar-marker");
  expect(tick.getAttribute("title")).toBe("drop");
  expect(tick.style.left).toBe("50%");
  expect(tick.textContent).toContain("drop");
  fireEvent.click(tick);
  expect(onMarkerClick).toHaveBeenCalledWith(6);
  // the tick's pointerdown must not also start a scrub
  firePointer(tick, "pointerdown", { clientX: 10 });
  expect(onScrub).not.toHaveBeenCalled();
});
```

(If the existing `firePointer` helper has a different signature, adapt the call — keep the assertion.)

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.** Add the props to `TimeBarProps` and the destructure. Before the scene segments inside the root, render:

```tsx
      {peaks && peaks.length > 0 && peaksDuration !== undefined && peaksDuration > 0 && (
        <svg data-testid="timebar-waveform" pointerEvents="none" viewBox={`0 0 ${peaks.length} 2`} preserveAspectRatio="none"
          style={{ position: "absolute", left: 0, top: 0, height: "100%", width: pct(Math.min(peaksDuration, scale), scale), opacity: 0.35 }}>
          <path d={waveformPath(peaks)} fill="currentColor" />
        </svg>
      )}
```

with a module-level helper:

```ts
/** A symmetric filled envelope: top edge left→right at 1 − p, bottom edge right→left at 1 + p. */
function waveformPath(peaks: Float32Array): string {
  let d = `M0 1`;
  for (let i = 0; i < peaks.length; i++) d += ` L${i} ${1 - peaks[i]}`;
  for (let i = peaks.length - 1; i >= 0; i--) d += ` L${i} ${1 + peaks[i]}`;
  return `${d} Z`;
}
```

After the target line, render markers:

```tsx
      {markers?.map((m) => (
        <div key={m.id} data-testid="timebar-marker" data-marker-id={m.id} title={m.label}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onMarkerClick?.(m.t); }}
          style={{ position: "absolute", top: -6, bottom: -6, left: pct(m.t, scale), width: 2, marginLeft: -1, background: "#7fd1ff", cursor: "pointer" }}>
          <span style={{ position: "absolute", top: -12, left: 3, fontSize: 9, whiteSpace: "nowrap", color: "#7fd1ff" }}>{m.label}</span>
        </div>
      ))}
```

- [ ] **Step 4: Run** `npx vitest run tests/unit/time-bar.test.tsx` → PASS; `npm test`; `tsc`.

- [ ] **Step 5: Commit**

```bash
git add components/timing/TimeBar.tsx tests/unit/time-bar.test.tsx
git commit -m "feat(ui): TimeBar draws the soundtrack waveform and cue markers"
```

---

### Task 8: `useSoundtrack` hook + Player audio integration

**Files:**
- Create: `lib/audio/use-soundtrack.ts`
- Modify: `components/player/TimedPlayer.tsx`, `app/play/play.css`
- Test: `tests/unit/use-soundtrack.test.tsx`, `tests/unit/timed-player-audio.test.tsx`

**Interfaces:**
- Consumes: `Soundtrack`, `loadSoundtrack` (Task 1); `mediaUrl` (Task 3); `TimeBar` peaks/markers props (Task 7).
- Produces:

```ts
export type SoundtrackState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ready"; track: Soundtrack }
  | { status: "error"; error: string };
/** Decodes deck `deckId`'s soundtrack once per URL for the page (module cache shared by the editor
 *  ruler, Deck settings and the Player). `load` is injectable for tests. */
export function useSoundtrack(deckId: string | null, mediaId: string | undefined, load?: (url: string) => Promise<Soundtrack>): SoundtrackState;
export function __resetSoundtrackCache(): void; // tests only
```

`TimedPlayer` gains an optional prop `loadTrack?: (url: string) => Promise<Soundtrack>` (default `loadSoundtrack`), forwarded to `useSoundtrack`. New test ids: `play-audio-status` (text "loading audio…" or "Soundtrack unavailable — playing silent"; absent when ready or none), `play-mute` (button; `aria-pressed`).

- [ ] **Step 1: Failing hook test** — `tests/unit/use-soundtrack.test.tsx`:

```tsx
import { afterEach, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSoundtrack, __resetSoundtrackCache } from "@/lib/audio/use-soundtrack";
import type { Soundtrack } from "@/lib/audio/soundtrack";

afterEach(() => __resetSoundtrackCache());
const track = { duration: 3, peaks: new Float32Array(4) } as unknown as Soundtrack;

test("none without a media id; loading → ready; one decode shared across hooks", async () => {
  const load = vi.fn(() => Promise.resolve(track));
  expect(renderHook(() => useSoundtrack("d", undefined, load)).result.current).toEqual({ status: "none" });
  const a = renderHook(() => useSoundtrack("d", "0123456789abcdef.mp3", load));
  const b = renderHook(() => useSoundtrack("d", "0123456789abcdef.mp3", load));
  expect(a.result.current.status).toBe("loading");
  await act(async () => {});
  expect(a.result.current).toEqual({ status: "ready", track });
  expect(b.result.current).toEqual({ status: "ready", track });
  expect(load).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledWith("/api/decks/d/media/0123456789abcdef.mp3");
});

test("a failed decode is an error state, not a throw", async () => {
  const { result } = renderHook(() => useSoundtrack("d", "0123456789abcdef.mp3", () => Promise.reject(new Error("bad audio"))));
  await act(async () => {});
  expect(result.current).toEqual({ status: "error", error: "bad audio" });
});
```

- [ ] **Step 2: Implement `lib/audio/use-soundtrack.ts`**

```ts
"use client";
import { useEffect, useState } from "react";
import { loadSoundtrack, type Soundtrack } from "./soundtrack";
import { mediaUrl } from "@/lib/api/media-client";

export type SoundtrackState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ready"; track: Soundtrack }
  | { status: "error"; error: string };

// One decode per URL for the whole page: the editor ruler, Deck settings and the Player share it.
const cache = new Map<string, Promise<Soundtrack>>();
export function __resetSoundtrackCache(): void { cache.clear(); }

export function useSoundtrack(deckId: string | null, mediaId: string | undefined, load: (url: string) => Promise<Soundtrack> = loadSoundtrack): SoundtrackState {
  const url = deckId && mediaId ? mediaUrl(deckId, mediaId) : null;
  const [state, setState] = useState<SoundtrackState>(url ? { status: "loading" } : { status: "none" });
  useEffect(() => {
    if (!url) { setState({ status: "none" }); return; }
    let live = true;
    setState({ status: "loading" });
    let p = cache.get(url);
    if (!p) { p = load(url); cache.set(url, p); p.catch(() => cache.delete(url)); }
    p.then((track) => { if (live) setState({ status: "ready", track }); },
           (e: unknown) => { if (live) setState({ status: "error", error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [url, load]);
  return state;
}
```

- [ ] **Step 3: Failing Player test** — `tests/unit/timed-player-audio.test.tsx`. Use a fake `Soundtrack` whose `now()` is controlled by the test, and drive rAF with `vi.useFakeTimers({ toFake: ["requestAnimationFrame", "performance"] })` (if `performance` can't be faked in this Vitest version, stub `performance.now` with `vi.spyOn`). Read `tests/unit/timed-player.test.tsx` first and reuse its deck fixture style.

```tsx
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TimedPlayer } from "@/components/player/TimedPlayer";
import { __resetSoundtrackCache } from "@/lib/audio/use-soundtrack";
import type { Soundtrack } from "@/lib/audio/soundtrack";
import type { DeckDoc } from "@/engine/deck-doc";

afterEach(() => { cleanup(); __resetSoundtrackCache(); vi.useRealTimers(); });

const doc: DeckDoc = { version: 1, meta: { id: "p", title: "P", timing: { targetSec: 12 }, soundtrack: { media: "0123456789abcdef.mp3" },
  markers: [{ id: "m1", label: "drop", t: 6 }] }, scenes: [
  { id: "a", durationSec: 6, beats: [{ id: "b1", timeline: [{ kind: "text", value: "First", in: "fade" }, { kind: "wait", ms: 1000 }] }] },
  { id: "b", durationSec: 6, beats: [{ id: "b2", timeline: [{ kind: "text", value: "Second", in: "fade" }, { kind: "wait", ms: 1000 }] }] },
] };

function fakeTrack(duration = 10) {
  let audioNow: number | null = null;
  const t = {
    duration, peaks: new Float32Array([0.1, 0.5]),
    play: vi.fn((from: number) => { audioNow = from < duration ? from : null; }),
    pause: vi.fn(() => { audioNow = null; }),
    now: () => audioNow, setMuted: vi.fn(), dispose: vi.fn(),
    set: (v: number | null) => { audioNow = v; },
  };
  return t;
}
const clock = () => screen.getByTestId("play-clock").textContent;

test("while playing, T follows the audio clock", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
  const track = fakeTrack();
  render(<TimedPlayer doc={doc} loadTrack={() => Promise.resolve(track as unknown as Soundtrack)} />);
  await act(async () => {});
  act(() => { fireEvent.keyDown(window, { key: " " }); });
  expect(track.play).toHaveBeenCalledWith(0);
  track.set(4.25);
  act(() => { vi.advanceTimersToNextFrame(); });
  expect(clock()).toBe("0:04.3 / 0:12");
  act(() => { fireEvent.keyDown(window, { key: " " }); });
  expect(track.pause).toHaveBeenCalled();
});

test("seeking while playing restarts the audio at the new T", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
  const track = fakeTrack();
  render(<TimedPlayer doc={doc} initialT={2} loadTrack={() => Promise.resolve(track as unknown as Soundtrack)} />);
  await act(async () => {});
  act(() => { fireEvent.keyDown(window, { key: " " }); });
  act(() => { fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true }); });
  expect(track.play).toHaveBeenLastCalledWith(7);
  act(() => { fireEvent.keyDown(window, { key: "Home" }); });
  expect(track.play).toHaveBeenLastCalledWith(0);
});

test("past the track's end the clock continues on the timer", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "performance"] });
  const track = fakeTrack(3);
  render(<TimedPlayer doc={doc} initialT={2.9} loadTrack={() => Promise.resolve(track as unknown as Soundtrack)} />);
  await act(async () => {});
  act(() => { fireEvent.keyDown(window, { key: " " }); });
  track.set(null); // audio finished
  act(() => { vi.advanceTimersByTime(1000); });
  expect(Number(clock()!.slice(2, 6))).toBeGreaterThan(3.5);
});

test("a decode failure shows the notice and still plays silently", async () => {
  render(<TimedPlayer doc={doc} loadTrack={() => Promise.reject(new Error("bad"))} />);
  await act(async () => {});
  expect(screen.getByTestId("play-audio-status").textContent).toBe("Soundtrack unavailable — playing silent");
  act(() => { fireEvent.keyDown(window, { key: " " }); });
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
});

test("loading notice, mute toggle (M and button), waveform + markers on the scrubber", async () => {
  let resolve!: (t: Soundtrack) => void;
  const track = fakeTrack();
  render(<TimedPlayer doc={doc} loadTrack={() => new Promise<Soundtrack>((r) => { resolve = r; })} />);
  expect(screen.getByTestId("play-audio-status").textContent).toBe("loading audio…");
  await act(async () => { resolve(track as unknown as Soundtrack); });
  expect(screen.queryByTestId("play-audio-status")).toBeNull();
  act(() => { fireEvent.keyDown(window, { key: "m" }); });
  expect(track.setMuted).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByTestId("play-mute"));
  expect(track.setMuted).toHaveBeenLastCalledWith(false);
  expect(screen.getByTestId("timebar-waveform")).toBeTruthy();
  expect(screen.getByTestId("timebar-marker").getAttribute("title")).toBe("drop");
});
```

(The "past the end" test's `clock().slice(2, 6)` reads the seconds of `0:SS.S`; adjust the parse if the format differs, keeping the assertion "> 3.5 s".)

- [ ] **Step 4: Implement the Player integration** in `components/player/TimedPlayer.tsx`:
  1. Props: add `loadTrack?: (url: string) => Promise<Soundtrack>`; `const sound = useSoundtrack(doc.meta.id, doc.meta.soundtrack?.media, loadTrack ?? loadSoundtrack);` `const track = sound.status === "ready" ? sound.track : null;` keep `trackRef` synced (`useEffect(() => { trackRef.current = track; }, [track])`) and `useEffect(() => () => trackRef.current?.pause(), [])` on unmount.
  2. `const [muted, setMuted] = useState(false);` `useEffect(() => { track?.setMuted(muted); }, [track, muted]);`
  3. Audio transport follows `playing`: `useEffect(() => { if (!track) return; if (playing) track.play(T.current); else track.pause(); }, [playing, track]);` — this also lets a track that finishes decoding mid-play join at the current `T`.
  4. `seekTo(to)` = `apply(to); if (playingRef.current) trackRef.current?.play(T.current);` — use `seekTo` (not `apply`) for ArrowLeft/Right, Home, the TimeBar `onScrub`, marker clicks, and the restart in `togglePlay`. The scrubber already pauses; keep that.
  5. In the rAF `step`: `const audioT = trackRef.current?.now() ?? null; apply(audioT ?? T.current + Math.max(0, now - last) / 1000);` (the `apply` call stays the only writer).
  6. Keys: add `case "m": case "M": setMuted((v) => !v); break;`.
  7. HUD: after the scene label render
     `{sound.status === "loading" && <span className="play__audio" data-testid="play-audio-status">loading audio…</span>}`
     `{sound.status === "error" && <span className="play__audio play__audio--err" data-testid="play-audio-status">Soundtrack unavailable — playing silent</span>}`
     and, when `sound.status !== "none"`, a mute button
     `<button className="play__btn" data-testid="play-mute" aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"} onMouseDown={(e) => e.preventDefault()} onClick={() => setMuted((v) => !v)}>{muted ? "🔇" : "🔊"}</button>`.
  8. TimeBar: pass `peaks={track?.peaks}`, `peaksDuration={track?.duration}`, `markers={doc.meta.markers}`, `onMarkerClick={(t) => { setPlaying(false); apply(t); }}` (same as a scrub: pause then jump).
  9. CSS (`app/play/play.css`): `.play__audio { font-size: 12px; opacity: 0.8; } .play__audio--err { color: #e8a33d; opacity: 1; }`.

- [ ] **Step 5: Run** both new test files + `tests/unit/timed-player.test.tsx` → PASS; `npm test`; `tsc`.

- [ ] **Step 6: Commit**

```bash
git add lib/audio/use-soundtrack.ts components/player/TimedPlayer.tsx app/play/play.css tests/unit/use-soundtrack.test.tsx tests/unit/timed-player-audio.test.tsx
git commit -m "feat(player): soundtrack plays as the master clock; mute, notices, waveform, markers"
```

---

### Task 9: Editor — Soundtrack settings, ruler waveform, lint context

**Files:**
- Create: `components/editor/SoundtrackSettings.tsx`
- Create: `lib/editor/use-deck-media.ts`
- Modify: `components/editor/DeckSettings.tsx`, `components/editor/DeckRuler.tsx`, `lib/editor/use-lint.ts`, `app/editor/page.tsx`
- Test: `tests/unit/soundtrack-settings.test.tsx`, `tests/unit/deck-ruler-soundtrack.test.tsx`, `tests/unit/use-lint-ctx.test.tsx`

**Interfaces:**
- Consumes: `uploadMedia`, `listMedia` (Task 3); `useSoundtrack` (Task 8); `LintContext` (Task 5); TimeBar props (Task 7).
- Produces:

```ts
// lib/editor/use-deck-media.ts
export interface DeckMediaState { media: MediaInfo[] | null; refresh: () => Promise<void> }
export const DeckMediaContext: React.Context<DeckMediaState>;   // default { media: null, refresh: async () => {} }
export function useDeckMediaState(deckId: string | null): DeckMediaState; // fetches on deckId change
// lib/editor/use-lint.ts
export function useLint(ctx?: LintContext): LintIssue[];
```

Test ids: `soundtrack-upload` (file input), `soundtrack-name`, `soundtrack-duration`, `soundtrack-replace`, `soundtrack-remove`, `soundtrack-error`.

- [ ] **Step 1: Failing tests.**

`tests/unit/soundtrack-settings.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEditor } from "@/lib/editor/store";
import { SoundtrackSettings } from "@/components/editor/SoundtrackSettings";
import { DeckMediaContext } from "@/lib/editor/use-deck-media";
import * as mediaClient from "@/lib/api/media-client";
import { __resetSoundtrackCache } from "@/lib/audio/use-soundtrack";
import type { DeckDoc } from "@/engine/deck-doc";

const ID = "0123456789abcdef.mp3";
const info = { id: ID, name: "mix.mp3", mime: "audio/mpeg", bytes: 3, uploadedAt: "2026-10-23T00:00:00Z" };
const deck = (withTrack: boolean): DeckDoc => ({ version: 1, meta: { id: "d", title: "D", ...(withTrack ? { soundtrack: { media: ID } } : {}) }, scenes: [] });
afterEach(() => { cleanup(); vi.restoreAllMocks(); __resetSoundtrackCache(); });

const renderWith = (media: typeof info[] | null, refresh = vi.fn(async () => {})) => render(
  <DeckMediaContext.Provider value={{ media, refresh }}>
    <SoundtrackSettings loadTrack={() => Promise.resolve({ duration: 120.4, peaks: new Float32Array(1) } as never)} />
  </DeckMediaContext.Provider>,
);

test("upload sets the soundtrack (undoable) and refreshes the media list", async () => {
  useEditor.getState().load(deck(false));
  vi.spyOn(mediaClient, "uploadMedia").mockResolvedValue(info);
  const refresh = vi.fn(async () => {});
  renderWith([], refresh);
  const input = screen.getByTestId("soundtrack-upload") as HTMLInputElement;
  await act(async () => { fireEvent.change(input, { target: { files: [new File(["abc"], "mix.mp3")] } }); });
  expect(useEditor.getState().doc!.meta.soundtrack).toEqual({ media: ID });
  expect(refresh).toHaveBeenCalled();
  useEditor.getState().undo();
  expect(useEditor.getState().doc!.meta.soundtrack).toBeUndefined();
});

test("shows the file name and decoded duration; remove clears the reference only", async () => {
  useEditor.getState().load(deck(true));
  renderWith([info]);
  await act(async () => {});
  expect(screen.getByTestId("soundtrack-name").textContent).toBe("mix.mp3");
  expect(screen.getByTestId("soundtrack-duration").textContent).toBe("2:00");
  const del = vi.spyOn(globalThis, "fetch");
  fireEvent.click(screen.getByTestId("soundtrack-remove"));
  expect(useEditor.getState().doc!.meta.soundtrack).toBeUndefined();
  expect(del).not.toHaveBeenCalled(); // the file stays (undo-safe)
});

test("an upload error is shown inline and leaves the deck unchanged", async () => {
  useEditor.getState().load(deck(false));
  vi.spyOn(mediaClient, "uploadMedia").mockRejectedValue(new Error("unsupported file type: a.exe"));
  renderWith([]);
  await act(async () => { fireEvent.change(screen.getByTestId("soundtrack-upload"), { target: { files: [new File(["x"], "a.exe")] } }); });
  expect(screen.getByTestId("soundtrack-error").textContent).toContain("unsupported file type");
  expect(useEditor.getState().doc!.meta.soundtrack).toBeUndefined();
});
```

`tests/unit/deck-ruler-soundtrack.test.tsx` — load a timed deck with a soundtrack and markers into the store, render `<DeckRuler canvasRef={createRef()} beatT={0} loadTrack={…resolves a fake track with peaks…} />` and assert `timebar-waveform` and one `timebar-marker` render inside `deck-ruler`. (DeckRuler gains the same optional `loadTrack` prop for tests.)

`tests/unit/use-lint-ctx.test.tsx` — `renderHook(() => useLint({ mediaIds: [] }))` on a deck with a soundtrack → result contains a `soundtrack-missing` issue; `useLint()` → none.

- [ ] **Step 2: Implement `lib/editor/use-deck-media.ts`**

```ts
"use client";
import { createContext, useCallback, useEffect, useState } from "react";
import { listMedia } from "@/lib/api/media-client";
import type { MediaInfo } from "@/lib/store/media-store";

export interface DeckMediaState { media: MediaInfo[] | null; refresh: () => Promise<void> }
export const DeckMediaContext = createContext<DeckMediaState>({ media: null, refresh: async () => {} });

/** The deck's media list for the editor page (null until loaded or if listing fails). */
export function useDeckMediaState(deckId: string | null): DeckMediaState {
  const [media, setMedia] = useState<MediaInfo[] | null>(null);
  const refresh = useCallback(async () => {
    if (!deckId) { setMedia(null); return; }
    try { setMedia(await listMedia(deckId)); } catch { setMedia(null); }
  }, [deckId]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { media, refresh };
}
```

- [ ] **Step 3: Implement `components/editor/SoundtrackSettings.tsx`**

```tsx
"use client";
import { useContext, useRef, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { uploadMedia } from "@/lib/api/media-client";
import { DeckMediaContext } from "@/lib/editor/use-deck-media";
import { useSoundtrack } from "@/lib/audio/use-soundtrack";
import { loadSoundtrack, type Soundtrack } from "@/lib/audio/soundtrack";
import { formatClock } from "@/lib/timing/clock-format";

/** Deck settings → Soundtrack: one pre-mixed track (spec §5). Remove drops the reference only —
 *  the file stays in the media store so Undo can bring it back. */
export function SoundtrackSettings({ loadTrack = loadSoundtrack }: { loadTrack?: (url: string) => Promise<Soundtrack> }) {
  const doc = useEditor((s) => s.doc);
  const updateMeta = useEditor((s) => s.updateMeta);
  const { media, refresh } = useContext(DeckMediaContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const mediaId = doc?.meta.soundtrack?.media;
  const sound = useSoundtrack(doc?.meta.id ?? null, mediaId, loadTrack);
  if (!doc) return null;
  const name = media?.find((m) => m.id === mediaId)?.name ?? mediaId;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const info = await uploadMedia(doc.meta.id, file);
      if (info.id !== mediaId) updateMeta("soundtrack", { media: info.id });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 12, marginBottom: 6 }}>Soundtrack</div>
      <input ref={input} data-testid="soundtrack-upload" type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac"
        style={{ display: mediaId ? "none" : "block", fontSize: 11 }} disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} />
      {!mediaId && <div style={{ fontSize: 10, opacity: 0.6 }}>One pre-mixed track for the whole deck. MP3, M4A or WAV play everywhere.</div>}
      {mediaId && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          <span data-testid="soundtrack-name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
          <span data-testid="soundtrack-duration" style={{ opacity: 0.7 }}>
            {sound.status === "ready" ? formatClock(sound.track.duration, { tenths: false }) : sound.status === "loading" ? "…" : "?"}
          </span>
          <button className="ed__pill ed__pill--ghost" data-testid="soundtrack-replace" disabled={busy} onClick={() => input.current?.click()}>Replace</button>
          <button className="ed__pill ed__pill--ghost" data-testid="soundtrack-remove" disabled={busy} onClick={() => updateMeta("soundtrack", undefined)}>Remove</button>
        </div>
      )}
      {busy && <div style={{ fontSize: 11, opacity: 0.7 }}>Uploading…</div>}
      {error && <div data-testid="soundtrack-error" style={{ fontSize: 11, color: "#e0614f" }}>{error}</div>}
    </div>
  );
}
```

(Replacing with a different file sets the new id; replacing with the identical file is a no-op — same content hash.)

- [ ] **Step 4: Wire it up.**
  - `DeckSettings.tsx`: render `<SoundtrackSettings />` after `<TimingFields …/>`.
  - `use-lint.ts`: `export function useLint(ctx?: LintContext)`; memo deps `[doc, ctx?.mediaIds, ctx?.soundtrackSec]`; call `lintDeck(doc, ctx)`.
  - `app/editor/page.tsx`: `const deckMedia = useDeckMediaState(deckId);` `const sound = useSoundtrack(deckId, doc?.meta.soundtrack?.media);` `const lintCtx = useMemo(() => ({ mediaIds: deckMedia.media?.map((m) => m.id), soundtrackSec: sound.status === "ready" ? sound.track.duration : undefined }), [deckMedia.media, sound]);` `const issues = useLint(lintCtx);` and wrap the returned tree in `<DeckMediaContext.Provider value={deckMedia}>`.
  - `DeckRuler.tsx`: optional `loadTrack` prop; `const sound = useSoundtrack(doc?.meta.id ?? null, doc?.meta.soundtrack?.media, loadTrack ?? loadSoundtrack);` pass `peaks`/`peaksDuration` from a ready track, `markers={doc.meta.markers}`, and `onMarkerClick={onScrub}` to `TimeBar`. (Hooks must run before the early returns — move the `useSoundtrack` call above them.)

- [ ] **Step 5: Run** the three new tests + `tests/unit/deck-settings-timing.test.tsx`, `tests/unit/deck-ruler.test.tsx`, `tests/unit/lint*.test.ts` → PASS; `npm test`; `tsc`.

- [ ] **Step 6: Commit**

```bash
git add components/editor/SoundtrackSettings.tsx lib/editor/use-deck-media.ts components/editor/DeckSettings.tsx components/editor/DeckRuler.tsx lib/editor/use-lint.ts app/editor/page.tsx tests/unit/soundtrack-settings.test.tsx tests/unit/deck-ruler-soundtrack.test.tsx tests/unit/use-lint-ctx.test.tsx
git commit -m "feat(editor): soundtrack upload/replace/remove, ruler waveform, lint context"
```

---

### Task 10: Editor — cue markers

**Files:**
- Modify: `lib/editor/mutations.ts`, `lib/editor/store.ts`, `lib/timing/clock-format.ts`
- Create: `components/editor/MarkerSettings.tsx`
- Modify: `components/editor/DeckSettings.tsx`, `components/editor/DeckRuler.tsx`
- Test: `tests/unit/marker-mutations.test.ts`, `tests/unit/marker-settings.test.tsx`, `tests/unit/clock-format.test.ts` (append)

**Interfaces:**
- Consumes: `DeckMarker` (Task 4).
- Produces:

```ts
// mutations.ts (each returns the SAME doc reference on a no-op)
export function addMarker(doc: DeckDoc, t: number): { doc: DeckDoc; id: string };  // label "marker N", id "mN" unique
export function updateMarker(doc: DeckDoc, id: string, patch: Partial<Pick<DeckMarker, "label" | "t">>): DeckDoc;
export function deleteMarker(doc: DeckDoc, id: string): DeckDoc;                     // removes `markers` when the list empties
// store.ts
addMarker: (t: number) => void; updateMarker: (id: string, patch: Partial<Pick<DeckMarker, "label" | "t">>) => void; deleteMarker: (id: string) => void;
// clock-format.ts
export function parseClock(text: string, opts?: { allowZero?: boolean }): number | null;
```

Test ids: `add-marker` (ruler button), `marker-row` (per marker, sorted by t), `marker-label`, `marker-time`, `marker-delete`.

- [ ] **Step 1: Failing tests.**

`tests/unit/marker-mutations.test.ts`:

```ts
import { expect, test } from "vitest";
import { addMarker, updateMarker, deleteMarker } from "@/lib/editor/mutations";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [] });

test("addMarker creates unique ids and numbered labels", () => {
  const a = addMarker(base(), 4.123);
  expect(a.doc.meta.markers).toEqual([{ id: "m1", label: "marker 1", t: 4.12 }]);
  const b = addMarker(a.doc, 10);
  expect(b.id).toBe("m2");
  expect(b.doc.meta.markers![1]).toEqual({ id: "m2", label: "marker 2", t: 10 });
});

test("updateMarker patches; identical values are a no-op (same reference)", () => {
  const { doc } = addMarker(base(), 1);
  const renamed = updateMarker(doc, "m1", { label: "drop" });
  expect(renamed.meta.markers![0].label).toBe("drop");
  expect(updateMarker(renamed, "m1", { label: "drop" })).toBe(renamed);
  expect(updateMarker(renamed, "nope", { t: 2 })).toBe(renamed);
});

test("deleteMarker removes it, and the field when the list empties", () => {
  const { doc } = addMarker(base(), 1);
  const gone = deleteMarker(doc, "m1");
  expect(gone.meta.markers).toBeUndefined();
  expect(deleteMarker(gone, "m1")).toBe(gone);
});
```

Append to `tests/unit/clock-format.test.ts`:

```ts
test("parseClock allowZero", () => {
  expect(parseClock("0")).toBeNull();
  expect(parseClock("0", { allowZero: true })).toBe(0);
  expect(parseClock("0:00", { allowZero: true })).toBe(0);
  expect(parseClock("0:40.2", { allowZero: true })).toBeCloseTo(40.2);
  expect(parseClock("-1", { allowZero: true })).toBeNull();
});
```

`tests/unit/marker-settings.test.tsx` — load a deck with markers `[{m2,"b",10},{m1,"a",2}]`; render `<MarkerSettings />`; assert rows are sorted by `t` (`a` first); change a label input to "drop" + blur → store updated and `past.length` +1; blur without change → `past.length` unchanged; time input "0:05" + blur → `t` 5; "nonsense" + blur → reverts, no history; delete → marker gone. Then render `<DeckRuler>` for a timed deck (with the existing `canvasRef`/`beatT` props), click `add-marker` with the ruler at the selected beat's time → a marker appears at that `T`.

- [ ] **Step 2: Implement** `parseClock(text, opts = {})`: keep the regex; change the final line to `return Number.isFinite(v) && (v > 0 || (opts.allowZero && v === 0)) ? v : null;`.

Mutations (in `lib/editor/mutations.ts`, import `type DeckMarker`):

```ts
function withMarkers(doc: DeckDoc, markers: DeckMarker[]): DeckDoc {
  const meta = { ...doc.meta };
  if (markers.length) meta.markers = markers; else delete meta.markers;
  return { ...doc, meta };
}

export function addMarker(doc: DeckDoc, t: number): { doc: DeckDoc; id: string } {
  const list = doc.meta.markers ?? [];
  let n = list.length + 1;
  while (list.some((m) => m.id === `m${n}`)) n++;
  const id = `m${n}`;
  return { id, doc: withMarkers(doc, [...list, { id, label: `marker ${n}`, t: Math.round(Math.max(0, t) * 100) / 100 }]) };
}

export function updateMarker(doc: DeckDoc, id: string, patch: Partial<Pick<DeckMarker, "label" | "t">>): DeckDoc {
  const list = doc.meta.markers ?? [];
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return doc;
  const next = { ...list[i], ...patch };
  if (next.label === list[i].label && next.t === list[i].t) return doc;
  return withMarkers(doc, list.map((m, j) => (j === i ? next : m)));
}

export function deleteMarker(doc: DeckDoc, id: string): DeckDoc {
  const list = doc.meta.markers ?? [];
  if (!list.some((m) => m.id === id)) return doc;
  return withMarkers(doc, list.filter((m) => m.id !== id));
}
```

Store actions (in `lib/editor/store.ts`, alongside `setSceneDuration`):

```ts
  addMarker: (t) => set((s) => commit(s, (doc) => addMarker(doc, t).doc)),
  updateMarker: (id, patch) => set((s) => commit(s, (doc) => updateMarker(doc, id, patch))),
  deleteMarker: (id) => set((s) => commit(s, (doc) => deleteMarker(doc, id))),
```

(name-clash: import the mutations as `addMarker as addMarkerTo`, etc.)

`components/editor/MarkerSettings.tsx` — a list sorted by `t`; each row: a label `<input data-testid="marker-label">` (draft state, commit on blur/Enter via `updateMarker(id, { label })` only when trimmed non-empty, ≤ 40 chars and changed; otherwise reset the draft), a time `<input data-testid="marker-time">` showing `formatClock(t)` (commit via `parseClock(draft, { allowZero: true })`, reset on null or unchanged), and `<button data-testid="marker-delete">✕</button>`. Use the same draft/resync pattern as `TimingFields` in `DeckSettings.tsx` (read it). Render `<MarkerSettings />` in `DeckSettings.tsx` under the soundtrack section with a "Markers" heading and a hint "Add markers from the deck ruler (+ Marker)."

`DeckRuler.tsx` — add `<button className="ed__pill ed__pill--ghost" data-testid="add-marker" onClick={() => addMarker(T)}>+ Marker</button>` before the Play-from-here link.

- [ ] **Step 3: Run** the new/changed test files + `tests/unit/deck-ruler.test.tsx` → PASS; `npm test`; `tsc`.

- [ ] **Step 4: Commit**

```bash
git add lib/editor/mutations.ts lib/editor/store.ts lib/timing/clock-format.ts components/editor/MarkerSettings.tsx components/editor/DeckSettings.tsx components/editor/DeckRuler.tsx tests/unit/marker-mutations.test.ts tests/unit/marker-settings.test.tsx tests/unit/clock-format.test.ts
git commit -m "feat(editor): deck-time cue markers (add from ruler, edit in Deck settings)"
```

---

### Task 11: End-to-end soundtrack flow + docs

**Files:**
- Create: `e2e/soundtrack.spec.ts`
- Modify: `README.md` ("Timed decks & the Player" section)
- Modify: `docs/superpowers/specs/2026-10-23-soundtrack-design.md` §5 (the "+ Marker focuses its label" line → "+ Marker adds `marker N` at the ruler time; rename it in Deck settings", matching what Task 10 built)

- [ ] **Step 1: Write the e2e** — `e2e/soundtrack.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

const id = "e2e-soundtrack";

/** A mono 16-bit PCM WAV: `secs` of a 440 Hz sine at 8 kHz. */
function sineWav(secs: number): Buffer {
  const rate = 8000, n = rate * secs, data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

test("upload a soundtrack, see its waveform, and play it in the Player", async ({ page, request }) => {
  await request.delete(`/api/decks/${id}`).catch(() => {});
  await request.post("/api/decks", { data: { id, title: "Soundtrack" } });
  const up = await request.post(`/api/decks/${id}/media`, { multipart: { file: { name: "tone.wav", mimeType: "audio/wav", buffer: sineWav(3) } } });
  expect(up.status()).toBe(201);
  const media = await up.json();
  const doc = { version: 1, meta: { id, title: "Soundtrack", timing: { targetSec: 3 }, soundtrack: { media: media.id },
    markers: [{ id: "m1", label: "drop", t: 1.5 }] }, scenes: [
    { id: "s", durationSec: 3, beats: [{ id: "b", timeline: [{ kind: "text", value: "Hello", in: "fade" }, { kind: "wait", ms: 1000 }] }] },
  ] };
  expect((await request.put(`/api/decks/${id}`, { data: doc })).status()).toBe(200);

  // Editor: settings show the track, the ruler draws the waveform + marker.
  await page.goto(`/editor?deck=${id}`);
  await page.getByTestId("deck-settings-toggle").click();
  await expect(page.getByTestId("soundtrack-name")).toHaveText("tone.wav");
  await expect(page.getByTestId("soundtrack-duration")).toHaveText("0:03");
  await expect(page.getByTestId("deck-ruler").getByTestId("timebar-waveform")).toBeVisible();
  await expect(page.getByTestId("deck-ruler").getByTestId("timebar-marker")).toHaveAttribute("title", "drop");

  // Player: waveform, no error notice, and Play advances the clock off the audio.
  await page.goto(`/play?deck=${id}`);
  await expect(page.getByTestId("play-scrub").getByTestId("timebar-waveform")).toBeVisible();
  await expect(page.getByTestId("play-audio-status")).toHaveCount(0);
  await page.keyboard.press(" ");
  await expect.poll(async () => (await page.getByTestId("play-clock").textContent()) ?? "", { timeout: 5000 })
    .toMatch(/^0:0[1-3]\.\d/);

  await request.delete(`/api/decks/${id}`);
  expect((await request.get(`/api/decks/${id}/media/${media.id}`)).status()).toBe(404); // media went with the deck
});

test("a missing soundtrack file plays silently with a notice", async ({ page, request }) => {
  const missing = "e2e-soundtrack-missing";
  await request.delete(`/api/decks/${missing}`).catch(() => {});
  await request.post("/api/decks", { data: { id: missing, title: "Missing" } });
  await request.put(`/api/decks/${missing}`, { data: { version: 1, meta: { id: missing, title: "Missing", soundtrack: { media: "ffffffffffffffff.mp3" } },
    scenes: [{ id: "s", durationSec: 2, beats: [{ id: "b", timeline: [{ kind: "wait", ms: 500 }] }] }] } });
  await page.goto(`/play?deck=${missing}`);
  await expect(page.getByTestId("play-audio-status")).toHaveText("Soundtrack unavailable — playing silent");
  await page.keyboard.press(" ");
  await expect.poll(async () => (await page.getByTestId("play-clock").textContent()) ?? "").not.toBe("0:00.0 / 0:02");
  await request.delete(`/api/decks/${missing}`);
});
```

- [ ] **Step 2: Run** `npm run test:e2e -- e2e/soundtrack.spec.ts --project=default` (with `LD_LIBRARY_PATH`) → PASS. Then the full suite `npm run test:e2e` → all pass except the known `library.spec.ts:46` EXDEV.

- [ ] **Step 3: Docs.** README "Timed decks & the Player": add a "Soundtrack" paragraph — Deck settings → Soundtrack → Upload audio (one pre-mixed track, MP3/M4A/WAV recommended, max 200 MB by default via `MORGANA_MEDIA_MAX_MB`); it plays from 0:00 in the Player (M mutes); the waveform and "+ Marker" cue markers on the ruler help line scenes up with the music; uploads are stored per deck under `MORGANA_DATA_DIR/media/<deckId>/` and deleted with the deck. Apply the one-line spec §5 correction listed above.

- [ ] **Step 4: Commit**

```bash
git add e2e/soundtrack.spec.ts README.md docs/superpowers/specs/2026-10-23-soundtrack-design.md
git commit -m "test(e2e): soundtrack upload → waveform → audio-clocked playback; docs"
```

---

## Self-review notes (plan author)

- Spec coverage: §1 Web Audio clock → T1/T8; §2 media store → T2, routes/client → T3, deck-delete cleanup → T2; §3 format → T4, lint → T5; §4.1 module → T1, §4.2 Player → T8, §4.3 TimeBar → T7; §5 editor → T9 (soundtrack, ruler waveform, lint ctx) + T10 (markers); §6 MCP → T6; §7 export contract → stored original bytes (T2) — nothing else to build; §8 tests across tasks; §10 risks: upload size (T3 Content-Length precheck + formData), decode failure path (T8, T11).
- Deviation: spec §5 "+ Marker focuses its label" simplified to a numbered label renamed in Deck settings (the ruler and the settings panel live in different parts of the page); T11 corrects the spec line.
