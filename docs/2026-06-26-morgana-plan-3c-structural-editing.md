# Morgana — Plan 3c: Structural Editing & Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the in-memory editor (Plan 3b) into a real one: edits **persist** (debounced autosave), the deck is **structurally editable** (add/dupe/delete/reorder beats & scenes), every change is **undoable**, text/effects can be **dragged into place** on the canvas, and the inspector covers **more effect kinds**.

**Architecture:**
- **History-aware store.** `lib/editor/store.ts` gains an undo/redo stack (`past`/`future` arrays of `DeckDoc`) and a monotonic `revision` counter. Every doc mutation routes through one internal `commit()` helper that records history, re-derives the flattened beats, and bumps `revision`. A no-op producer (returns the same `doc`) records nothing.
- **Pure structural mutations.** `lib/editor/mutations.ts` holds side-effect-free `DeckDoc → DeckDoc` transforms (insert/duplicate/delete/move beat, add/delete scene), unit-tested without the store. The store's structural methods are thin wrappers over `commit()`.
- **Autosave as a hook.** `lib/editor/use-autosave.ts` watches `(doc, revision)` and debounces `saveDeck(doc)` (the existing `PUT /api/decks/:id`). A toolbar status chip shows `idle/saving/saved/error`. The editor page reads `?deck=<id>` (default `demo`) so persistence can be exercised against a throwaway deck without touching the seeded demo.
- **Canvas drag-placement.** The seek-renderer is extended so a text/effect action that carries a `pos` is rendered at that normalized point; the canvas overlays a single draggable handle (its own `pointer-events:auto` layer, because `.cin__stage` is `pointer-events:none`) that writes `pos.x`/`pos.y` back through `updateAction`.
- **Richer inspector.** `lib/editor/registry.ts` gains descriptors for `rotateList`, `counter_*`, and `media*`; `Field` gains a `checkbox` type for booleans (`round`, `dots`).

**Tech Stack:** Next.js 15, React 19, TypeScript, Zustand 5, Vitest (jsdom), Playwright. Builds directly on Plan 3a (`DeckCanvas`, `useEditor`, 4-zone shell) + Plan 3b (registry, schema-driven Inspector, `updateAction`/`updateMeta`).

**Working dir:** `/Users/chris/projects/morgana` (the `MG` worktree). All paths repo-relative.

---

## Scope

This plan implements the **full Plan-3c scope as named at the bottom of Plan 3a/3b**, verbatim:

> Canvas drag-placement (text `pos` handles overlaid on the in-DOM stage) · filmstrip + store structural mutations (add/dupe/delete/reorder beats & scenes) · undo/redo (Zustand history of `doc`) · debounced autosave via `PUT /api/decks/:id` · richer per-kind inspector schemas (counter/media/rotateList) + on-stage handles for notes/counter/media.

Two scope clarifications, both consistent with the design spec's v1 non-goals (§3, §9):

1. **"On-stage handles for notes/counter/media"** is delivered as a **single generic position handle** that appears for any selected action whose schema carries a `pos` (text, `note_emitter`, `counter_show`, `media`). Bespoke per-effect editors (emitter radius/arc, media scale, counter spin) remain **Tier-2** (design §9) — out of scope here.
2. **Timeline action CRUD** (adding/deleting/reordering *actions within a beat*, resizable `wait`s) is **not** in the verbatim 3c note and is **deferred to a small Plan 3d**. 3c makes beats/scenes structural and every existing action editable + draggable; you add new actions in 3c by duplicating a beat and editing it. (Flagged so the reviewer knows it's a deliberate omission, not a miss.)

---

## File Structure

```
morgana/
  lib/editor/flatten-beats.ts        # MODIFY: + beatLocation(doc, flatIdx) helper (T1)
  lib/editor/store.ts                # MODIFY: history (past/future) + revision + commit() (T1); structural methods (T4)
  lib/editor/use-autosave.ts         # NEW: debounced PUT-on-change hook + SaveStatus (T2)
  lib/editor/mutations.ts            # NEW: pure DeckDoc structural transforms (T3)
  lib/api/decks-client.ts            # (unchanged — saveDeck already exists)
  app/editor/page.tsx                # MODIFY: ?deck param, autosave wiring, save-status chip, undo/redo toolbar + keys (T2/T4)
  components/editor/Filmstrip.tsx    # MODIFY: scene grouping + per-beat controls + add-beat/add-scene (T4)
  components/editor/DeckCanvas.tsx   # MODIFY: pos-aware host + drag handle overlay (T5)
  engine/authoring/seek.ts           # MODIFY: applyAt positions posed text/effects (T5)
  components/editor/Field.tsx        # MODIFY: + checkbox field type (T6)
  lib/editor/registry.ts             # MODIFY: + rotateList/counter_*/media* descriptors, checkbox fields (T6)
  tests/unit/{beat-location,store-history,mutations,registry-richer}.test.ts   # NEW
  tests/unit/seek.test.ts            # MODIFY: posed-text rendering assertion (T5)
  e2e/{persistence,structural,drag-pos}.spec.ts                                # NEW
```

---

## Task 0: Branch

- [ ] **Step 1: Cut the branch from up-to-date `main`**

```bash
cd /Users/chris/projects/morgana
git checkout main && git pull --ff-only origin main
git checkout -b plan-3c-structural-editing
git push -u origin plan-3c-structural-editing
```

---

## Task 1: History-aware store (undo/redo + revision)

**Files:**
- Modify: `lib/editor/flatten-beats.ts`
- Modify: `lib/editor/store.ts`
- Test: `tests/unit/beat-location.test.ts` (new), `tests/unit/store-history.test.ts` (new)

The existing `updateAction`/`updateMeta` tests (`tests/unit/store-edit.test.ts`, `tests/unit/store-meta.test.ts`) MUST stay green — they assert `doc`/`beats` only, and the new fields merge in additively.

- [ ] **Step 1: Write the failing test for `beatLocation`**

Create `tests/unit/beat-location.test.ts`:

```ts
import { expect, test } from "vitest";
import { beatLocation } from "@/lib/editor/flatten-beats";
import type { DeckDoc } from "@/engine/deck-doc";

const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] },
  { id: "s2", beats: [{ id: "c", timeline: [] }] },
] };

test("maps a flat beat index to {sceneIdx, beatIdx}", () => {
  expect(beatLocation(doc, 0)).toEqual({ sceneIdx: 0, beatIdx: 0 });
  expect(beatLocation(doc, 1)).toEqual({ sceneIdx: 0, beatIdx: 1 });
  expect(beatLocation(doc, 2)).toEqual({ sceneIdx: 1, beatIdx: 0 });
  expect(beatLocation(doc, 9)).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/beat-location.test.ts`
Expected: FAIL — `beatLocation` is not exported.

- [ ] **Step 3: Add `beatLocation` to `lib/editor/flatten-beats.ts`**

Replace the entire contents of `lib/editor/flatten-beats.ts` with:

```ts
import type { DeckDoc } from "@/engine/deck-doc";
import type { Beat } from "@/engine/deck/types";

export interface FlatBeat { sceneId: string; beat: Beat; }

export function flattenBeats(doc: DeckDoc): FlatBeat[] {
  return doc.scenes.flatMap((s) => s.beats.map((beat) => ({ sceneId: s.id, beat })));
}

/** Map a flat beat index (filmstrip order) back to its scene + in-scene position. */
export function beatLocation(doc: DeckDoc, flatIdx: number): { sceneIdx: number; beatIdx: number } | null {
  let n = 0;
  for (let si = 0; si < doc.scenes.length; si++) {
    for (let bi = 0; bi < doc.scenes[si].beats.length; bi++) {
      if (n === flatIdx) return { sceneIdx: si, beatIdx: bi };
      n++;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/beat-location.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for history**

Create `tests/unit/store-history.test.ts`:

```ts
import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s", beats: [{ id: "b", timeline: [{ kind: "text", value: "hi", in: "fade" }] }] },
] };

beforeEach(() => useEditor.setState({ doc: null, beats: [], selected: 0, selectedAction: null, past: [], future: [], revision: 0 }));

test("load resets history + revision", () => {
  useEditor.getState().load(doc);
  expect(useEditor.getState().revision).toBe(0);
  expect(useEditor.getState().past).toEqual([]);
  expect(useEditor.getState().future).toEqual([]);
});

test("an edit bumps revision and records history; undo/redo round-trips", () => {
  const s = useEditor.getState();
  s.load(doc);
  s.updateAction(0, 0, "value", "bye");
  expect(useEditor.getState().revision).toBe(1);
  expect(useEditor.getState().beats[0].beat.timeline[0]).toMatchObject({ value: "bye" });
  expect(useEditor.getState().past.length).toBe(1);

  useEditor.getState().undo();
  expect(useEditor.getState().beats[0].beat.timeline[0]).toMatchObject({ value: "hi" });
  expect(useEditor.getState().future.length).toBe(1);

  useEditor.getState().redo();
  expect(useEditor.getState().beats[0].beat.timeline[0]).toMatchObject({ value: "bye" });
});

test("undo with empty history is a no-op", () => {
  useEditor.getState().load(doc);
  useEditor.getState().undo();
  expect(useEditor.getState().beats[0].beat.timeline[0]).toMatchObject({ value: "hi" });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/unit/store-history.test.ts`
Expected: FAIL — `past`/`future`/`revision`/`undo`/`redo` do not exist yet.

- [ ] **Step 7: Rewrite `lib/editor/store.ts` with history + `commit()`**

Replace the entire contents of `lib/editor/store.ts` with:

```ts
import { create } from "zustand";
import type { DeckDoc } from "@/engine/deck-doc";
import { flattenBeats, type FlatBeat } from "./flatten-beats";
import { beatLocation } from "./flatten-beats";
import { setPath } from "./paths";

const HISTORY_CAP = 50;

interface EditorState {
  doc: DeckDoc | null;
  beats: FlatBeat[];
  selected: number;
  selectedAction: number | null;
  past: DeckDoc[];
  future: DeckDoc[];
  revision: number;
  load: (doc: DeckDoc) => void;
  select: (i: number) => void;
  selectAction: (i: number | null) => void;
  updateAction: (beatIdx: number, actionIdx: number, path: string, value: unknown) => void;
  updateMeta: (path: string, value: unknown) => void;
  undo: () => void;
  redo: () => void;
}

/** Record the current doc into history, swap in the produced doc, re-derive beats, bump revision.
 *  A producer that returns the SAME doc reference is a no-op: nothing is recorded. */
function commit(s: EditorState, produce: (doc: DeckDoc) => DeckDoc): Partial<EditorState> {
  if (!s.doc) return {};
  const doc = produce(s.doc);
  if (doc === s.doc) return {};
  return {
    doc,
    beats: flattenBeats(doc),
    past: [...s.past, s.doc].slice(-HISTORY_CAP),
    future: [],
    revision: s.revision + 1,
  };
}

export const useEditor = create<EditorState>((set, get) => ({
  doc: null,
  beats: [],
  selected: 0,
  selectedAction: null,
  past: [],
  future: [],
  revision: 0,
  load: (doc) => set({ doc, beats: flattenBeats(doc), selected: 0, selectedAction: null, past: [], future: [], revision: 0 }),
  select: (i) => {
    const last = Math.max(0, get().beats.length - 1);
    set({ selected: Math.min(last, Math.max(0, i)), selectedAction: null });
  },
  selectAction: (i) => set({ selectedAction: i }),
  updateAction: (beatIdx, actionIdx, path, value) => set((s) => {
    if (!s.doc) return {};
    const loc = beatLocation(s.doc, beatIdx);
    if (!loc) return {};
    return commit(s, (doc) => ({
      ...doc,
      scenes: doc.scenes.map((sc, si) => si !== loc.sceneIdx ? sc : {
        ...sc,
        beats: sc.beats.map((b, bi) => bi !== loc.beatIdx ? b : {
          ...b,
          timeline: b.timeline.map((a, ai) => ai !== actionIdx ? a : setPath(a, path, value)),
        }),
      }),
    }));
  }),
  updateMeta: (path, value) => set((s) => s.doc ? commit(s, (doc) => ({ ...doc, meta: setPath(doc.meta, path, value) })) : {}),
  undo: () => set((s) => {
    if (!s.past.length || !s.doc) return {};
    const doc = s.past[s.past.length - 1];
    const last = Math.max(0, flattenBeats(doc).length - 1);
    return { doc, beats: flattenBeats(doc), past: s.past.slice(0, -1), future: [s.doc, ...s.future].slice(0, HISTORY_CAP), revision: s.revision + 1, selected: Math.min(s.selected, last), selectedAction: null };
  }),
  redo: () => set((s) => {
    if (!s.future.length || !s.doc) return {};
    const doc = s.future[0];
    const last = Math.max(0, flattenBeats(doc).length - 1);
    return { doc, beats: flattenBeats(doc), future: s.future.slice(1), past: [...s.past, s.doc].slice(-HISTORY_CAP), revision: s.revision + 1, selected: Math.min(s.selected, last), selectedAction: null };
  }),
}));
```

> `commit` preserves `selected`/`selectedAction` (Zustand shallow-merges the returned partial), so an inspector edit keeps the same action selected — preserving Plan 3b's live-edit behavior and `e2e/inspector.spec.ts`.

- [ ] **Step 8: Run the new + existing store tests**

Run: `npx vitest run tests/unit/store-history.test.ts tests/unit/store-edit.test.ts tests/unit/store-meta.test.ts tests/unit/store.test.ts && npx tsc --noEmit`
Expected: all PASS; tsc clean. (The older tests assert only `doc`/`beats`/`selected`/`selectedAction`, all still correct.)

- [ ] **Step 9: Commit**

```bash
git add lib/editor/flatten-beats.ts lib/editor/store.ts tests/unit/beat-location.test.ts tests/unit/store-history.test.ts
git commit -m "feat(editor): history-aware store (undo/redo + revision)"
```

---

## Task 2: Debounced autosave + `?deck` param + save-status chip

**Files:**
- Create: `lib/editor/use-autosave.ts`
- Modify: `app/editor/page.tsx`
- Test: `e2e/persistence.spec.ts` (new)

The hook is thin glue over `saveDeck`; its guarantee (edits survive a reload) is proved end-to-end, not in jsdom (rendering the full canvas/GSAP stack in a unit test is heavy and low-value — same rationale as Plan-3b T3).

- [ ] **Step 1: Create the autosave hook**

Create `lib/editor/use-autosave.ts`:

```ts
import { useEffect, useRef } from "react";
import { saveDeck } from "@/lib/api/decks-client";
import type { DeckDoc } from "@/engine/deck-doc";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Debounced PUT-on-change. Fires `delay`ms after the last doc change (skips the initial
 *  load, where revision === 0). Reports status transitions via `onStatus`. */
export function useAutosave(
  doc: DeckDoc | null,
  revision: number,
  onStatus: (s: SaveStatus) => void,
  delay = 700,
): void {
  const lastSaved = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!doc || revision === 0 || revision === lastSaved.current) return;
    if (timer.current) clearTimeout(timer.current);
    onStatus("saving");
    const rev = revision;
    timer.current = setTimeout(() => {
      saveDeck(doc)
        .then(() => { lastSaved.current = rev; onStatus("saved"); })
        .catch(() => onStatus("error"));
    }, delay);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [doc, revision, onStatus, delay]);
}
```

- [ ] **Step 2: Wire `?deck`, autosave, and a status chip into `app/editor/page.tsx`**

Replace the entire contents of `app/editor/page.tsx` with:

```tsx
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import "./editor.css";
import { useEditor } from "@/lib/editor/store";
import { loadDeck } from "@/lib/api/decks-client";
import { useAutosave, type SaveStatus } from "@/lib/editor/use-autosave";
import { DeckCanvas, type CanvasHandle } from "@/components/editor/DeckCanvas";
import { Filmstrip } from "@/components/editor/Filmstrip";
import { Timeline } from "@/components/editor/Timeline";
import { Inspector } from "@/components/editor/Inspector";
import { DeckSettings } from "@/components/editor/DeckSettings";

const STATUS_LABEL: Record<SaveStatus, string> = { idle: "", saving: "Saving…", saved: "Saved", error: "Save failed" };

export default function Editor() {
  const doc = useEditor((s) => s.doc);
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const revision = useEditor((s) => s.revision);
  const load = useEditor((s) => s.load);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const canvasRef = useRef<CanvasHandle>(null);
  const [time, setTime] = useState({ t: 0, duration: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("deck") ?? "demo";
    loadDeck(id).then(load).catch((e) => { console.error("failed to load deck", e); setLoadError(true); });
  }, [load]);

  const onStatus = useCallback((s: SaveStatus) => setStatus(s), []);
  useAutosave(doc, revision, onStatus);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const selectedFlat = beats[selected] ?? null;
  const onTime = useCallback((t: number, duration: number) => setTime({ t, duration }), []);
  return (
    <div className="ed">
      <div className="ed__bar">
        <span className="ed__brand">Morgana</span>
        <span style={{ color: "var(--ed-fg-muted)" }}>{doc?.meta.title ?? (loadError ? "couldn't load deck" : "no deck")}</span>
        <button className="ed__pill ed__pill--ghost" data-testid="undo" disabled={!canUndo} onClick={() => undo()}>↶ Undo</button>
        <button className="ed__pill ed__pill--ghost" data-testid="redo" disabled={!canRedo} onClick={() => redo()}>↷ Redo</button>
        <button className="ed__pill ed__pill--ghost" data-testid="deck-settings-toggle" onClick={() => setShowSettings(v => !v)}>Deck settings</button>
        <span data-testid="save-status" style={{ marginLeft: "auto", color: "var(--ed-fg-muted)", fontFamily: "var(--ed-mono)", fontSize: 12 }}>{STATUS_LABEL[status]}</span>
      </div>
      <Filmstrip />
      <div className="ed__canvas"><DeckCanvas ref={canvasRef} flat={selectedFlat} onTime={onTime} /></div>
      <Timeline canvasRef={canvasRef} time={time} />
      {showSettings ? <DeckSettings /> : <Inspector />}
    </div>
  );
}
```

> `undo`/`redo` toolbar buttons + the ⌘/Ctrl-Z keys are wired here (their store logic landed in Task 1); the Filmstrip's structural buttons arrive in Task 4. `disabled` reads directly off `past`/`future` length.

- [ ] **Step 3: Write the persistence e2e**

Create `e2e/persistence.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

// Round-trips through a THROWAWAY deck so the seeded demo stays pristine.
test("inspector edits autosave and survive a reload", async ({ page, request }) => {
  const id = "e2e-persist";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Persist" }, scenes: [
    { id: "s", beats: [{ id: "b", timeline: [{ kind: "text", value: "before", in: "fade" }] }] },
  ] };
  // create then seed the body
  await request.post("/api/decks", { data: { id, title: "Persist" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await page.getByTestId("timeline").locator(".ed__chip").first().click();      // select the text action
  const value = page.getByTestId("inspector").locator("textarea").first();
  await value.fill("after-edit");
  await expect(page.getByTestId("save-status")).toHaveText("Saved", { timeout: 15000 });

  await page.reload();
  await page.getByTestId("timeline").locator(".ed__chip").first().click();
  await expect(page.getByTestId("inspector").locator("textarea").first()).toHaveValue("after-edit");

  await request.delete(`/api/decks/${id}`);
});
```

- [ ] **Step 4: Run types + the persistence e2e**

Run:
```bash
cd /Users/chris/projects/morgana && lsof -ti :3000 :3100 | xargs kill -9 2>/dev/null || true
npx tsc --noEmit && npm run test:e2e -- e2e/persistence.spec.ts
```
Expected: tsc clean; the persistence spec PASSES (edit shows "Saved", survives reload). It runs under the `default` project only.

- [ ] **Step 5: Commit**

```bash
git add lib/editor/use-autosave.ts app/editor/page.tsx e2e/persistence.spec.ts
git commit -m "feat(editor): debounced autosave + ?deck param + undo/redo toolbar"
```

---

## Task 3: Pure structural mutations

**Files:**
- Create: `lib/editor/mutations.ts`
- Test: `tests/unit/mutations.test.ts` (new)

Side-effect-free `DeckDoc → DeckDoc` transforms. A transform that can't apply returns the **same** `doc` reference (so `commit()` treats it as a no-op).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/mutations.test.ts`:

```ts
import { expect, test } from "vitest";
import { insertBeatAfter, duplicateBeatAt, deleteBeatAt, moveBeatBy, appendScene, deleteSceneAt, uniqueBeatId, uniqueSceneId } from "@/lib/editor/mutations";
import { flattenBeats } from "@/lib/editor/flatten-beats";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }, { id: "b", timeline: [] }] },
  { id: "s2", beats: [{ id: "c", timeline: [] }] },
] });

test("uniqueBeatId / uniqueSceneId avoid collisions", () => {
  expect(uniqueBeatId(base())).toBe("b-1");          // a/b/c used, b-N free
  expect(uniqueSceneId(base())).toBe("s-3");          // s1/s2 used; s-N namespace free → s-1
});

test("insertBeatAfter adds a beat right after the flat index, in the same scene", () => {
  const d = insertBeatAfter(base(), 0);               // after "a"
  expect(d.scenes[0].beats.map((b) => b.id)).toEqual(["a", "b-1", "b"]);
  expect(d.scenes[0].beats[1].timeline.length).toBe(1); // non-empty default
});

test("duplicateBeatAt deep-clones with a fresh id", () => {
  const d = duplicateBeatAt(base(), 0);               // dup "a"
  expect(d.scenes[0].beats.map((b) => b.id)).toEqual(["a", "b-1", "b"]);
  expect(d.scenes[0].beats[1].timeline).toEqual(d.scenes[0].beats[0].timeline);
  d.scenes[0].beats[1].timeline.push({ kind: "clear" });        // independent copy
  expect(d.scenes[0].beats[0].timeline.length).toBe(1);
});

test("deleteBeatAt removes the targeted beat", () => {
  const d = deleteBeatAt(base(), 1);                  // delete "b"
  expect(flattenBeats(d).map((e) => e.beat.id)).toEqual(["a", "c"]);
});

test("moveBeatBy swaps within a scene; no-ops at the scene boundary", () => {
  expect(moveBeatBy(base(), 0, 1).scenes[0].beats.map((b) => b.id)).toEqual(["b", "a"]);
  const d = base();
  expect(moveBeatBy(d, 1, 1)).toBe(d);                // "b" is last in s1 → boundary no-op (same ref)
});

test("appendScene / deleteSceneAt add and remove whole scenes", () => {
  const added = appendScene(base());
  expect(added.scenes.map((s) => s.id)).toEqual(["s1", "s2", "s-3"]);
  expect(added.scenes[2].beats.length).toBe(1);
  const removed = deleteSceneAt(base(), 2);           // flat 2 is in s2
  expect(removed.scenes.map((s) => s.id)).toEqual(["s1"]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/mutations.test.ts`
Expected: FAIL — `@/lib/editor/mutations` does not exist.

- [ ] **Step 3: Create `lib/editor/mutations.ts`**

```ts
import type { DeckDoc } from "@/engine/deck-doc";
import type { Beat, Scene } from "@/engine/deck/types";
import { beatLocation } from "./flatten-beats";

export function uniqueBeatId(doc: DeckDoc): string {
  const used = new Set(doc.scenes.flatMap((s) => s.beats.map((b) => b.id)));
  for (let n = 1; ; n++) { const id = `b-${n}`; if (!used.has(id)) return id; }
}

export function uniqueSceneId(doc: DeckDoc): string {
  const used = new Set(doc.scenes.map((s) => s.id));
  for (let n = 1; ; n++) { const id = `s-${n}`; if (!used.has(id)) return id; }
}

export function newBeat(id: string): Beat {
  return { id, timeline: [{ kind: "text", value: "New line", in: "fade" }] };
}

function mapScene(doc: DeckDoc, sceneIdx: number, f: (s: Scene) => Scene): DeckDoc {
  return { ...doc, scenes: doc.scenes.map((s, i) => (i === sceneIdx ? f(s) : s)) };
}

export function insertBeatAfter(doc: DeckDoc, flatIdx: number): DeckDoc {
  const beat = newBeat(uniqueBeatId(doc));
  const loc = beatLocation(doc, flatIdx);
  if (!loc) {
    if (!doc.scenes.length) return { ...doc, scenes: [{ id: uniqueSceneId(doc), beats: [beat] }] };
    const si = doc.scenes.length - 1;
    return mapScene(doc, si, (s) => ({ ...s, beats: [...s.beats, beat] }));
  }
  return mapScene(doc, loc.sceneIdx, (s) => ({
    ...s,
    beats: [...s.beats.slice(0, loc.beatIdx + 1), beat, ...s.beats.slice(loc.beatIdx + 1)],
  }));
}

export function duplicateBeatAt(doc: DeckDoc, flatIdx: number): DeckDoc {
  const loc = beatLocation(doc, flatIdx);
  if (!loc) return doc;
  const src = doc.scenes[loc.sceneIdx].beats[loc.beatIdx];
  const copy: Beat = { ...(JSON.parse(JSON.stringify(src)) as Beat), id: uniqueBeatId(doc) };
  return mapScene(doc, loc.sceneIdx, (s) => ({
    ...s,
    beats: [...s.beats.slice(0, loc.beatIdx + 1), copy, ...s.beats.slice(loc.beatIdx + 1)],
  }));
}

export function deleteBeatAt(doc: DeckDoc, flatIdx: number): DeckDoc {
  const loc = beatLocation(doc, flatIdx);
  if (!loc) return doc;
  return mapScene(doc, loc.sceneIdx, (s) => ({ ...s, beats: s.beats.filter((_, bi) => bi !== loc.beatIdx) }));
}

/** Swap a beat with its neighbour WITHIN its scene. Cross-scene moves are out of scope (v1). */
export function moveBeatBy(doc: DeckDoc, flatIdx: number, dir: -1 | 1): DeckDoc {
  const loc = beatLocation(doc, flatIdx);
  if (!loc) return doc;
  const beats = doc.scenes[loc.sceneIdx].beats;
  const target = loc.beatIdx + dir;
  if (target < 0 || target >= beats.length) return doc; // scene boundary → no-op
  const next = beats.slice();
  [next[loc.beatIdx], next[target]] = [next[target], next[loc.beatIdx]];
  return mapScene(doc, loc.sceneIdx, (s) => ({ ...s, beats: next }));
}

export function appendScene(doc: DeckDoc): DeckDoc {
  return { ...doc, scenes: [...doc.scenes, { id: uniqueSceneId(doc), beats: [newBeat(uniqueBeatId(doc))] }] };
}

export function deleteSceneAt(doc: DeckDoc, flatIdx: number): DeckDoc {
  const loc = beatLocation(doc, flatIdx);
  if (!loc) return doc;
  return { ...doc, scenes: doc.scenes.filter((_, si) => si !== loc.sceneIdx) };
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run tests/unit/mutations.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/editor/mutations.ts tests/unit/mutations.test.ts
git commit -m "feat(editor): pure DeckDoc structural mutations"
```

---

## Task 4: Store structural methods + Filmstrip controls

**Files:**
- Modify: `lib/editor/store.ts`
- Modify: `components/editor/Filmstrip.tsx`
- Test: `tests/unit/store-history.test.ts` (extend), `e2e/structural.spec.ts` (new)

- [ ] **Step 1: Write the failing store test for structural methods**

Append to `tests/unit/store-history.test.ts`:

```ts
test("structural methods mutate + record history; delete clamps selection", () => {
  const multi: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "s", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] },
  ] };
  const s = useEditor.getState();
  s.load(multi);
  s.select(1);

  s.addBeat(1);                                       // after "b"
  expect(useEditor.getState().beats.length).toBe(3);

  s.deleteBeat(2);                                    // remove the new one
  expect(useEditor.getState().beats.length).toBe(2);

  s.deleteBeat(1);                                    // remove "b" while it was selected
  expect(useEditor.getState().beats.map((e) => e.beat.id)).toEqual(["a"]);
  expect(useEditor.getState().selected).toBe(0);      // clamped

  expect(useEditor.getState().past.length).toBeGreaterThan(0);
  useEditor.getState().undo();
  expect(useEditor.getState().beats.map((e) => e.beat.id)).toEqual(["a", "b"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/store-history.test.ts`
Expected: FAIL — `addBeat`/`deleteBeat` are not defined.

- [ ] **Step 3: Add the structural imports + interface entries + methods to `lib/editor/store.ts`**

In `lib/editor/store.ts`, add the mutations import directly under the existing `setPath` import:

```ts
import { insertBeatAfter, duplicateBeatAt, deleteBeatAt, moveBeatBy, appendScene, deleteSceneAt } from "./mutations";
```

Add these six signatures to the `EditorState` interface, immediately after the `redo: () => void;` line:

```ts
  addBeat: (flatIdx: number) => void;
  duplicateBeat: (flatIdx: number) => void;
  deleteBeat: (flatIdx: number) => void;
  moveBeat: (flatIdx: number, dir: -1 | 1) => void;
  addScene: () => void;
  deleteScene: (flatIdx: number) => void;
```

Add these six method implementations to the object returned by `create(...)`, immediately after the `redo: ...` implementation (before the closing `}))`):

```ts
  addBeat: (flatIdx) => set((s) => commit(s, (doc) => insertBeatAfter(doc, flatIdx))),
  duplicateBeat: (flatIdx) => set((s) => commit(s, (doc) => duplicateBeatAt(doc, flatIdx))),
  deleteBeat: (flatIdx) => set((s) => {
    if (!s.doc) return {};
    const part = commit(s, (doc) => deleteBeatAt(doc, flatIdx));
    if (!part.beats) return {};
    return { ...part, selected: Math.min(s.selected, Math.max(0, part.beats.length - 1)), selectedAction: null };
  }),
  moveBeat: (flatIdx, dir) => set((s) => {
    if (!s.doc) return {};
    const next = moveBeatBy(s.doc, flatIdx, dir);
    if (next === s.doc) return {};
    return { ...commit(s, () => next), selected: flatIdx + dir };
  }),
  addScene: () => set((s) => commit(s, (doc) => appendScene(doc))),
  deleteScene: (flatIdx) => set((s) => {
    if (!s.doc) return {};
    const part = commit(s, (doc) => deleteSceneAt(doc, flatIdx));
    if (!part.beats) return {};
    return { ...part, selected: Math.min(s.selected, Math.max(0, part.beats.length - 1)), selectedAction: null };
  }),
```

- [ ] **Step 4: Run the store test to verify it passes**

Run: `npx vitest run tests/unit/store-history.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Rebuild `components/editor/Filmstrip.tsx` with scene grouping + controls**

Replace the entire contents of `components/editor/Filmstrip.tsx` with:

```tsx
"use client";
import { useEditor } from "@/lib/editor/store";

export function Filmstrip() {
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const select = useEditor((s) => s.select);
  const addBeat = useEditor((s) => s.addBeat);
  const duplicateBeat = useEditor((s) => s.duplicateBeat);
  const deleteBeat = useEditor((s) => s.deleteBeat);
  const moveBeat = useEditor((s) => s.moveBeat);
  const addScene = useEditor((s) => s.addScene);

  // group consecutive flat beats by sceneId, preserving the flat index
  const groups: { sceneId: string; items: { flatIdx: number; id: string }[] }[] = [];
  beats.forEach((b, i) => {
    const last = groups[groups.length - 1];
    if (last && last.sceneId === b.sceneId) last.items.push({ flatIdx: i, id: b.beat.id });
    else groups.push({ sceneId: b.sceneId, items: [{ flatIdx: i, id: b.beat.id }] });
  });

  return (
    <div className="ed__film" data-testid="filmstrip">
      {groups.map((g) => (
        <div key={g.sceneId}>
          <div className="ed__lbl">{g.sceneId}</div>
          {g.items.map(({ flatIdx, id }) => (
            <div key={`${g.sceneId}-${id}-${flatIdx}`} style={{ display: "flex", alignItems: "center" }}>
              <button onClick={() => select(flatIdx)} aria-current={flatIdx === selected} className="ed__beat" style={{ flex: 1 }}>
                <span style={{ color: "var(--ed-fg-muted)", marginRight: 8 }}>{String(flatIdx + 1).padStart(2, "0")}</span>
                {id}
              </button>
              {flatIdx === selected && (
                <span style={{ display: "flex", gap: 2, paddingRight: 6 }}>
                  <button className="ed__icon" title="Move up" data-testid="beat-up" onClick={() => moveBeat(flatIdx, -1)}>↑</button>
                  <button className="ed__icon" title="Move down" data-testid="beat-down" onClick={() => moveBeat(flatIdx, 1)}>↓</button>
                  <button className="ed__icon" title="Duplicate" data-testid="beat-dupe" onClick={() => duplicateBeat(flatIdx)}>⧉</button>
                  <button className="ed__icon" title="Add after" data-testid="beat-add" onClick={() => addBeat(flatIdx)}>＋</button>
                  <button className="ed__icon" title="Delete" data-testid="beat-delete" onClick={() => deleteBeat(flatIdx)}>✕</button>
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
      <button className="ed__pill ed__pill--ghost" data-testid="scene-add" style={{ margin: 10 }} onClick={() => addScene()}>＋ Scene</button>
    </div>
  );
}
```

- [ ] **Step 6: Add the `.ed__icon` button style to `app/editor/editor.css`**

Append to `app/editor/editor.css`:

```css
.ed__icon { background: transparent; border: 1px solid var(--ed-line); color: var(--ed-fg); border-radius: 6px; width: 22px; height: 22px; line-height: 1; font-size: 12px; cursor: pointer; padding: 0; }
.ed__icon:hover { border-color: var(--ed-accent); color: var(--ed-accent); }
```

- [ ] **Step 7: Write the structural e2e**

Create `e2e/structural.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("add / duplicate / delete beats, and undo restores", async ({ page, request }) => {
  const id = "e2e-struct";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Struct" }, scenes: [
    { id: "s", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Struct" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const film = page.getByTestId("filmstrip");
  await expect(film.locator(".ed__beat")).toHaveCount(1);

  await film.locator(".ed__beat").first().click();        // select beat 1 → controls appear
  await page.getByTestId("beat-add").click();
  await expect(film.locator(".ed__beat")).toHaveCount(2);

  await page.getByTestId("undo").click();
  await expect(film.locator(".ed__beat")).toHaveCount(1);

  await request.delete(`/api/decks/${id}`);
});
```

- [ ] **Step 8: Verify types + the structural e2e**

Run:
```bash
cd /Users/chris/projects/morgana && lsof -ti :3000 :3100 | xargs kill -9 2>/dev/null || true
npx tsc --noEmit && npm run test:e2e -- e2e/structural.spec.ts
```
Expected: tsc clean; the spec PASSES (add → 2 beats, undo → 1 beat).

- [ ] **Step 9: Commit**

```bash
git add lib/editor/store.ts components/editor/Filmstrip.tsx app/editor/editor.css tests/unit/store-history.test.ts e2e/structural.spec.ts
git commit -m "feat(editor): structural beat/scene mutations + filmstrip controls"
```

---

## Task 5: Canvas drag-placement (pos-aware render + handle)

**Files:**
- Modify: `engine/authoring/seek.ts`
- Modify: `components/editor/DeckCanvas.tsx`
- Test: `tests/unit/seek.test.ts` (extend), `e2e/drag-pos.spec.ts` (new)

The seek-renderer ignores `pos` today, so dragging would be invisible. Step 1 makes a posed text line render at its normalized point; Steps 3–4 overlay a draggable handle on its own `pointer-events:auto` layer (necessary because `.cin__stage` is `pointer-events:none`).

- [ ] **Step 1: Write the failing renderer test**

Append to `tests/unit/seek.test.ts`:

```ts
test("a text action with pos renders absolutely at its normalized point", () => {
  const host = document.createElement("div");
  renderBeatAt([{ kind: "text", value: "Placed", in: "fade", pos: { x: 0.5, y: 0.3 } }], 99, { textHost: host, art: null });
  const p = host.querySelector("p")!;
  expect(p.style.position).toBe("absolute");
  expect(p.style.left).toBe("50%");
  expect(p.style.top).toBe("30%");
});
```

> If `seek.test.ts` does not already import `renderBeatAt`, add it to the existing import from `@/engine/authoring/seek`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/seek.test.ts`
Expected: FAIL — posed text currently renders with no `position`/`left`/`top`.

- [ ] **Step 3: Position posed actions in `engine/authoring/seek.ts`**

In `engine/authoring/seek.ts`, in the `applyAt` function's `case "text":` block, add the `pos` handling immediately before `ctx.textHost.appendChild(el);`:

```ts
      if (a.pos) { el.style.position = "absolute"; el.style.left = `${a.pos.x * 100}%`; el.style.top = `${a.pos.y * 100}%`; }
```

So the block reads:

```ts
    case "text": {
      const el = document.createElement("p");
      el.className = "cin__line cin__line--" + (a.size ?? "lg");
      el.textContent = a.value;
      el.style.opacity = String(p);
      el.style.transform = a.in === "flyUp" ? `translateY(${(1 - p) * 40}px)` : a.in === "fadeSide" ? `translateX(${(1 - p) * 24}px)` : "";
      if (a.align) el.style.textAlign = a.align;
      if (a.pos) { el.style.position = "absolute"; el.style.left = `${a.pos.x * 100}%`; el.style.top = `${a.pos.y * 100}%`; }
      ctx.textHost.appendChild(el);
      break;
    }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/seek.test.ts`
Expected: PASS.

- [ ] **Step 5: Rebuild `components/editor/DeckCanvas.tsx` with a pos-filling host + drag handle**

Replace the entire contents of `components/editor/DeckCanvas.tsx` with:

```tsx
"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { beatDuration, renderBeatAt } from "@/engine/authoring/seek";
import { useEditor } from "@/lib/editor/store";
import { descriptorFor } from "@/lib/editor/registry";
import { getPath } from "@/lib/editor/paths";
import type { FlatBeat } from "@/lib/editor/flatten-beats";

export interface CanvasHandle { seek: (t: number) => void; play: () => void; pause: () => void; }

export const DeckCanvas = forwardRef<CanvasHandle, { flat: FlatBeat | null; onTime?: (t: number, duration: number) => void }>(
  function DeckCanvas({ flat, onTime }, ref) {
    const host = useRef<HTMLDivElement>(null);
    const art = useRef<ArtStageHandle>(null);
    const textHost = useRef<HTMLDivElement>(null);
    const t = useRef(0);
    const raf = useRef<number | null>(null);
    const [night, setNight] = useState(0.6);
    const dur = () => (flat ? beatDuration(flat.beat.timeline) : 0);
    const draw = () => { if (textHost.current && flat) renderBeatAt(flat.beat.timeline, t.current, { textHost: textHost.current, art: art.current, setNight }); };
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
      <div ref={host} className="ed__canvas-host" style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", maxHeight: "100%", margin: "auto", containerType: "size", overflow: "hidden", background: "var(--color-mm-dark-brown)", boxShadow: "0 4px 24px rgba(0,0,0,0.4)" }}>
        <ArtStage ref={art} nightlight={night} reduced={false} transparentBg />
        <div className="cin"><div className="cin__stage"><div ref={textHost} className="cin__text" style={{ position: "absolute", inset: 0, maxWidth: "none" }} data-testid="canvas-text" /></div></div>
        <PosHandle hostRef={host} redraw={draw} />
      </div>
    );
  },
);

/** Draggable position handle for the selected pos-bearing action. Its own pointer-events layer. */
function PosHandle({ hostRef, redraw }: { hostRef: React.RefObject<HTMLDivElement | null>; redraw: () => void }) {
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const selectedAction = useEditor((s) => s.selectedAction);
  const updateAction = useEditor((s) => s.updateAction);
  const action = selectedAction != null ? beats[selected]?.beat.timeline[selectedAction] : undefined;
  const hasPos = !!action && descriptorFor(action).schema.some((f) => f.key === "pos.x");
  if (!action || !hasPos) return null;

  const pos = (getPath(action, "pos") as { x: number; y: number } | undefined) ?? { x: 0.1, y: 0.2 };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
      updateAction(selected, selectedAction!, "pos", { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) });
      redraw();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5 }}>
      <button
        data-testid="pos-handle"
        onPointerDown={onPointerDown}
        style={{
          position: "absolute", left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, transform: "translate(-50%, -50%)",
          width: 18, height: 18, borderRadius: "50%", border: "2px solid var(--ed-accent)", background: "rgba(212,168,67,0.35)",
          cursor: "grab", pointerEvents: "auto", padding: 0,
        }}
      />
    </div>
  );
}
```

> `PosHandle` reads the store directly. In the `/dev/canvas` harness (no loaded deck) the store is empty → no handle, so that page is unaffected. The `redraw()` call repaints the canvas during the drag (the store update also produces a new `flat`, but the in-drag redraw keeps it crisp).

- [ ] **Step 6: Write the drag e2e**

Create `e2e/drag-pos.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("dragging the pos handle writes the action's pos and shows a Pos X field", async ({ page, request }) => {
  const id = "e2e-drag";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Drag" }, scenes: [
    { id: "s", beats: [{ id: "a", timeline: [{ kind: "text", value: "Drag me", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Drag" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await page.getByTestId("timeline").locator(".ed__chip").first().click();   // select the text action
  const handle = page.getByTestId("pos-handle");
  await expect(handle).toBeVisible();

  const host = page.locator(".ed__canvas-host");
  const box = (await host.boundingBox())!;
  // drag the handle toward the host's lower-right quadrant
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7, { steps: 8 });
  await page.mouse.up();

  // the inspector's "Pos X" number now reflects the dragged-to position (> 0.5)
  const posX = page.getByTestId("inspector").locator('input[type="number"]').first();
  await expect.poll(async () => Number(await posX.inputValue())).toBeGreaterThan(0.5);

  await request.delete(`/api/decks/${id}`);
});
```

- [ ] **Step 7: Verify types + the drag e2e**

Run:
```bash
cd /Users/chris/projects/morgana && lsof -ti :3000 :3100 | xargs kill -9 2>/dev/null || true
npx tsc --noEmit && npm run test:e2e -- e2e/drag-pos.spec.ts e2e/deck-canvas.spec.ts
```
Expected: tsc clean; the drag spec PASSES (handle visible, Pos X > 0.5 after drag); the existing `deck-canvas` spec still PASSES (the host/textHost change didn't regress scrub render).

- [ ] **Step 8: Commit**

```bash
git add engine/authoring/seek.ts components/editor/DeckCanvas.tsx tests/unit/seek.test.ts e2e/drag-pos.spec.ts
git commit -m "feat(canvas): pos-aware render + on-stage drag handle"
```

---

## Task 6: Richer inspector schemas + checkbox field

**Files:**
- Modify: `components/editor/Field.tsx`
- Modify: `lib/editor/registry.ts`
- Test: `tests/unit/registry-richer.test.ts` (new)

- [ ] **Step 1: Write the failing registry test**

Create `tests/unit/registry-richer.test.ts`:

```ts
import { expect, test } from "vitest";
import { descriptorFor } from "@/lib/editor/registry";

test("counter_show exposes prefix/label/value + pos", () => {
  const keys = descriptorFor({ kind: "counter_show" } as never).schema.map((f) => f.key);
  expect(keys).toEqual(expect.arrayContaining(["prefix", "label", "value", "pos.x", "pos.y"]));
});

test("media exposes a checkbox field for round", () => {
  const round = descriptorFor({ kind: "media" } as never).schema.find((f) => f.key === "round");
  expect(round?.type).toBe("checkbox");
});

test("rotateList and counter_to/counter_add resolve to real descriptors", () => {
  expect(descriptorFor({ kind: "rotateList" } as never).label).toBe("Rotating list");
  expect(descriptorFor({ kind: "counter_to" } as never).schema.map((f) => f.key)).toContain("value");
  expect(descriptorFor({ kind: "counter_add" } as never).schema.map((f) => f.key)).toContain("delta");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/registry-richer.test.ts`
Expected: FAIL — those kinds fall through to the generic descriptor (empty schema / kind-as-label).

- [ ] **Step 3: Add the `checkbox` field type to `components/editor/Field.tsx`**

In `components/editor/Field.tsx`, replace the trailing `) : (` text-input fallback branch with a `checkbox` branch followed by the fallback. Change:

```tsx
      ) : (
        <input style={base} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      )}
```

to:

```tsx
      ) : spec.type === "checkbox" ? (
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
      ) : (
        <input style={base} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      )}
```

- [ ] **Step 4: Add `checkbox` to the `FieldType` union + new descriptors in `lib/editor/registry.ts`**

In `lib/editor/registry.ts`, widen the `FieldType` union:

```ts
export type FieldType = "text" | "textarea" | "number" | "select" | "range" | "checkbox";
```

Add the `MEDIA_INS` constant directly below the existing `ART_MODES` constant:

```ts
const MEDIA_INS = ["fade", "flyUp", "pop", "fadeSide"];
```

Then add these descriptor entries inside the `REGISTRY` object, immediately after the `note_emitter` entry (before the closing `};`):

```ts
  rotateList: { kind: "rotateList", label: "Rotating list", icon: "ti-list", seekable: true, schema: [
    { key: "size", label: "Size", type: "select", options: opts("lg", "md", "sm") },
  ] },
  counter_show: { kind: "counter_show", label: "Counter (show)", icon: "ti-number", seekable: true, schema: [
    { key: "prefix", label: "Prefix", type: "text" },
    { key: "label", label: "Label", type: "text" },
    { key: "value", label: "Start value", type: "number", step: 1 },
    { key: "size", label: "Size", type: "select", options: opts("lg", "md", "sm") },
    { key: "pos.x", label: "Pos X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "pos.y", label: "Pos Y", type: "number", min: 0, max: 1, step: 0.01 },
  ] },
  counter_to: { kind: "counter_to", label: "Counter → value", icon: "ti-number", seekable: true, schema: [
    { key: "value", label: "Target value", type: "number", step: 1 },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ] },
  counter_add: { kind: "counter_add", label: "Counter +/−", icon: "ti-number", seekable: true, schema: [
    { key: "delta", label: "Delta", type: "number", step: 1 },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ] },
  media: { kind: "media", label: "Media tile", icon: "ti-photo", seekable: true, schema: [
    { key: "id", label: "Tile id", type: "text" },
    { key: "src", label: "Source", type: "text" },
    { key: "label", label: "Placeholder label", type: "text" },
    { key: "width", label: "Width (0–1)", type: "range", min: 0.05, max: 0.6, step: 0.01 },
    { key: "in", label: "Reveal", type: "select", options: MEDIA_INS.map((v) => ({ value: v, label: v })) },
    { key: "round", label: "Round (headshot)", type: "checkbox" },
    { key: "pos.x", label: "Pos X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "pos.y", label: "Pos Y", type: "number", min: 0, max: 1, step: 0.01 },
  ] },
  media_move: { kind: "media_move", label: "Media move", icon: "ti-arrows-move", seekable: true, schema: [
    { key: "id", label: "Tile id", type: "text" },
    { key: "scale", label: "Scale", type: "range", min: 0.2, max: 3, step: 0.1 },
    { key: "to.x", label: "To X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "to.y", label: "To Y", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ] },
```

- [ ] **Step 5: Run the registry test + types to verify they pass**

Run: `npx vitest run tests/unit/registry-richer.test.ts tests/unit/registry.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean; the existing `registry.test.ts` still passes (additive change).

- [ ] **Step 6: Commit**

```bash
git add components/editor/Field.tsx lib/editor/registry.ts tests/unit/registry-richer.test.ts
git commit -m "feat(editor): richer inspector schemas (rotateList/counter/media) + checkbox field"
```

---

## Task 7: Full suite + verification

**Files:** none (verification only).

- [ ] **Step 1: Types**

Run: `cd /Users/chris/projects/morgana && npx tsc --noEmit`
Expected: clean (no output).

- [ ] **Step 2: Unit tests**

Run: `npm test`
Expected: all files PASS — including the new `beat-location`, `store-history`, `mutations`, `registry-richer`, the extended `seek`, and every prior suite.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Full e2e (both servers)**

Run:
```bash
cd /Users/chris/projects/morgana && lsof -ti :3000 :3100 | xargs kill -9 2>/dev/null || true
npm run test:e2e
```
Expected: PASS for the `default` project (all specs, incl. the new `persistence`, `structural`, `drag-pos`, plus prior `beatstage`/`spike`/`chrome`/`deck-canvas`/`editor`/`theme`/`inspector`/`deck-settings`) and the `standalone` project (`editor.spec.ts`). The throwaway decks (`e2e-persist`/`e2e-struct`/`e2e-drag`) are created + deleted within their specs and are gitignored under `./data/decks/`.

- [ ] **Step 5: Confirm the demo deck stays pristine**

Run: `git status --porcelain samples/ && cat samples/demo.deck.json | head -3`
Expected: no changes under `samples/`; the demo deck is unchanged (the e2e specs only touch throwaway `e2e-*` decks on the gitignored volume).

- [ ] **Step 6: Hand off**

This completes the plan. Hand off to `superpowers:finishing-a-development-branch` for merge / branch / worktree cleanup.

---

## Plan 3c Done — Definition of Done
- **Edits persist:** inspector + structural changes debounce-save via `PUT /api/decks/:id`; a toolbar chip shows `Saving…/Saved/Save failed`; a reload restores the saved deck.
- **Structural editing:** beats can be added / duplicated / deleted / reordered (within a scene); scenes can be added / deleted; the filmstrip groups by scene and exposes per-beat controls.
- **Undo/redo:** every doc mutation is reversible via the store history, toolbar buttons, and ⌘/Ctrl-Z (⇧ to redo).
- **Drag-placement:** a selected pos-bearing action (text/note/counter/media) shows a draggable on-stage handle that writes `pos`; the canvas renders posed text at its point.
- **Richer inspector:** `rotateList`, `counter_*`, and `media*` are editable; `Field` supports booleans.
- All unit + e2e green; `npm run build` succeeds; the seeded demo deck is untouched.

## Self-Review (completed during authoring)
- **Spec coverage (vs. the verbatim 3c note):** drag-placement → T5; structural beat/scene mutations → T3 (pure) + T4 (store/UI); undo/redo → T1 (store) + T2 (toolbar/keys); debounced autosave → T2; richer schemas → T6; "on-stage handles for notes/counter/media" → T5's generic pos handle (any action whose schema carries `pos.x` — text/note_emitter/counter_show/media). Deferred-and-flagged: bespoke per-effect editors (Tier-2, design §9) and timeline action CRUD (Plan 3d).
- **Placeholder scan:** every code step ships real code. The only "copy from source" is none — all code is inline.
- **Type consistency:** `commit()`, `beatLocation`, `revision`, `past`/`future`, `undo`/`redo` defined in T1 and consumed unchanged in T2/T4/T5; `insertBeatAfter`/`duplicateBeatAt`/`deleteBeatAt`/`moveBeatBy`/`appendScene`/`deleteSceneAt` defined in T3 and imported by name in T4; `SaveStatus`/`useAutosave` (T2) consumed by `page.tsx`; `FieldType` widened with `checkbox` in T6 and honored by `Field.tsx`; `descriptorFor(...).schema.some(f => f.key === "pos.x")` gate in T5 matches the `pos.x` keys declared in the registry (T6 adds the same key shape for counter/media). The `ed__icon` class (T4) is added to `editor.css` in the same task.

## What follows — Plan 3d (Timeline editing & polish)
Timeline action CRUD (add/insert/delete/reorder action blocks; resizable `wait`s; convert a block's kind) · a deck switcher in the toolbar (the `[deck ▼]` selector backing the `?deck` param) · bespoke on-stage editors for notes (emitter arc/decay) / counter / media (scale) — the Tier-2 effect editors · export-to-TS surfaced in the toolbar (the bridge already exists from Plan 2).
