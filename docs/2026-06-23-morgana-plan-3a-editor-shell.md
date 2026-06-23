# Morgana — Plan 3a: Editor Shell & Read-Only Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the editor's four-zone shell and a working **read-only viewer**: load a deck from `/api/decks`, navigate beats in a filmstrip, render the selected beat in a bounded **in-DOM canvas** (true WYSIWYG), and scrub/play its timeline. Proves the shell + the canvas architecture before any editing (Plan 3b).

**Architecture:**
- **State:** a small **Zustand** store (`lib/editor/store.ts`) holds the loaded `DeckDoc`, the flattened beat list, and the current selection. (Editing + undo arrive in 3b.)
- **Canvas = in-DOM, via an engine "container refactor."** The engine was written assuming it *is* the viewport — `position:fixed` and, crucially, text sized in `vmin` — so rendering it into a non-fullscreen panel mis-sizes type. We refactor the (vendored) engine to be **size-agnostic** using **CSS container-query units**: a stage wrapper declares `container-type: size`, and the engine's `vw/vh/vmin` become `cqw/cqh/cqmin` (and `position:fixed`→`absolute`). This is **backward-compatible** — rendered fullscreen, container units equal viewport units, so existing fullscreen renders (`/spike`, `/dev/beatstage`, `/dev/chrome`) are unchanged; rendered in a bounded panel, units resolve to the panel. The editor canvas is then a plain in-DOM `<DeckCanvas>` (no iframe, no postMessage; 3b's drag handles map directly to the same-document stage). The canvas renders via Plan 1's `renderBeatAt` (text + art today; 3b's effect-descriptor registry generalizes it to every action kind).
- **Coverage note:** `renderBeatAt` covers text + art; the committed `samples/demo.deck.json` is text-only, so 3a renders it **completely**. Richer kinds (counter/media/notes) light up in 3b.
- **Browser baseline:** container-query units need Chrome 105+ / Safari 16+ / Firefox 110+ — fine for the Playwright chromium runner and modern targets.

**Tech Stack:** Next.js 15, React 19, TypeScript, **Zustand** (new dep), Vitest, Playwright. Builds on Plan 1 (`BeatStage`, `engine/authoring/seek.ts`) + Plan 2 (`/api/decks`, `DeckDoc`, `samples/demo.deck.json`).

**Working dir:** `/Users/chris/projects/morgana` (`MG`). All paths repo-relative.

> **RUN ON: MYCOLOGICAL** for all shell blocks.

---

## File Structure
```
morgana/
  lib/api/decks-client.ts              # NEW: fetch wrappers over /api/decks (T1)
  lib/editor/flatten-beats.ts          # NEW: DeckDoc → [{sceneId, beat}] (T2)
  lib/editor/store.ts                  # NEW: Zustand store (T2)
  engine/components/layouts/CinematicSlide.tsx  # MODIFY: viewport units → container units (T3)
  engine/authoring/BeatStage.tsx       # MODIFY: container-type + `contained` prop (T3)
  app/spike/page.tsx                   # MODIFY: wrap stage in a container-type host (T3)
  components/editor/DeckCanvas.tsx     # NEW: in-DOM bounded canvas + seek/play/pause ref (T4)
  components/editor/Filmstrip.tsx      # NEW (T6)
  components/editor/Timeline.tsx       # NEW (T7)
  components/editor/Inspector.tsx      # NEW: placeholder (T5)
  app/editor/page.tsx + editor.css     # NEW: 4-zone shell + loader (T5)
  app/dev/canvas/page.tsx              # NEW: DeckCanvas e2e harness (T4)
  package.json                         # MODIFY: add zustand (T2)
  tests/unit/{decks-client,flatten-beats,store}.test.ts
  e2e/{deck-canvas,editor}.spec.ts
```

---

## Task 0: Branch
- [ ] `cd /Users/chris/projects/morgana && git checkout main && git pull --ff-only origin main && git checkout -b plan-3a-editor-shell && git push -u origin plan-3a-editor-shell`

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
test("listDecks GETs /api/decks", async () => {
  stubFetch(200, [{ id: "demo", title: "Demo" }]);
  expect(await listDecks()).toEqual([{ id: "demo", title: "Demo" }]);
  expect(fetch).toHaveBeenCalledWith("/api/decks", expect.objectContaining({ method: "GET" }));
});
test("loadDeck GETs /api/decks/:id; throws on 404", async () => {
  const doc: DeckDoc = { version: 1, meta: { id: "demo", title: "Demo" }, scenes: [] };
  stubFetch(200, doc); expect((await loadDeck("demo")).meta.id).toBe("demo");
  stubFetch(404, { error: "x" }); await expect(loadDeck("missing")).rejects.toThrow();
});
```
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
export const saveDeck = (doc: DeckDoc) => req<{ ok: true }>(`/api/decks/${doc.meta.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
export const createDeck = (meta: { id: string; title: string }) => req<DeckDoc>("/api/decks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(meta) });
export const deleteDeck = (id: string) => req<{ ok: true }>(`/api/decks/${id}`, { method: "DELETE" });
```
- [ ] **Step 3:** `npm test -- tests/unit/decks-client.test.ts` (2 pass), `tsc` clean; commit `feat(editor): typed /api/decks client`.

---

## Task 2: Zustand store + beat flattening
**Files:** Modify `package.json`; Create `lib/editor/flatten-beats.ts`, `lib/editor/store.ts`, `tests/unit/{flatten-beats,store}.test.ts`

- [ ] **Step 1:** add `"zustand": "^5.0.2"` to deps; `npm install`.
- [ ] **Step 2 (TDD): `tests/unit/flatten-beats.test.ts`**
```ts
import { expect, test } from "vitest";
import { flattenBeats } from "@/lib/editor/flatten-beats";
import type { DeckDoc } from "@/engine/deck-doc";
const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] }, { id: "s2", beats: [{ id: "c", timeline: [] }] } ] };
test("one entry per beat, carrying sceneId", () => {
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
const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s1", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] }] };
beforeEach(() => useEditor.setState({ doc: null, beats: [], selected: 0 }));
test("load populates doc + flattened beats", () => {
  useEditor.getState().load(doc);
  expect(useEditor.getState().beats.map((b) => b.beat.id)).toEqual(["a", "b"]);
});
test("select clamps", () => {
  useEditor.getState().load(doc);
  useEditor.getState().select(99); expect(useEditor.getState().selected).toBe(1);
  useEditor.getState().select(-5); expect(useEditor.getState().selected).toBe(0);
});
```
- [ ] **Step 5: `lib/editor/store.ts`**
```ts
import { create } from "zustand";
import type { DeckDoc } from "@/engine/deck-doc";
import { flattenBeats, type FlatBeat } from "./flatten-beats";
interface EditorState {
  doc: DeckDoc | null; beats: FlatBeat[]; selected: number;
  load: (doc: DeckDoc) => void; select: (i: number) => void;
}
export const useEditor = create<EditorState>((set, get) => ({
  doc: null, beats: [], selected: 0,
  load: (doc) => set({ doc, beats: flattenBeats(doc), selected: 0 }),
  select: (i) => { const last = Math.max(0, get().beats.length - 1); set({ selected: Math.min(last, Math.max(0, i)) }); },
}));
```
- [ ] **Step 6:** tests green, `tsc` clean; commit `feat(editor): zustand deck store + beat flattening`.

---

## Task 3: Engine container refactor (THE RISK)

Make the vendored engine size-agnostic so it renders correctly in a bounded panel. **Backward-compatibility is the gate:** the existing fullscreen e2e (`/dev/beatstage`, `/spike`, `/dev/chrome`) MUST still pass unchanged.

**Files:** Modify `engine/components/layouts/CinematicSlide.tsx`, `engine/authoring/BeatStage.tsx`, `app/spike/page.tsx`

- [ ] **Step 1: find every viewport-unit + fixed-position site in the engine**
```bash
cd /Users/chris/projects/morgana
grep -rnE 'position:\s*fixed|[0-9.]+v(w|h|min|max)\b' engine/ | sed 's/^/  /'
```
This is the authoritative list to convert. (Known: `CinematicSlide.tsx` `.cin__stage` uses `position:fixed` + `min(100vw, calc(100vh*16/9))`; investor type uses `vmin` in several `clamp()`s. Verify nothing else.)

- [ ] **Step 2: convert units + positioning in `engine/components/layouts/CinematicSlide.tsx`**
- `.cin__stage`: `position: fixed` → `position: absolute`; `width: min(100vw, calc(100vh * 16 / 9))` → `width: min(100cqw, calc(100cqh * 16 / 9))`; `height: min(100vh, calc(100vw * 9 / 16))` → `height: min(100cqh, calc(100cqw * 9 / 16))`. Keep `inset: 0; margin: auto`.
- Every `vmin` in this file's `<style>` → `cqmin` (the `.cin__line--lg/md/sm` clamps, the panel/caption clamps). Use a scoped replace, then eyeball the diff to confirm only unit suffixes changed:
  ```bash
  cd /Users/chris/projects/morgana && sed -i '' 's/\([0-9.]\)vmin/\1cqmin/g; s/\([0-9.]\)vw/\1cqw/g; s/\([0-9.]\)vh/\1cqh/g' engine/components/layouts/CinematicSlide.tsx
  git diff engine/components/layouts/CinematicSlide.tsx   # review: ONLY unit suffixes + the .cin__stage position changed
  ```
  (Apply the same sed to any OTHER engine file the Step-1 grep flagged.)

- [ ] **Step 3: BeatStage establishes the container + gains a `contained` prop**
In `engine/authoring/BeatStage.tsx`, change the outer wrapper to set `container-type: size` and switch fixed/absolute via a new optional `contained?: boolean` prop (default `false` = fullscreen, preserving current behavior):
```tsx
export function BeatStage({ sceneId, beat, animate = true, entryLayers = [], endLayers = [], chrome, contained = false }: {
  sceneId: string; beat: Beat; animate?: boolean;
  entryLayers?: StoryAsset[]; endLayers?: StoryAsset[]; chrome?: DeckChrome; contained?: boolean;
}) {
  // ...existing refs/runtime...
  return (
    <div data-testid="beatstage" style={{ position: contained ? "absolute" : "fixed", inset: 0, containerType: "size", background: "var(--color-mm-dark-brown)" }}>
      {/* unchanged children */}
    </div>
  );
}
```
> `containerType: "size"` is a valid React inline-style key (React 19 passes unknown CSS props through). With it on BeatStage's wrapper, the engine's `cq*` units resolve to BeatStage's box — which fullscreen == viewport, so `/dev/beatstage` and `/dev/chrome` render identically.

- [ ] **Step 4: give the `/spike` page a container host**
`app/spike/page.tsx` renders `<ArtStage>` + a `.cin .cin__stage` host directly (not via BeatStage). Add `containerType: "size"` to its outer fixed `inset:0` div so the now-`cq`-based `.cin__stage` resolves to the viewport there too (unchanged fullscreen rendering).

- [ ] **Step 5: verify backward-compatibility (the gate)**
```bash
cd /Users/chris/projects/morgana
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
npx tsc --noEmit && npm test && npm run test:e2e
```
Expected: tsc clean; all units green; **ALL existing e2e still pass** (`beatstage`, `spike`, `chrome`) — the fullscreen renders are visually unchanged because `cq* == v*` at viewport size. If the spike text now mis-renders, confirm Step 4's `container-type` host is present (a `cq` unit with NO container ancestor falls back to the small viewport, which is *usually* fine but the explicit container is correct).

- [ ] **Step 6: commit** `feat(engine): container-query units + container-type wrapper — size-agnostic stage (backward-compatible)`.

---

## Task 4: `<DeckCanvas>` — in-DOM bounded canvas

**Files:** Create `components/editor/DeckCanvas.tsx`, `app/dev/canvas/page.tsx`, `e2e/deck-canvas.spec.ts`

- [ ] **Step 1: `components/editor/DeckCanvas.tsx`**
```tsx
"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { beatDuration, renderBeatAt } from "@/engine/authoring/seek";
import type { FlatBeat } from "@/lib/editor/flatten-beats";

export interface CanvasHandle { seek: (t: number) => void; play: () => void; pause: () => void; }

export const DeckCanvas = forwardRef<CanvasHandle, { flat: FlatBeat | null; onTime?: (t: number, duration: number) => void }>(
  function DeckCanvas({ flat, onTime }, ref) {
    const art = useRef<ArtStageHandle>(null);
    const textHost = useRef<HTMLDivElement>(null);
    const t = useRef(0);
    const raf = useRef<number | null>(null);
    const dur = () => (flat ? beatDuration(flat.beat.timeline) : 0);
    const draw = () => { if (textHost.current && flat) renderBeatAt(flat.beat.timeline, t.current, { textHost: textHost.current, art: art.current }); };
    const cancel = () => { if (raf.current != null) cancelAnimationFrame(raf.current); raf.current = null; };

    useImperativeHandle(ref, () => ({
      seek: (to) => { cancel(); t.current = Math.max(0, Math.min(dur(), to)); draw(); onTime?.(t.current, dur()); },
      pause: () => cancel(),
      play: () => {
        cancel();
        let last = performance.now();
        const step = (now: number) => {
          t.current = Math.min(dur(), t.current + (now - last) / 1000); last = now;
          draw(); onTime?.(t.current, dur());
          if (t.current < dur()) raf.current = requestAnimationFrame(step); else raf.current = null;
        };
        raf.current = requestAnimationFrame(step);
      },
    }), [flat, onTime]);

    useEffect(() => { cancel(); t.current = 0; draw(); onTime?.(0, dur()); return cancel; }, [flat]);

    return (
      <div className="ed__canvas-host" style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", maxHeight: "100%", margin: "auto", containerType: "size", overflow: "hidden", background: "var(--color-mm-dark-brown)", boxShadow: "0 4px 24px rgba(0,0,0,0.4)" }}>
        <ArtStage ref={art} nightlight={0.6} reduced={false} transparentBg />
        <div className="cin"><div className="cin__stage"><div ref={textHost} className="cin__text" data-testid="canvas-text" /></div></div>
      </div>
    );
  },
);
```
> `performance.now()` is fine here (browser runtime). The host's `container-type: size` makes the engine's `cq*` units resolve to THIS panel — true WYSIWYG at panel size, in-DOM.

- [ ] **Step 2: harness `app/dev/canvas/page.tsx`**
```tsx
"use client";
import { useRef } from "react";
import { DeckCanvas, type CanvasHandle } from "@/components/editor/DeckCanvas";
import type { FlatBeat } from "@/lib/editor/flatten-beats";
const flat: FlatBeat = { sceneId: "s", beat: { id: "b", timeline: [
  { kind: "text", value: "Canvas copy one", in: "flyUp" }, { kind: "wait", ms: 300 }, { kind: "text", value: "Canvas copy two", in: "fade" } ] } };
export default function Page() {
  const c = useRef<CanvasHandle>(null);
  return (
    <div style={{ position: "fixed", inset: 0, padding: 40, background: "#222" }}>
      <div style={{ width: 480 }}><DeckCanvas ref={c} flat={flat} /></div>
      <button data-testid="seek-end" onClick={() => c.current?.seek(99)}>seek end</button>
    </div>
  );
}
```
- [ ] **Step 3: `e2e/deck-canvas.spec.ts`** — proves a beat renders at panel size in-DOM and scrubs.
```ts
import { expect, test } from "@playwright/test";
test("DeckCanvas renders a beat at panel size and scrubs", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/dev/canvas");
  await expect(page.getByText("Canvas copy one")).toHaveCount(1);
  await page.getByTestId("seek-end").click();
  await expect(page.getByText("Canvas copy two")).toBeVisible();
  // host is the bounded panel (≈480px), and the rendered stage is contained within it (not full-window)
  const host = page.locator(".ed__canvas-host");
  const box = await host.boundingBox();
  expect(box!.width).toBeLessThan(520);
  const stage = page.locator(".cin__stage");
  const sBox = await stage.boundingBox();
  expect(sBox!.width).toBeLessThanOrEqual(box!.width + 1);   // stage fits inside the panel → containerization works
  expect(errors).toEqual([]);
});
```
- [ ] **Step 4: verify**
```bash
cd /Users/chris/projects/morgana && lsof -ti :3000 | xargs kill -9 2>/dev/null || true
npx tsc --noEmit && npm test && npm run test:e2e -- e2e/deck-canvas.spec.ts
```
Expected: the stage fits within the ≈480px panel (proving the cq refactor works in a bounded box), text scrubs in, no errors. If the stage overflows to the window width, the `cq` conversion or the host `container-type` is wrong — fix before proceeding.
- [ ] **Step 5: commit** `feat(canvas): in-DOM bounded DeckCanvas (container-query WYSIWYG) + seek/play/pause`.

---

## Task 5: Editor shell (4-zone) + demo loader
**Files:** Create `app/editor/editor.css`, `components/editor/Inspector.tsx`, `app/editor/page.tsx`; Modify `package.json` (add `seed:demo`)

- [ ] **Step 1: `app/editor/editor.css`**
```css
.ed { position: fixed; inset: 0; display: grid; grid-template-columns: 200px 1fr 280px; grid-template-rows: 48px 1fr 180px;
  grid-template-areas: "bar bar bar" "film canvas inspector" "film timeline timeline"; background: var(--color-mm-dark-brown); color: var(--color-mm-cream); }
.ed__bar { grid-area: bar; display: flex; align-items: center; gap: 12px; padding: 0 16px; background: #1c130d; font-family: var(--font-display); }
.ed__film { grid-area: film; overflow: auto; border-right: 1px solid rgba(255,255,255,0.1); }
.ed__canvas { grid-area: canvas; display: flex; align-items: center; justify-content: center; padding: 16px; overflow: hidden; min-height: 0; min-width: 0; }
.ed__inspector { grid-area: inspector; overflow: auto; border-left: 1px solid rgba(255,255,255,0.1); padding: 12px; }
.ed__timeline { grid-area: timeline; border-top: 1px solid rgba(255,255,255,0.1); padding: 12px; }
```
- [ ] **Step 2: `components/editor/Inspector.tsx`**
```tsx
"use client";
export function Inspector() { return <div className="ed__inspector"><p style={{ opacity: 0.6 }}>Select an action to edit (3b).</p></div>; }
```
- [ ] **Step 3: `app/editor/page.tsx`** (mounts the canvas once; passes a shared ref to the timeline)
```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import "./editor.css";
import { useEditor } from "@/lib/editor/store";
import { loadDeck } from "@/lib/api/decks-client";
import { DeckCanvas, type CanvasHandle } from "@/components/editor/DeckCanvas";
import { Filmstrip } from "@/components/editor/Filmstrip";
import { Timeline } from "@/components/editor/Timeline";
import { Inspector } from "@/components/editor/Inspector";

export default function Editor() {
  const doc = useEditor((s) => s.doc);
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const load = useEditor((s) => s.load);
  const canvasRef = useRef<CanvasHandle>(null);
  const [time, setTime] = useState({ t: 0, duration: 0 });
  useEffect(() => { loadDeck("demo").then(load).catch(() => {}); }, [load]);
  const selectedFlat = beats[selected] ?? null;
  return (
    <div className="ed">
      <div className="ed__bar"><strong>Morgana</strong><span style={{ opacity: 0.7 }}>{doc?.meta.title ?? "no deck"}</span></div>
      <Filmstrip />
      <div className="ed__canvas"><DeckCanvas ref={canvasRef} flat={selectedFlat} onTime={(t, duration) => setTime({ t, duration })} /></div>
      <Timeline canvasRef={canvasRef} time={time} />
      <Inspector />
    </div>
  );
}
```
- [ ] **Step 4: add `seed:demo` script** — `"seed:demo": "mkdir -p data/decks && cp samples/demo.deck.json data/decks/demo.deck.json"`; run `npm run seed:demo`.
- [ ] **Step 5:** `npm run seed:demo && npx tsc --noEmit && npm run build`; commit `feat(editor): 4-zone shell + canvas mount + demo loader`.

---

## Task 6: Filmstrip
**Files:** Create `components/editor/Filmstrip.tsx`
- [ ] **Step 1:**
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
        <button key={`${b.sceneId}-${b.beat.id}-${i}`} onClick={() => select(i)} aria-current={i === selected}
          style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", border: 0, borderBottom: "1px solid rgba(255,255,255,0.08)",
            cursor: "pointer", background: i === selected ? "rgba(212,168,67,0.22)" : "transparent", color: "inherit", fontFamily: "var(--font-body)" }}>
          <span style={{ opacity: 0.6, marginRight: 8 }}>{String(i + 1).padStart(2, "0")}</span>
          <span style={{ opacity: 0.5 }}>{b.sceneId} ·</span> {b.beat.id}
        </button>
      ))}
    </div>
  );
}
```
- [ ] **Step 2:** `tsc` clean, `npm run build`; commit `feat(editor): read-only filmstrip`.

---

## Task 7: Timeline (read-only blocks + scrub + play/pause)
**Files:** Create `components/editor/Timeline.tsx`
- [ ] **Step 1:**
```tsx
"use client";
import type { RefObject } from "react";
import { useEditor } from "@/lib/editor/store";
import type { CanvasHandle } from "./DeckCanvas";
import { actionDuration } from "@/engine/authoring/seek";

export function Timeline({ canvasRef, time }: { canvasRef: RefObject<CanvasHandle | null>; time: { t: number; duration: number } }) {
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const timeline = beats[selected]?.beat.timeline ?? [];
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
        onChange={(e) => canvasRef.current?.seek(parseFloat(e.target.value))} style={{ width: "100%" }} data-testid="scrub" />
    </div>
  );
}
```
- [ ] **Step 2:** `tsc` clean, `npm run build`; commit `feat(editor): read-only timeline (scrub + play/pause)`.

---

## Task 8: Integration e2e
**Files:** Create `e2e/editor.spec.ts`; Modify `playwright.config.ts` (seed demo before serving)
- [ ] **Step 1:** update `playwright.config.ts` `webServer.command` → `"npm run seed:demo && npm run build && npm start"`.
- [ ] **Step 2: `e2e/editor.spec.ts`**
```ts
import { expect, test } from "@playwright/test";
test("open editor → demo loads → navigate + scrub", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/editor");
  const film = page.getByTestId("filmstrip");
  await expect(film.getByRole("button")).toHaveCount(2);            // demo has 2 beats
  await film.getByRole("button").nth(1).click();                   // select beat 2
  const scrub = page.getByTestId("scrub");
  await scrub.evaluate((el: HTMLInputElement) => {                 // native setter (range fill workaround from Plan 1)
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, "99"); el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.getByText("Scrub the timeline.")).toBeVisible(); // beat 2's last line, rendered in the in-DOM canvas
  expect(errors).toEqual([]);
});
```
- [ ] **Step 3: full suite**
```bash
cd /Users/chris/projects/morgana && lsof -ti :3000 | xargs kill -9 2>/dev/null || true
npm run seed:demo && npx tsc --noEmit && npm test && npm run test:e2e
```
Expected: tsc clean; all units green; ALL e2e pass (beatstage, spike, chrome, deck-canvas, editor).
- [ ] **Step 4: commit** `feat(editor): read-only viewer integration e2e`.

---

## Plan 3a Done — Definition of Done
- The vendored engine is **size-agnostic** (container-query units); existing fullscreen e2e unchanged.
- `/editor` renders the 4-zone shell; the committed demo deck loads via `/api/decks` into a Zustand store; the filmstrip drives selection; the **in-DOM canvas** renders the selected beat at panel size (true WYSIWYG) and **scrubs + plays**; the timeline shows action blocks.
- All unit + e2e green; `npm run build` succeeds.

## Self-Review (completed during authoring)
- **Spec coverage:** delivers the shell + filmstrip + canvas + timeline-scrub (the read path) of spec items 7–11. Editing is **Plan 3b**.
- **Placeholder scan:** every step ships real code; the deferred item is `renderBeatAt`'s kind coverage (text+art → all kinds via 3b's registry), called out. Demo deck is text-only → 3a renders it fully.
- **Type consistency:** `FlatBeat`, `useEditor`, `CanvasHandle` used consistently across store (T2), canvas (T4), shell (T5), filmstrip (T6), timeline (T7). `actionDuration`/`beatDuration`/`renderBeatAt` reuse Plan 1's `engine/authoring/seek.ts`. The engine refactor (T3) changes ONLY CSS units + positioning + a `contained` prop — no logic/DOM changes — guarded by the existing e2e staying green.

## What follows — Plan 3b (Editing)
Effect-descriptor registry (schema + `renderAt`/`seekable` per `Action` kind — generalizes the canvas to every kind) · schema-driven Inspector (+ Deck Settings panel over `DeckMeta.chrome`) · canvas direct-manipulation (drag text `pos` via overlay handles mapped to the in-DOM stage — simpler now that there's no iframe boundary) · filmstrip mutations (add/dupe/delete/reorder) · undo/redo (Zustand history) · debounced autosave via `PUT /api/decks/:id`.
