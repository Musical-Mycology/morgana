# Morgana — Plan 3a: Editor Shell & Read-Only Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the editor's four-zone shell and a working **read-only viewer**: load a deck from `/api/decks`, navigate beats in a filmstrip, render the selected beat in a bounded **iframe canvas** (true WYSIWYG via the engine), and scrub/play its timeline. This proves the shell + the canvas-containment architecture before any editing is built (Plan 3b).

**Architecture:**
- **State:** a small **Zustand** store (`lib/editor/store.ts`) holds the loaded `DeckDoc`, the flattened beat list, and the current selection. (Editing + undo arrive in 3b.)
- **Canvas = iframe.** The engine assumes it *is* the viewport (`position:fixed`, and crucially text sized in `vmin`). Rendering it into a non-fullscreen panel in the same document would mis-size type and break WYSIWYG. So the canvas is an **`<iframe src="/canvas-frame">`** sized to a 16:9 panel: inside the iframe the engine's `vw/vh/vmin` resolve to the panel's dimensions → pixel-accurate preview, **zero engine changes**, full style isolation. The parent drives it over `postMessage` (`load`/`seek`/`play`/`pause`); the frame reports playhead time back. The frame renders via Plan 1's `renderBeatAt` (text + art today; 3b's effect-descriptor registry generalizes it to every action kind).
- **Coverage note:** `renderBeatAt` currently covers text + art; the committed `samples/demo.deck.json` is text-only, so 3a renders it **completely**. Richer action kinds (counter/media/notes under scrub) light up in 3b.

**Tech Stack:** Next.js 15, React 19, TypeScript, **Zustand** (new dep), Vitest, Playwright (incl. `frameLocator` for iframe assertions). Builds on Plan 1 (`BeatStage`, `engine/authoring/seek.ts`) + Plan 2 (`/api/decks`, `DeckDoc`, `samples/demo.deck.json`).

**Working dir:** `/Users/chris/projects/morgana` (`MG`). All paths repo-relative.

> **RUN ON: MYCOLOGICAL** for all shell blocks.

---

## File Structure

```
morgana/
  lib/api/decks-client.ts          # NEW: fetch wrappers over /api/decks (T1)
  lib/editor/store.ts              # NEW: Zustand store — doc, flattened beats, selection (T2)
  lib/editor/flatten-beats.ts      # NEW: DeckDoc → [{sceneId, beat}] (T2)
  lib/canvas/protocol.ts           # NEW: typed postMessage protocol (T3)
  app/canvas-frame/page.tsx        # NEW: the iframe document — renderBeatAt driven by postMessage (T3)
  components/editor/CanvasFrame.tsx# NEW: parent iframe host + imperative seek/play/pause (T3)
  components/editor/Filmstrip.tsx  # NEW: read-only beat list (T5)
  components/editor/Timeline.tsx   # NEW: read-only action blocks + scrub + play/pause (T6)
  components/editor/Inspector.tsx  # NEW: placeholder panel for 3a (T4)
  app/editor/page.tsx              # NEW: the 4-zone shell + demo-deck loader (T4)
  app/editor/editor.css            # NEW: grid layout (T4)
  package.json                     # MODIFY: add zustand (T2)
  tests/unit/{decks-client,flatten-beats,store}.test.ts
  e2e/{canvas-frame,editor}.spec.ts
```

---

## Task 0: Branch from `main`
- [ ] **Step 1**
```bash
cd /Users/chris/projects/morgana
git checkout main && git pull --ff-only origin main
git checkout -b plan-3a-editor-shell && git push -u origin plan-3a-editor-shell
```

---

## Task 1: API client

**Files:** Create `lib/api/decks-client.ts`, `tests/unit/decks-client.test.ts`

- [ ] **Step 1 (TDD): `tests/unit/decks-client.test.ts`**
```ts
import { afterEach, expect, test, vi } from "vitest";
import { listDecks, loadDeck } from "@/lib/api/decks-client";
import type { DeckDoc } from "@/engine/deck-doc";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
}

test("listDecks GETs /api/decks and returns the metas", async () => {
  stubFetch(200, [{ id: "demo", title: "Demo" }]);
  expect(await listDecks()).toEqual([{ id: "demo", title: "Demo" }]);
  expect(fetch).toHaveBeenCalledWith("/api/decks", expect.objectContaining({ method: "GET" }));
});

test("loadDeck GETs /api/decks/:id; throws on 404", async () => {
  const doc: DeckDoc = { version: 1, meta: { id: "demo", title: "Demo" }, scenes: [] };
  stubFetch(200, doc);
  expect((await loadDeck("demo")).meta.id).toBe("demo");
  stubFetch(404, { error: "not found" });
  await expect(loadDeck("missing")).rejects.toThrow();
});
```
Run `npm test -- tests/unit/decks-client.test.ts` → fails (module missing). Confirm, then implement.

- [ ] **Step 2: `lib/api/decks-client.ts`**
```ts
import type { DeckDoc, DeckMeta } from "@/engine/deck-doc";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { method: "GET", ...init });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const listDecks = () => req<DeckMeta[]>("/api/decks");
export const loadDeck = (id: string) => req<DeckDoc>(`/api/decks/${id}`);
export const saveDeck = (doc: DeckDoc) =>
  req<{ ok: true }>(`/api/decks/${doc.meta.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
export const createDeck = (meta: { id: string; title: string }) =>
  req<DeckDoc>("/api/decks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(meta) });
export const deleteDeck = (id: string) => req<{ ok: true }>(`/api/decks/${id}`, { method: "DELETE" });
```
Run the test → 2 pass. `npx tsc --noEmit` clean.

- [ ] **Step 3: commit**
```bash
git add -A && git commit -m "feat(editor): typed /api/decks client" && git push
```

---

## Task 2: Zustand deck store + beat flattening

**Files:** Modify `package.json` (add `zustand`); Create `lib/editor/flatten-beats.ts`, `lib/editor/store.ts`, `tests/unit/flatten-beats.test.ts`, `tests/unit/store.test.ts`

- [ ] **Step 1: add zustand** — add `"zustand": "^5.0.2"` to `dependencies`, run `npm install`.

- [ ] **Step 2 (TDD): `tests/unit/flatten-beats.test.ts`**
```ts
import { expect, test } from "vitest";
import { flattenBeats } from "@/lib/editor/flatten-beats";
import type { DeckDoc } from "@/engine/deck-doc";

const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] },
  { id: "s2", beats: [{ id: "c", timeline: [] }] },
] };

test("flattenBeats yields one entry per beat, carrying its sceneId", () => {
  expect(flattenBeats(doc).map((e) => [e.sceneId, e.beat.id])).toEqual([["s1", "a"], ["s1", "b"], ["s2", "c"]]);
});
```

- [ ] **Step 3: `lib/editor/flatten-beats.ts`**
```ts
import type { DeckDoc } from "@/engine/deck-doc";
import type { Beat } from "@/engine/deck/types";

export interface FlatBeat { sceneId: string; beat: Beat; }

export function flattenBeats(doc: DeckDoc): FlatBeat[] {
  return doc.scenes.flatMap((s) => s.beats.map((beat) => ({ sceneId: s.id, beat })));
}
```

- [ ] **Step 4 (TDD): `tests/unit/store.test.ts`**
```ts
import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] },
] };

beforeEach(() => useEditor.setState({ doc: null, beats: [], selected: 0 }));

test("load populates doc + flattened beats and resets selection", () => {
  useEditor.getState().load(doc);
  const s = useEditor.getState();
  expect(s.doc?.meta.id).toBe("d");
  expect(s.beats.map((b) => b.beat.id)).toEqual(["a", "b"]);
  expect(s.selected).toBe(0);
});

test("select clamps to valid range", () => {
  useEditor.getState().load(doc);
  useEditor.getState().select(1); expect(useEditor.getState().selected).toBe(1);
  useEditor.getState().select(99); expect(useEditor.getState().selected).toBe(1); // clamped to last
  useEditor.getState().select(-5); expect(useEditor.getState().selected).toBe(0);
});
```

- [ ] **Step 5: `lib/editor/store.ts`**
```ts
import { create } from "zustand";
import type { DeckDoc } from "@/engine/deck-doc";
import { flattenBeats, type FlatBeat } from "./flatten-beats";

interface EditorState {
  doc: DeckDoc | null;
  beats: FlatBeat[];
  selected: number;
  load: (doc: DeckDoc) => void;
  select: (i: number) => void;
}

export const useEditor = create<EditorState>((set, get) => ({
  doc: null,
  beats: [],
  selected: 0,
  load: (doc) => set({ doc, beats: flattenBeats(doc), selected: 0 }),
  select: (i) => {
    const last = Math.max(0, get().beats.length - 1);
    set({ selected: Math.min(last, Math.max(0, i)) });
  },
}));
```
Run `npm test -- tests/unit/flatten-beats.test.ts tests/unit/store.test.ts` → all pass. `tsc` clean.

- [ ] **Step 6: commit**
```bash
git add -A && git commit -m "feat(editor): zustand deck store + beat flattening" && git push
```

---

## Task 3: The iframe canvas (THE RISK — spike it here)

**Files:** Create `lib/canvas/protocol.ts`, `app/canvas-frame/page.tsx`, `components/editor/CanvasFrame.tsx`, `e2e/canvas-frame.spec.ts`

- [ ] **Step 1: typed protocol `lib/canvas/protocol.ts`**
```ts
import type { Beat } from "@/engine/deck/types";

export const CANVAS_ORIGIN_TAG = "morgana-canvas";
export const EDITOR_ORIGIN_TAG = "morgana-editor";

/** parent → frame */
export type ToFrame =
  | { tag: typeof EDITOR_ORIGIN_TAG; cmd: "load"; sceneId: string; beat: Beat }
  | { tag: typeof EDITOR_ORIGIN_TAG; cmd: "seek"; t: number }
  | { tag: typeof EDITOR_ORIGIN_TAG; cmd: "play" }
  | { tag: typeof EDITOR_ORIGIN_TAG; cmd: "pause" };

/** frame → parent */
export type FromFrame =
  | { tag: typeof CANVAS_ORIGIN_TAG; type: "ready" }
  | { tag: typeof CANVAS_ORIGIN_TAG; type: "time"; t: number; duration: number };
```

- [ ] **Step 2: the iframe document `app/canvas-frame/page.tsx`**
```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { beatDuration, renderBeatAt } from "@/engine/authoring/seek";
import type { Beat } from "@/engine/deck/types";
import { CANVAS_ORIGIN_TAG, EDITOR_ORIGIN_TAG, type ToFrame, type FromFrame } from "@/lib/canvas/protocol";

export default function CanvasFrame() {
  const art = useRef<ArtStageHandle>(null);
  const textHost = useRef<HTMLDivElement>(null);
  const beat = useRef<Beat | null>(null);
  const t = useRef(0);
  const raf = useRef<number | null>(null);
  const [, force] = useState(0);

  const post = (m: FromFrame) => window.parent.postMessage(m, "*");
  const draw = () => { if (textHost.current && beat.current) renderBeatAt(beat.current.timeline, t.current, { textHost: textHost.current, art: art.current }); };

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data as ToFrame;
      if (!m || m.tag !== EDITOR_ORIGIN_TAG) return;
      const dur = beat.current ? beatDuration(beat.current.timeline) : 0;
      if (m.cmd === "load") { beat.current = m.beat; t.current = 0; cancel(); draw(); force((n) => n + 1); post({ tag: CANVAS_ORIGIN_TAG, type: "time", t: 0, duration: beatDuration(m.beat.timeline) }); }
      else if (m.cmd === "seek") { cancel(); t.current = Math.max(0, Math.min(dur, m.t)); draw(); post({ tag: CANVAS_ORIGIN_TAG, type: "time", t: t.current, duration: dur }); }
      else if (m.cmd === "play") { play(); }
      else if (m.cmd === "pause") { cancel(); }
    };
    function cancel() { if (raf.current != null) cancelAnimationFrame(raf.current); raf.current = null; }
    function play() {
      cancel();
      const dur = beat.current ? beatDuration(beat.current.timeline) : 0;
      let last = performance.now();
      const step = (now: number) => {
        t.current = Math.min(dur, t.current + (now - last) / 1000); last = now;
        draw(); post({ tag: CANVAS_ORIGIN_TAG, type: "time", t: t.current, duration: dur });
        if (t.current < dur) raf.current = requestAnimationFrame(step); else raf.current = null;
      };
      raf.current = requestAnimationFrame(step);
    }
    window.addEventListener("message", onMsg);
    post({ tag: CANVAS_ORIGIN_TAG, type: "ready" });
    return () => { window.removeEventListener("message", onMsg); cancel(); };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--color-mm-dark-brown)", overflow: "hidden" }}>
      <ArtStage ref={art} nightlight={0.6} reduced={false} transparentBg />
      <div className="cin"><div className="cin__stage"><div ref={textHost} className="cin__text" data-testid="frame-text" /></div></div>
    </div>
  );
}
```
> `performance.now()` is allowed here (browser runtime, not a workflow script). The frame fills its own viewport (the iframe) — so the engine's `vw/vh/vmin` resolve to the panel size. That is the whole point.

- [ ] **Step 3: parent host `components/editor/CanvasFrame.tsx`**
```tsx
"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { FlatBeat } from "@/lib/editor/flatten-beats";
import { EDITOR_ORIGIN_TAG, CANVAS_ORIGIN_TAG, type ToFrame, type FromFrame } from "@/lib/canvas/protocol";

export interface CanvasHandle { seek: (t: number) => void; play: () => void; pause: () => void; }

export const CanvasFrame = forwardRef<CanvasHandle, { flat: FlatBeat | null; onTime?: (t: number, duration: number) => void }>(
  function CanvasFrame({ flat, onTime }, ref) {
    const iframe = useRef<HTMLIFrameElement>(null);
    const ready = useRef(false);
    const send = (m: ToFrame) => iframe.current?.contentWindow?.postMessage(m, "*");

    useImperativeHandle(ref, () => ({
      seek: (t) => send({ tag: EDITOR_ORIGIN_TAG, cmd: "seek", t }),
      play: () => send({ tag: EDITOR_ORIGIN_TAG, cmd: "play" }),
      pause: () => send({ tag: EDITOR_ORIGIN_TAG, cmd: "pause" }),
    }));

    useEffect(() => {
      const onMsg = (e: MessageEvent) => {
        const m = e.data as FromFrame;
        if (m?.tag !== CANVAS_ORIGIN_TAG) return;
        if (m.type === "ready") { ready.current = true; if (flat) send({ tag: EDITOR_ORIGIN_TAG, cmd: "load", sceneId: flat.sceneId, beat: flat.beat }); }
        else if (m.type === "time") onTime?.(m.t, m.duration);
      };
      window.addEventListener("message", onMsg);
      return () => window.removeEventListener("message", onMsg);
    }, [flat, onTime]);

    useEffect(() => { if (ready.current && flat) send({ tag: EDITOR_ORIGIN_TAG, cmd: "load", sceneId: flat.sceneId, beat: flat.beat }); }, [flat]);

    return (
      <div style={{ width: "100%", aspectRatio: "16 / 9", maxHeight: "100%", margin: "auto", boxShadow: "0 4px 24px rgba(0,0,0,0.4)" }}>
        <iframe ref={iframe} src="/canvas-frame" title="deck canvas" style={{ width: "100%", height: "100%", border: 0, display: "block" }} />
      </div>
    );
  },
);
```

- [ ] **Step 4: e2e `e2e/canvas-frame.spec.ts`** — proves the iframe renders a beat, proportioned, and scrubs. Use a tiny harness page `app/dev/canvas/page.tsx`:
```tsx
// app/dev/canvas/page.tsx
"use client";
import { useRef } from "react";
import { CanvasFrame, type CanvasHandle } from "@/components/editor/CanvasFrame";
import type { FlatBeat } from "@/lib/editor/flatten-beats";

const flat: FlatBeat = { sceneId: "s", beat: { id: "b", timeline: [
  { kind: "text", value: "Frame copy one", in: "flyUp" },
  { kind: "wait", ms: 300 },
  { kind: "text", value: "Frame copy two", in: "fade" },
] } };

export default function Page() {
  const c = useRef<CanvasHandle>(null);
  return (
    <div style={{ position: "fixed", inset: 0, padding: 40, background: "#222" }}>
      <div style={{ width: 480 }}><CanvasFrame ref={c} flat={flat} /></div>
      <button data-testid="seek-end" onClick={() => c.current?.seek(99)}>seek end</button>
    </div>
  );
}
```
```ts
// e2e/canvas-frame.spec.ts
import { expect, test } from "@playwright/test";

test("iframe canvas renders a beat at panel size and scrubs", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/dev/canvas");
  const frame = page.frameLocator('iframe[title="deck canvas"]');
  // first line present at t=0 (transparent), then revealed after seeking to the end
  await expect(frame.getByText("Frame copy one")).toHaveCount(1);
  await page.getByTestId("seek-end").click();
  await expect(frame.getByText("Frame copy two")).toBeVisible();
  // the iframe is panel-sized (≈480px wide), NOT the full window
  const box = await page.locator('iframe[title="deck canvas"]').boundingBox();
  expect(box!.width).toBeLessThan(520);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 5: verify**
```bash
cd /Users/chris/projects/morgana
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
npx tsc --noEmit && npm test && npm run test:e2e -- e2e/canvas-frame.spec.ts
```
Expected: tsc clean; units green; the canvas e2e passes (text visible after seek, iframe ≈480px wide, no errors). If the iframe content can't be reached, confirm `/canvas-frame` route builds and the `postMessage` tags match. If text is mis-sized, that's the viewport-units issue — confirm the engine is rendering INSIDE the iframe (it should, since `<ArtStage>`/`.cin__stage` live in the frame document).

- [ ] **Step 6: commit**
```bash
git add -A && git commit -m "feat(canvas): iframe-backed WYSIWYG canvas + postMessage protocol (spike)" && git push
```

---

## Task 4: Editor shell (4-zone) + demo-deck loader

**Files:** Create `app/editor/page.tsx`, `app/editor/editor.css`, `components/editor/Inspector.tsx`

- [ ] **Step 1: `app/editor/editor.css`** — CSS grid: toolbar (top), filmstrip (left), canvas (center), inspector (right), timeline (bottom).
```css
.ed { position: fixed; inset: 0; display: grid; grid-template-columns: 200px 1fr 280px; grid-template-rows: 48px 1fr 180px;
  grid-template-areas: "bar bar bar" "film canvas inspector" "film timeline timeline"; background: var(--color-mm-dark-brown); color: var(--color-mm-cream); }
.ed__bar { grid-area: bar; display: flex; align-items: center; gap: 12px; padding: 0 16px; background: #1c130d; font-family: var(--font-display); }
.ed__film { grid-area: film; overflow: auto; border-right: 1px solid rgba(255,255,255,0.1); }
.ed__canvas { grid-area: canvas; display: flex; align-items: center; justify-content: center; padding: 16px; overflow: hidden; }
.ed__inspector { grid-area: inspector; overflow: auto; border-left: 1px solid rgba(255,255,255,0.1); padding: 12px; }
.ed__timeline { grid-area: timeline; border-top: 1px solid rgba(255,255,255,0.1); padding: 12px; }
```

- [ ] **Step 2: `components/editor/Inspector.tsx`** (placeholder for 3a)
```tsx
"use client";
export function Inspector() {
  return <div className="ed__inspector"><p style={{ opacity: 0.6 }}>Select an action to edit (coming in 3b).</p></div>;
}
```

- [ ] **Step 3: `app/editor/page.tsx`** — the shell; loads the demo deck via the API client into the store on mount.
```tsx
"use client";
import { useEffect } from "react";
import "./editor.css";
import { useEditor } from "@/lib/editor/store";
import { loadDeck } from "@/lib/api/decks-client";
import { Filmstrip } from "@/components/editor/Filmstrip";
import { Timeline } from "@/components/editor/Timeline";
import { Inspector } from "@/components/editor/Inspector";

export default function Editor() {
  const doc = useEditor((s) => s.doc);
  const load = useEditor((s) => s.load);
  useEffect(() => {
    // seed the demo deck into the store on first load (the volume must contain it — see step 4)
    loadDeck("demo").then(load).catch(() => {/* no demo yet — empty shell */});
  }, [load]);
  return (
    <div className="ed">
      <div className="ed__bar"><strong>Morgana</strong><span style={{ opacity: 0.7 }}>{doc?.meta.title ?? "no deck"}</span></div>
      <Filmstrip />
      <Timeline />
      <Inspector />
    </div>
  );
}
```
> The `Filmstrip`/`Timeline` render into their grid areas via their own root classes (`ed__film`, `ed__timeline`); the canvas lives inside `Timeline`'s sibling — see Task 6 which mounts `CanvasFrame` into `.ed__canvas`. (To keep the canvas mounted once, render it in `page.tsx` between Filmstrip and Timeline — adjust in Task 6.)

- [ ] **Step 4: make the demo deck loadable via the API** — the API reads `${MORGANA_DATA_DIR}/decks`. Add an npm script to seed the committed sample into the dev data dir:
add to `package.json` scripts: `"seed:demo": "mkdir -p data/decks && cp samples/demo.deck.json data/decks/demo.deck.json"`. Run `npm run seed:demo`. (Docker users mount `./data`; this populates it locally.)

- [ ] **Step 5: verify the shell renders** (manually via build) + commit
```bash
cd /Users/chris/projects/morgana && npm run seed:demo && npx tsc --noEmit && npm run build
git add -A && git commit -m "feat(editor): 4-zone shell + demo-deck loader" && git push
```

---

## Task 5: Filmstrip (read-only, store-driven)

**Files:** Create `components/editor/Filmstrip.tsx`

- [ ] **Step 1: `components/editor/Filmstrip.tsx`**
```tsx
"use client";
import { useEditor } from "@/lib/editor/store";

export function Filmstrip() {
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const select = useEditor((s) => s.select);
  return (
    <div className="ed__film" data-testid="filmstrip">
      {beats.map((b, i) => (
        <button key={`${b.sceneId}-${b.beat.id}-${i}`} onClick={() => select(i)}
          aria-current={i === selected}
          style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", border: 0,
            borderBottom: "1px solid rgba(255,255,255,0.08)", cursor: "pointer",
            background: i === selected ? "rgba(212,168,67,0.22)" : "transparent", color: "inherit", fontFamily: "var(--font-body)" }}>
          <span style={{ opacity: 0.6, marginRight: 8 }}>{String(i + 1).padStart(2, "0")}</span>
          <span style={{ opacity: 0.5 }}>{b.sceneId} ·</span> {b.beat.id}
        </button>
      ))}
    </div>
  );
}
```
- [ ] **Step 2: verify + commit** — `npx tsc --noEmit && npm run build`; then `git add -A && git commit -m "feat(editor): read-only filmstrip" && git push`.

---

## Task 6: Canvas wiring + Timeline (scrub + play/pause)

**Files:** Create `components/editor/Timeline.tsx`; Modify `app/editor/page.tsx` to mount `CanvasFrame` for the selected beat

- [ ] **Step 1: mount the canvas in `app/editor/page.tsx`** — between `<Filmstrip />` and `<Timeline />`, add a canvas zone bound to the selected beat, with a ref shared to the Timeline. Simplest: lift a `CanvasHandle` ref into `page.tsx`, render `<div className="ed__canvas"><CanvasFrame ref={canvasRef} flat={selectedFlat} onTime={...}/></div>`, and pass `canvasRef` to `<Timeline canvasRef={canvasRef} />`. Compute `selectedFlat = beats[selected] ?? null`.
```tsx
// additions in app/editor/page.tsx
import { useRef, useState } from "react";
import { CanvasFrame, type CanvasHandle } from "@/components/editor/CanvasFrame";
// ...inside Editor():
const beats = useEditor((s) => s.beats);
const selected = useEditor((s) => s.selected);
const canvasRef = useRef<CanvasHandle>(null);
const [time, setTime] = useState({ t: 0, duration: 0 });
const selectedFlat = beats[selected] ?? null;
// ...in JSX, between Filmstrip and Timeline:
<div className="ed__canvas"><CanvasFrame ref={canvasRef} flat={selectedFlat} onTime={(t, duration) => setTime({ t, duration })} /></div>
<Timeline canvasRef={canvasRef} time={time} />
```

- [ ] **Step 2: `components/editor/Timeline.tsx`** — read-only action blocks for the selected beat + a scrub range wired to the canvas + play/pause.
```tsx
"use client";
import type { RefObject } from "react";
import { useEditor } from "@/lib/editor/store";
import type { CanvasHandle } from "./CanvasFrame";
import { actionDuration } from "@/engine/authoring/seek";

export function Timeline({ canvasRef, time }: { canvasRef: RefObject<CanvasHandle | null>; time: { t: number; duration: number } }) {
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const flat = beats[selected];
  const timeline = flat?.beat.timeline ?? [];
  return (
    <div className="ed__timeline" data-testid="timeline">
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button onClick={() => canvasRef.current?.play()}>▶ Play</button>
        <button onClick={() => canvasRef.current?.pause()}>⏸ Pause</button>
        <span style={{ opacity: 0.6, alignSelf: "center" }}>{time.t.toFixed(2)}s / {time.duration.toFixed(2)}s</span>
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
        {timeline.map((a, i) => (
          <span key={i} style={{ padding: "2px 8px", borderRadius: 4, background: "rgba(255,255,255,0.1)", fontSize: 12, fontFamily: "var(--font-body)" }}>
            {a.kind}{a.kind === "text" ? `:${a.in}` : ""}{a.kind === "wait" ? ` ${a.ms}ms` : ""} <span style={{ opacity: 0.5 }}>({actionDuration(a).toFixed(1)}s)</span>
          </span>
        ))}
        {!timeline.length && <span style={{ opacity: 0.5 }}>empty beat</span>}
      </div>
      <input type="range" min={0} max={time.duration || 0} step={0.01} value={time.t}
        onChange={(e) => canvasRef.current?.seek(parseFloat(e.target.value))}
        style={{ width: "100%" }} data-testid="scrub" />
    </div>
  );
}
```
- [ ] **Step 3: verify + commit** — `npx tsc --noEmit && npm run build`; `git add -A && git commit -m "feat(editor): wired canvas + read-only timeline (scrub + play/pause)" && git push`.

---

## Task 7: Integration e2e (the read-only viewer flow)

**Files:** Create `e2e/editor.spec.ts`

- [ ] **Step 1: `e2e/editor.spec.ts`** (seed the demo deck into the data dir the dev server uses, then drive the UI)
```ts
import { expect, test } from "@playwright/test";

test("open editor → demo loads → navigate + scrub", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/editor");

  // demo deck has 2 beats in the filmstrip
  const film = page.getByTestId("filmstrip");
  await expect(film.getByRole("button")).toHaveCount(2);

  // select beat 2, scrub to the end, and the second beat's text shows in the canvas iframe
  await film.getByRole("button").nth(1).click();
  const frame = page.frameLocator('iframe[title="deck canvas"]');
  await page.getByTestId("scrub").fill("99");
  await expect(frame.getByText("Scrub the timeline.")).toBeVisible();
  expect(errors).toEqual([]);
});
```
> The Playwright `webServer` must run with the demo deck present. Update `playwright.config.ts`'s `webServer.command` to `npm run seed:demo && npm run build && npm start` (or set `MORGANA_DATA_DIR` to a dir already containing `demo.deck.json`). Range-input `fill` may need the native-setter workaround from Plan 1's spike e2e — reuse it if `fill` errors on the range.

- [ ] **Step 2: verify the full suite**
```bash
cd /Users/chris/projects/morgana
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
npm run seed:demo
npx tsc --noEmit && npm test && npm run test:e2e
```
Expected: tsc clean; all units green; ALL e2e pass (beatstage, spike, chrome, canvas-frame, editor).

- [ ] **Step 3: commit**
```bash
git add -A && git commit -m "feat(editor): read-only viewer integration e2e" && git push
```

---

## Plan 3a Done — Definition of Done
- `/editor` renders the 4-zone shell; the committed demo deck loads via `/api/decks` into a Zustand store.
- The filmstrip lists beats and drives selection; the **iframe canvas** renders the selected beat at panel size (true WYSIWYG, correct type scale) and **scrubs + plays**; the timeline shows the beat's action blocks.
- All unit + e2e green; `npm run build` succeeds. The iframe-canvas architecture (the front-end's #1 risk) is proven.

## Self-Review (completed during authoring)
- **Spec coverage:** delivers the shell + filmstrip + canvas + timeline-scrub halves of spec items 7–11 (the read path). Editing (inspector edits, drag placement, mutations, undo, Deck Settings) is **Plan 3b**.
- **Placeholder scan:** every step ships real code; the only deferred item is `renderBeatAt`'s action-kind coverage (text+art today → all kinds via the 3b registry), called out explicitly. The demo deck is text-only so 3a renders it fully.
- **Type consistency:** `FlatBeat`, `useEditor` store shape, `CanvasHandle`, and the `ToFrame`/`FromFrame` protocol tags are used consistently across the store (T2), canvas (T3), shell (T4), filmstrip (T5), and timeline (T6). `actionDuration`/`beatDuration`/`renderBeatAt` reuse Plan 1's `engine/authoring/seek.ts` exports verbatim.

## What follows — Plan 3b (Editing)
Effect-descriptor registry (schema + `renderAt`/`seekable` per `Action` kind — generalizes the canvas to every kind) · schema-driven Inspector (edit the selected action; a Deck Settings panel over `DeckMeta.chrome`) · canvas direct-manipulation (drag text `pos`, overlay handles mapped to iframe coords) · filmstrip mutations (add/dupe/delete/reorder) · undo/redo (Zustand history) · debounced autosave via `PUT /api/decks/:id`.
