# Morgana — Plan 3d: Authoring Loop + Styling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the v1 authoring loop — add/delete/reorder actions inside a beat, manage decks from the toolbar, surface export-to-TS — and add styling: per-line text **bold / italic / finer size**, plus a **self-hosted open-source font library** with a **per-deck font picker**.

**Architecture:**
- **Action-level mutations mirror Plan 3c's beat mutations.** `lib/editor/mutations.ts` gains pure `DeckDoc → DeckDoc` action transforms; the store wraps them through the existing `commit()`. A new `newAction(kind)` factory + gap-filled registry descriptors mean every kind the "add action" menu offers is editable.
- **Styling is data + render.** The `text` Action gains `bold?`/`italic?` and `TextSize` widens to `xs…xl`. The editor preview (`engine/authoring/seek.ts`) applies these as **inline styles** (self-sufficient — the editor canvas doesn't mount `CinematicSlide`); a separate task brings the real engine to parity for present mode.
- **Fonts are self-hosted + manifest.** A `lib/fonts/fonts.json` manifest + a `scripts/sync-fonts.mjs` step vendor latin woff2 from `@fontsource/*` into `public/fonts/`, generate `app/fonts.css` (`@font-face`), and bundle OFL licenses. `app/layout.tsx` drops `next/font/google`. Per-deck choice lives on `meta.fonts` and is applied as deck-scoped CSS vars.

**Tech Stack:** Next.js 15, React 19, TypeScript, Zustand 5, Vitest (jsdom), Playwright, `@fontsource/*` (OFL fonts). Builds on Plan 3a (shell/canvas/timeline), 3b (registry/inspector), 3c (history/autosave/structural mutations/drag-pos).

**Working dir:** `/Users/chris/projects/morgana` (the `MG` worktree). All paths repo-relative.

---

## Scope

Implements the recommended scope from `docs/2026-06-26-morgana-plan-3d-brainstorm.md`:

- **Authoring loop:** A (timeline action CRUD) · C (deck management UI) · D (surface export) · E (registry `defaults()` + gap-fill) · the trivial `deleteScene` wire-up.
- **Styling:** B (text bold/italic/size) · T1 (font provider migration) · T2 (thin OSS font library) · T3 (per-deck font picker).

**Explicitly NOT in 3d** (deferred per brainstorm §3/§4): inline per-word text markup; bespoke on-stage effect editors; deterministic particle scrubbing; asset *upload*; the "add new fonts" system; validation/linting; keyboard/a11y pass; cross-scene beat move; convert-action-kind; drag-to-resize waits.

**Decisions adopted from the brainstorm's open questions:**
- Q1 → per-line `bold`/`italic` booleans + `TextSize` widened to `xs/sm/md/lg/xl` (no inline markup).
- Q3 → flat `meta.fonts: { display?, body?, cursive? }`, per-deck only.
- Q4 → keep the 3 roles (display/body/cursive).
- Q5 → starter library (8, all OFL): Londrina Solid, Bebas Neue, Space Grotesk, Atkinson Hyperlegible, Inter, Source Serif 4, Dancing Script, Caveat.

---

## File Structure

```
morgana/
  lib/editor/registry.ts            # MODIFY: newAction() factory, ADDABLE_KINDS, gap-fill descriptors, text bold/italic/size fields (T1,T5,T6 → Tasks 1,5)
  lib/editor/mutations.ts           # MODIFY: + pure action transforms (Task 2)
  lib/editor/store.ts               # MODIFY: + action store methods (Task 3)
  engine/deck/types.ts              # MODIFY: TextSize widen + text bold/italic (Task 5)
  engine/authoring/seek.ts          # MODIFY: render bold/italic/size inline (Task 5)
  engine/components/layouts/CinematicSlide.tsx  # MODIFY: appendText bold/italic + xs/xl CSS (Task 6)
  components/editor/Timeline.tsx    # MODIFY: add-action menu + per-action controls + gate dividers (Task 4)
  components/editor/Filmstrip.tsx   # MODIFY: + delete-scene button (Task 9)
  components/editor/DeckSettings.tsx# MODIFY: + 3 font-picker selects (Task 8)
  components/editor/DeckCanvas.tsx  # MODIFY: apply meta.fonts as CSS vars on host (Task 8)
  engine/deck-doc.ts                # MODIFY: + DeckMeta.fonts (Task 8)
  app/editor/page.tsx               # MODIFY: deck switcher/new/delete + export panel toolbar (Tasks 9,10)
  app/editor/editor.css             # MODIFY: + gate/control/export styles (Tasks 4,9,10)
  app/layout.tsx                    # MODIFY: drop next/font, import fonts.css (Task 7)
  lib/fonts/fonts.json              # NEW: font manifest (Task 7)
  lib/fonts/catalog.ts              # NEW: manifest loader + fontFamilies() (Task 7)
  scripts/sync-fonts.mjs            # NEW: vendor woff2 + generate app/fonts.css (Task 7)
  app/fonts.css                     # NEW (generated): @font-face + default --font-* vars (Task 7)
  public/fonts/<family>/*.woff2     # NEW (vendored, committed) (Task 7)
  public/fonts/LICENSES/*           # NEW (committed) (Task 7)
  tests/unit/{registry-addable,action-mutations,store-actions,seek-styling,fonts-catalog,deck-meta-fonts}.test.ts  # NEW
  e2e/{action-crud,font-picker,deck-manage,export-ts}.spec.ts  # NEW
```

---

## Task 0: Branch

- [ ] **Step 1: Cut the branch from up-to-date `main`**

```bash
cd /Users/chris/projects/morgana
git checkout main && git pull --ff-only origin main
git checkout -b plan-3d-authoring-loop-styling
git push -u origin plan-3d-authoring-loop-styling
```

> If you are already on a worktree branch for this work, skip the checkout and just confirm `git status` is clean before starting.

---

## Task 1: Registry — `newAction()` factory, addable kinds, gap-fill descriptors

**Files:**
- Modify: `lib/editor/registry.ts`
- Test: `tests/unit/registry-addable.test.ts` (new)

This unblocks Task 4 (the add-action menu needs a default per kind) and closes the empty-inspector dead end for kinds that become add-able.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/registry-addable.test.ts`:

```ts
import { expect, test } from "vitest";
import { newAction, ADDABLE_KINDS, descriptorFor } from "@/lib/editor/registry";

test("newAction returns a valid default for each kind", () => {
  expect(newAction("text")).toEqual({ kind: "text", value: "New line", in: "fade" });
  expect(newAction("wait")).toEqual({ kind: "wait", ms: 500 });
  expect(newAction("click_gate")).toEqual({ kind: "click_gate" });
  expect(newAction("nightlight")).toMatchObject({ kind: "nightlight", to: 0.6 });
  expect(newAction("counter_show")).toMatchObject({ kind: "counter_show", pos: { x: 0.5, y: 0.5 } });
});

test("ADDABLE_KINDS is a non-empty list of { kind, label } and every entry has a descriptor", () => {
  expect(ADDABLE_KINDS.length).toBeGreaterThan(8);
  for (const k of ADDABLE_KINDS) {
    expect(typeof k.kind).toBe("string");
    expect(typeof k.label).toBe("string");
    expect(descriptorFor({ kind: k.kind }).label).not.toBe(k.kind); // a real (non-generic) descriptor
  }
});

test("gap-filled kinds resolve to real descriptors", () => {
  expect(descriptorFor({ kind: "stop_notes" }).label).toBe("Stop notes");
  expect(descriptorFor({ kind: "counter_hide" }).schema.map((f) => f.key)).toContain("durationMs");
  expect(descriptorFor({ kind: "media_out" }).schema.map((f) => f.key)).toContain("id");
  expect(descriptorFor({ kind: "pulse_arrow" }).schema.map((f) => f.key)).toContain("which");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/registry-addable.test.ts`
Expected: FAIL — `newAction` / `ADDABLE_KINDS` are not exported.

- [ ] **Step 3: Add gap-fill descriptors to `lib/editor/registry.ts`**

In `lib/editor/registry.ts`, add these entries inside the `REGISTRY` object, immediately before the closing `};` (after the `media_move` entry):

```ts
  counter_hide: { kind: "counter_hide", label: "Counter hide", icon: "ti-number", seekable: true, schema: [
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ] },
  media_out: { kind: "media_out", label: "Media out", icon: "ti-photo", seekable: true, schema: [
    { key: "id", label: "Tile id", type: "text" },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ] },
  note_circle: { kind: "note_circle", label: "Note circle", icon: "ti-circle", seekable: false, schema: [
    { key: "pos.x", label: "Pos X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "pos.y", label: "Pos Y", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "width", label: "Width (0–1)", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "height", label: "Height (0–1)", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "speed", label: "Ms per orbit", type: "number", min: 0, step: 100 },
  ] },
  stop_notes: { kind: "stop_notes", label: "Stop notes", icon: "ti-music-off", seekable: true, schema: [] },
  stop_circle: { kind: "stop_circle", label: "Stop circle", icon: "ti-circle-off", seekable: true, schema: [] },
  reveal_arrows: { kind: "reveal_arrows", label: "Reveal arrows", icon: "ti-arrows-right", seekable: true, schema: [] },
  reveal_again: { kind: "reveal_again", label: "Reveal 'again'", icon: "ti-repeat", seekable: true, schema: [] },
  pulse_arrow: { kind: "pulse_arrow", label: "Pulse arrow", icon: "ti-arrow-big-right", seekable: true, schema: [
    { key: "which", label: "Which", type: "select", options: [{ value: "next", label: "next" }, { value: "prev", label: "prev" }] },
    { key: "scale", label: "Scale", type: "number", min: 1, max: 6, step: 0.5 },
  ] },
```

- [ ] **Step 4: Add the `newAction` factory + `ADDABLE_KINDS` to `lib/editor/registry.ts`**

Append to the end of `lib/editor/registry.ts` (after `descriptorFor`):

```ts
/** A sensible default Action for each add-able kind (used by the timeline "add action" menu). */
export function newAction(kind: Action["kind"]): Action {
  switch (kind) {
    case "text": return { kind: "text", value: "New line", in: "fade" };
    case "rotateList": return { kind: "rotateList", items: ["One", "Two", "Three"] };
    case "clear": return { kind: "clear" };
    case "art": return { kind: "art", art: { to: "", mode: "fade" } };
    case "nightlight": return { kind: "nightlight", to: 0.6 };
    case "note_emitter": return { kind: "note_emitter", color: "#d4a843", pos: { x: 0.5, y: 0.8 }, dir: 0, decay: 2000, freq: 4 };
    case "note_circle": return { kind: "note_circle", pos: { x: 0.5, y: 0.5 }, width: 0.3, height: 0.3, hex: ["#d4a843"] };
    case "stop_notes": return { kind: "stop_notes" };
    case "stop_circle": return { kind: "stop_circle" };
    case "click_gate": return { kind: "click_gate" };
    case "reveal_arrows": return { kind: "reveal_arrows" };
    case "reveal_again": return { kind: "reveal_again" };
    case "pulse_arrow": return { kind: "pulse_arrow", which: "next" };
    case "wait": return { kind: "wait", ms: 500 };
    case "fade_out": return { kind: "fade_out" };
    case "counter_show": return { kind: "counter_show", pos: { x: 0.5, y: 0.5 }, value: 0 };
    case "counter_to": return { kind: "counter_to", value: 100 };
    case "counter_add": return { kind: "counter_add", delta: 10 };
    case "counter_hide": return { kind: "counter_hide" };
    case "media": return { kind: "media", id: "tile", pos: { x: 0.5, y: 0.5 } };
    case "media_move": return { kind: "media_move", id: "tile", to: { x: 0.5, y: 0.5 } };
    case "media_out": return { kind: "media_out" };
    default: return { kind: "clear" };
  }
}

/** Kinds offered in the timeline "add action" menu, in author-friendly order. */
export const ADDABLE_KINDS: { kind: Action["kind"]; label: string }[] = (
  ["text", "rotateList", "wait", "click_gate", "clear", "fade_out", "art", "nightlight",
   "counter_show", "counter_to", "counter_add", "counter_hide",
   "media", "media_move", "media_out",
   "note_emitter", "note_circle", "stop_notes", "stop_circle",
   "reveal_arrows", "reveal_again", "pulse_arrow"] as Action["kind"][]
).map((kind) => ({ kind, label: (REGISTRY[kind]?.label ?? kind) }));
```

- [ ] **Step 5: Run the test + types to verify they pass**

Run: `npx vitest run tests/unit/registry-addable.test.ts tests/unit/registry.test.ts tests/unit/registry-richer.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean; the existing registry tests still pass (additive change).

- [ ] **Step 6: Commit**

```bash
git add lib/editor/registry.ts tests/unit/registry-addable.test.ts
git commit -m "feat(editor): newAction factory, ADDABLE_KINDS, registry gap-fill"
```

---

## Task 2: Pure action mutations

**Files:**
- Modify: `lib/editor/mutations.ts`
- Test: `tests/unit/action-mutations.test.ts` (new)

Side-effect-free `DeckDoc → DeckDoc` transforms for actions, mirroring the beat mutations. A transform that can't apply returns the **same** `doc` reference (so `commit()` treats it as a no-op).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/action-mutations.test.ts`:

```ts
import { expect, test } from "vitest";
import { insertActionAfter, deleteActionAt, moveActionBy, duplicateActionAt } from "@/lib/editor/mutations";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [
    { id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }, { kind: "wait", ms: 100 }] },
  ] },
  { id: "s2", beats: [{ id: "c", timeline: [{ kind: "clear" }] }] },
] });

const tl = (d: DeckDoc, flat: number) => {
  // flat 0 → s1/a, flat 1 → s2/c
  return flat === 0 ? d.scenes[0].beats[0].timeline : d.scenes[1].beats[0].timeline;
};

test("insertActionAfter splices a new action after the index", () => {
  const d = insertActionAfter(base(), 0, 0, { kind: "clear" });
  expect(tl(d, 0).map((a) => a.kind)).toEqual(["text", "clear", "wait"]);
});

test("insertActionAfter with actionIdx -1 prepends", () => {
  const d = insertActionAfter(base(), 0, -1, { kind: "clear" });
  expect(tl(d, 0).map((a) => a.kind)).toEqual(["clear", "text", "wait"]);
});

test("deleteActionAt removes the targeted action", () => {
  const d = deleteActionAt(base(), 0, 0);
  expect(tl(d, 0).map((a) => a.kind)).toEqual(["wait"]);
});

test("moveActionBy swaps neighbours; no-ops (same ref) at the timeline boundary", () => {
  expect(moveActionBy(base(), 0, 0, 1).scenes[0].beats[0].timeline.map((a) => a.kind)).toEqual(["wait", "text"]);
  const d = base();
  expect(moveActionBy(d, 0, 0, -1)).toBe(d); // already first → boundary no-op
});

test("duplicateActionAt deep-clones right after the source", () => {
  const d = duplicateActionAt(base(), 0, 0);
  expect(tl(d, 0).map((a) => a.kind)).toEqual(["text", "text", "wait"]);
  (tl(d, 0)[1] as { value: string }).value = "changed";
  expect((tl(d, 0)[0] as { value: string }).value).toBe("A"); // independent copy
});

test("out-of-range flat index returns the same doc", () => {
  const d = base();
  expect(deleteActionAt(d, 9, 0)).toBe(d);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/action-mutations.test.ts`
Expected: FAIL — the four functions are not exported.

- [ ] **Step 3: Add the action transforms to `lib/editor/mutations.ts`**

In `lib/editor/mutations.ts`, add the `Action` import to the existing types import line so it reads:

```ts
import type { Action, Beat, Scene } from "@/engine/deck/types";
```

Then append to the end of the file:

```ts
/** Map the timeline of the beat at a flat index, returning the same doc on a miss. */
function mapTimeline(doc: DeckDoc, flatIdx: number, f: (tl: Action[]) => Action[]): DeckDoc {
  const loc = beatLocation(doc, flatIdx);
  if (!loc) return doc;
  return mapScene(doc, loc.sceneIdx, (s) => ({
    ...s,
    beats: s.beats.map((b, bi) => (bi !== loc.beatIdx ? b : { ...b, timeline: f(b.timeline) })),
  }));
}

/** Insert `action` after `actionIdx` (use -1 to prepend). */
export function insertActionAfter(doc: DeckDoc, flatIdx: number, actionIdx: number, action: Action): DeckDoc {
  return mapTimeline(doc, flatIdx, (tl) => [...tl.slice(0, actionIdx + 1), action, ...tl.slice(actionIdx + 1)]);
}

export function deleteActionAt(doc: DeckDoc, flatIdx: number, actionIdx: number): DeckDoc {
  return mapTimeline(doc, flatIdx, (tl) => (actionIdx < 0 || actionIdx >= tl.length ? tl : tl.filter((_, i) => i !== actionIdx)));
}

/** Swap an action with its neighbour. Returns the same doc at a timeline boundary. */
export function moveActionBy(doc: DeckDoc, flatIdx: number, actionIdx: number, dir: -1 | 1): DeckDoc {
  const loc = beatLocation(doc, flatIdx);
  if (!loc) return doc;
  const tl = doc.scenes[loc.sceneIdx].beats[loc.beatIdx].timeline;
  const target = actionIdx + dir;
  if (actionIdx < 0 || actionIdx >= tl.length || target < 0 || target >= tl.length) return doc;
  return mapTimeline(doc, flatIdx, (t) => {
    const next = t.slice();
    [next[actionIdx], next[target]] = [next[target], next[actionIdx]];
    return next;
  });
}

export function duplicateActionAt(doc: DeckDoc, flatIdx: number, actionIdx: number): DeckDoc {
  const loc = beatLocation(doc, flatIdx);
  if (!loc) return doc;
  const tl = doc.scenes[loc.sceneIdx].beats[loc.beatIdx].timeline;
  if (actionIdx < 0 || actionIdx >= tl.length) return doc;
  const copy = JSON.parse(JSON.stringify(tl[actionIdx])) as Action;
  return mapTimeline(doc, flatIdx, (t) => [...t.slice(0, actionIdx + 1), copy, ...t.slice(actionIdx + 1)]);
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run tests/unit/action-mutations.test.ts tests/unit/mutations.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean; the existing `mutations.test.ts` still passes.

- [ ] **Step 5: Commit**

```bash
git add lib/editor/mutations.ts tests/unit/action-mutations.test.ts
git commit -m "feat(editor): pure DeckDoc action mutations"
```

---

## Task 3: Store action methods

**Files:**
- Modify: `lib/editor/store.ts`
- Test: `tests/unit/store-actions.test.ts` (new)

Thin wrappers over `commit()`, mirroring the beat methods, that also keep `selectedAction` sensible.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/store-actions.test.ts`:

```ts
import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s", beats: [{ id: "b", timeline: [{ kind: "text", value: "hi", in: "fade" }] }] },
] };

beforeEach(() => useEditor.setState({ doc: null, beats: [], selected: 0, selectedAction: null, past: [], future: [], revision: 0 }));

test("addAction inserts after the index, selects it, and is undoable", () => {
  const s = useEditor.getState();
  s.load(doc);
  s.addAction(0, 0, { kind: "wait", ms: 250 });
  expect(useEditor.getState().beats[0].beat.timeline.map((a) => a.kind)).toEqual(["text", "wait"]);
  expect(useEditor.getState().selectedAction).toBe(1);
  useEditor.getState().undo();
  expect(useEditor.getState().beats[0].beat.timeline.map((a) => a.kind)).toEqual(["text"]);
});

test("deleteAction removes + clears selection", () => {
  const s = useEditor.getState();
  s.load(doc);
  s.selectAction(0);
  s.deleteAction(0, 0);
  expect(useEditor.getState().beats[0].beat.timeline.length).toBe(0);
  expect(useEditor.getState().selectedAction).toBeNull();
});

test("moveAction reorders + follows the selection", () => {
  const s = useEditor.getState();
  s.load(doc);
  s.addAction(0, 0, { kind: "wait", ms: 250 }); // [text, wait], selectedAction = 1
  s.moveAction(0, 1, -1);                        // wait → index 0
  expect(useEditor.getState().beats[0].beat.timeline.map((a) => a.kind)).toEqual(["wait", "text"]);
  expect(useEditor.getState().selectedAction).toBe(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/store-actions.test.ts`
Expected: FAIL — `addAction`/`deleteAction`/`moveAction`/`duplicateAction` are not defined.

- [ ] **Step 3: Add the imports + interface entries + methods to `lib/editor/store.ts`**

In `lib/editor/store.ts`, extend the mutations import to:

```ts
import { insertBeatAfter, duplicateBeatAt, deleteBeatAt, moveBeatBy, appendScene, deleteSceneAt, insertActionAfter, deleteActionAt, moveActionBy, duplicateActionAt } from "./mutations";
```

Add these signatures to the `EditorState` interface, immediately after `deleteScene: (flatIdx: number) => void;`:

```ts
  addAction: (flatIdx: number, afterIdx: number, action: import("@/engine/deck/types").Action) => void;
  deleteAction: (flatIdx: number, actionIdx: number) => void;
  moveAction: (flatIdx: number, actionIdx: number, dir: -1 | 1) => void;
  duplicateAction: (flatIdx: number, actionIdx: number) => void;
```

Add these implementations to the object returned by `create(...)`, immediately after the `deleteScene: ...` implementation (before the closing `}))`):

```ts
  addAction: (flatIdx, afterIdx, action) => set((s) => {
    if (!s.doc) return {};
    const part = commit(s, (doc) => insertActionAfter(doc, flatIdx, afterIdx, action));
    if (!part.doc) return {};
    return { ...part, selectedAction: afterIdx + 1 };
  }),
  deleteAction: (flatIdx, actionIdx) => set((s) => {
    if (!s.doc) return {};
    const part = commit(s, (doc) => deleteActionAt(doc, flatIdx, actionIdx));
    if (!part.doc) return {};
    return { ...part, selectedAction: null };
  }),
  moveAction: (flatIdx, actionIdx, dir) => set((s) => {
    if (!s.doc) return {};
    const next = moveActionBy(s.doc, flatIdx, actionIdx, dir);
    if (next === s.doc) return {};
    return { ...commit(s, () => next), selectedAction: actionIdx + dir };
  }),
  duplicateAction: (flatIdx, actionIdx) => set((s) => {
    if (!s.doc) return {};
    const part = commit(s, (doc) => duplicateActionAt(doc, flatIdx, actionIdx));
    if (!part.doc) return {};
    return { ...part, selectedAction: actionIdx + 1 };
  }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/store-actions.test.ts tests/unit/store-history.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/editor/store.ts tests/unit/store-actions.test.ts
git commit -m "feat(editor): store action methods (add/delete/move/duplicate)"
```

---

## Task 4: Timeline action CRUD UI + gate dividers

**Files:**
- Modify: `components/editor/Timeline.tsx`
- Modify: `app/editor/editor.css`
- Test: `e2e/action-crud.spec.ts` (new)

Adds an "add action" menu, a per-action control strip (move/duplicate/delete) shown when an action is selected, and a divider style for `click_gate` chips. The store logic landed in Task 3; this is wiring + a thin e2e (the chip/menu interactions render the full canvas, so they're proven end-to-end, not in jsdom — same rationale as Plan 3c).

- [ ] **Step 1: Rebuild `components/editor/Timeline.tsx`**

Replace the entire contents of `components/editor/Timeline.tsx` with:

```tsx
"use client";
import type { RefObject } from "react";
import { useEditor } from "@/lib/editor/store";
import type { CanvasHandle } from "./DeckCanvas";
import { actionDuration } from "@/engine/authoring/seek";
import { ADDABLE_KINDS, newAction } from "@/lib/editor/registry";
import type { Action } from "@/engine/deck/types";

export function Timeline({ canvasRef, time }: { canvasRef: RefObject<CanvasHandle | null>; time: { t: number; duration: number } }) {
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const selectedAction = useEditor((s) => s.selectedAction);
  const selectAction = useEditor((s) => s.selectAction);
  const addAction = useEditor((s) => s.addAction);
  const deleteAction = useEditor((s) => s.deleteAction);
  const moveAction = useEditor((s) => s.moveAction);
  const duplicateAction = useEditor((s) => s.duplicateAction);
  const timeline = beats[selected]?.beat.timeline ?? [];
  const hasBeat = beats.length > 0;

  const onAdd = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const kind = e.target.value as Action["kind"];
    if (!kind) return;
    addAction(selected, selectedAction ?? timeline.length - 1, newAction(kind));
    e.target.value = "";
  };

  return (
    <div className="ed__timeline" data-testid="timeline">
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="ed__pill ed__pill--ghost" onClick={() => canvasRef.current?.play()}>&#9654; Play</button>
        <button className="ed__pill ed__pill--ghost" onClick={() => canvasRef.current?.pause()}>&#9646;&#9646; Pause</button>
        <span style={{ fontFamily: "var(--ed-mono)", fontSize: 12, color: "var(--ed-fg-muted)", alignSelf: "center" }}>
          {time.t.toFixed(2)}s / {time.duration.toFixed(2)}s
        </span>
        <select className="ed__pill ed__pill--ghost" data-testid="action-add" defaultValue="" onChange={onAdd} disabled={!hasBeat} style={{ marginLeft: "auto" }}>
          <option value="">＋ Add action…</option>
          {ADDABLE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
        {selectedAction != null && (
          <span style={{ display: "flex", gap: 2 }}>
            <button className="ed__icon" title="Move left" data-testid="action-left" onClick={() => moveAction(selected, selectedAction, -1)}>←</button>
            <button className="ed__icon" title="Move right" data-testid="action-right" onClick={() => moveAction(selected, selectedAction, 1)}>→</button>
            <button className="ed__icon" title="Duplicate" data-testid="action-dupe" onClick={() => duplicateAction(selected, selectedAction)}>⧉</button>
            <button className="ed__icon" title="Delete" data-testid="action-delete" onClick={() => deleteAction(selected, selectedAction)}>✕</button>
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
        {timeline.map((a, i) => (
          <button key={i} className={`ed__chip${a.kind === "click_gate" ? " ed__chip--gate" : ""}`} onClick={() => selectAction(i)} aria-current={i === selectedAction ? "true" : undefined}>
            {a.kind === "click_gate" ? "┃ gate ┃" : <>{a.kind}{a.kind === "text" ? `:${a.in}` : ""}{a.kind === "wait" ? ` ${a.ms}ms` : ""}{" "}
            <span style={{ color: "var(--ed-fg-muted)" }}>({actionDuration(a).toFixed(1)}s)</span></>}
          </button>
        ))}
        {!timeline.length && <span style={{ color: "var(--ed-fg-muted)" }}>empty beat</span>}
      </div>
      <input type="range" min={0} max={time.duration || 0} step={0.01} value={time.t}
        onChange={(e) => canvasRef.current?.seek(parseFloat(e.target.value))} style={{ width: "100%" }} data-testid="scrub" />
    </div>
  );
}
```

> `onAdd` inserts after the selected action, or after the last action when nothing is selected (`selectedAction ?? timeline.length - 1`; on an empty beat that's `-1`, i.e. prepend). The store selects the new action, so the inspector immediately edits it.

- [ ] **Step 2: Add the gate-chip style to `app/editor/editor.css`**

Append to `app/editor/editor.css`:

```css
.ed__chip--gate { background: rgba(212,168,67,0.16); border-color: var(--ed-accent); color: var(--ed-accent); font-family: var(--ed-mono); letter-spacing: 0.04em; }
.ed__timeline select.ed__pill { background: var(--ed-bg-2); }
```

- [ ] **Step 3: Write the action-CRUD e2e**

Create `e2e/action-crud.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("add / delete actions in a beat, with undo", async ({ page, request }) => {
  const id = "e2e-3d-actions";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Actions" }, scenes: [
    { id: "s", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Actions" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const chips = page.getByTestId("timeline").locator(".ed__chip");
  await expect(chips).toHaveCount(1);

  await page.getByTestId("action-add").selectOption("wait");
  await expect(chips).toHaveCount(2);

  // the new action is selected → its controls show; delete it
  await page.getByTestId("action-delete").click();
  await expect(chips).toHaveCount(1);

  await page.getByTestId("undo").click();
  await expect(chips).toHaveCount(2);

  await request.delete(`/api/decks/${id}`);
});
```

- [ ] **Step 4: Verify types + the e2e**

Run:
```bash
cd /Users/chris/projects/morgana && lsof -ti :3000 :3100 | xargs kill -9 2>/dev/null || true
npx tsc --noEmit && npm run test:e2e -- e2e/action-crud.spec.ts e2e/editor.spec.ts
```
Expected: tsc clean; `action-crud` PASSES (add → 2 chips, delete → 1, undo → 2); the existing `editor` spec still PASSES (timeline scrub/select unregressed).

- [ ] **Step 5: Commit**

```bash
git add components/editor/Timeline.tsx app/editor/editor.css e2e/action-crud.spec.ts
git commit -m "feat(editor): timeline action CRUD + gate dividers"
```

---

## Task 5: Text styling — type + seek render + inspector

**Files:**
- Modify: `engine/deck/types.ts`
- Modify: `engine/authoring/seek.ts`
- Modify: `lib/editor/registry.ts`
- Test: `tests/unit/seek-styling.test.ts` (new)

Per-line `bold`/`italic` + `TextSize` widened to `xs/sm/md/lg/xl`, applied as inline styles in the editor preview (the canvas doesn't mount `CinematicSlide`, so classes alone wouldn't size text). The inspector picks them up automatically from the registry schema.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/seek-styling.test.ts`:

```ts
import { expect, test } from "vitest";
import { renderBeatAt } from "@/engine/authoring/seek";

test("bold/italic/size render as inline styles on the line", () => {
  const host = document.createElement("div");
  renderBeatAt([{ kind: "text", value: "Styled", in: "fade", bold: true, italic: true, size: "xl" }], 99, { textHost: host, art: null });
  const p = host.querySelector("p")!;
  expect(p.style.fontWeight).toBe("700");
  expect(p.style.fontStyle).toBe("italic");
  expect(p.style.fontSize).not.toBe("");
  expect(p.className).toContain("cin__line--xl");
});

test("unstyled text leaves weight/style unset", () => {
  const host = document.createElement("div");
  renderBeatAt([{ kind: "text", value: "Plain", in: "fade" }], 99, { textHost: host, art: null });
  const p = host.querySelector("p")!;
  expect(p.style.fontWeight).toBe("");
  expect(p.style.fontStyle).toBe("");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/seek-styling.test.ts`
Expected: FAIL — seek doesn't set fontWeight/fontStyle/fontSize, and (after the type change) `bold`/`italic` aren't valid yet.

- [ ] **Step 3: Widen `TextSize` and add `bold`/`italic` in `engine/deck/types.ts`**

In `engine/deck/types.ts`, change the `TextSize` line:

```ts
export type TextSize = "lg" | "md" | "sm";
```

to:

```ts
export type TextSize = "xs" | "sm" | "md" | "lg" | "xl";
```

Then change the `text` action member of the `Action` union (the line starting `| { kind: "text"; value: string; in: TextIn; ...`) to add `bold?` and `italic?`:

```ts
  | { kind: "text"; value: string; in: TextIn; size?: TextSize; align?: TextAlign; speed?: number; dots?: true; pos?: StagePoint; append?: true; tone?: SlideTheme; screenOnly?: true; reveal?: true; bold?: boolean; italic?: boolean }
```

- [ ] **Step 4: Render the styles in `engine/authoring/seek.ts`**

In `engine/authoring/seek.ts`, add this size map immediately after the `DOTFADE_TAIL` constant (around line 9):

```ts
/** Editor-preview font sizes (the canvas doesn't mount CinematicSlide, so size is inline). */
const TEXT_SIZE_PREVIEW: Record<TextSize, string> = {
  xs: "clamp(0.7rem, 2cqmin, 1.1rem)",
  sm: "clamp(0.9rem, 2.6cqmin, 1.4rem)",
  md: "clamp(1.1rem, 3.2cqmin, 1.7rem)",
  lg: "clamp(1.6rem, 4.6cqmin, 2.8rem)",
  xl: "clamp(2.2rem, 6cqmin, 3.8rem)",
};
```

Then extend the import on line 1 to include `TextSize`:

```ts
import type { Action, TextIn, TextSize } from "@/engine/deck/types";
```

In the `applyAt` function's `case "text":` block, add three lines immediately after `el.style.opacity = String(p);`:

```ts
      el.style.fontSize = TEXT_SIZE_PREVIEW[a.size ?? "lg"];
      if (a.bold) el.style.fontWeight = "700";
      if (a.italic) el.style.fontStyle = "italic";
```

- [ ] **Step 5: Add the inspector fields in `lib/editor/registry.ts`**

In `lib/editor/registry.ts`, in the `text` descriptor's `schema`, change the `size` field and append `bold`/`italic`. Replace:

```ts
    { key: "size", label: "Size", type: "select", options: opts("lg", "md", "sm") },
    { key: "align", label: "Align", type: "select", options: opts("left", "center", "right") },
```

with:

```ts
    { key: "size", label: "Size", type: "select", options: opts("xs", "sm", "md", "lg", "xl") },
    { key: "align", label: "Align", type: "select", options: opts("left", "center", "right") },
    { key: "bold", label: "Bold", type: "checkbox" },
    { key: "italic", label: "Italic", type: "checkbox" },
```

- [ ] **Step 6: Run the tests + types to verify they pass**

Run: `npx vitest run tests/unit/seek-styling.test.ts tests/unit/seek.test.ts tests/unit/registry-richer.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean; the existing `seek` tests still pass (the new inline styles don't touch their assertions).

- [ ] **Step 7: Commit**

```bash
git add engine/deck/types.ts engine/authoring/seek.ts lib/editor/registry.ts tests/unit/seek-styling.test.ts
git commit -m "feat(editor): per-line text bold/italic + finer size (editor preview)"
```

---

## Task 6: Text styling — real-engine parity (present mode)

**Files:**
- Modify: `engine/components/layouts/CinematicSlide.tsx`

Brings the real GSAP engine (present mode + the `/dev/beatstage` harness) to parity: bold/italic on built lines and CSS for the new `xs`/`xl` sizes. The full GSAP/DOM stack is not unit-tested in jsdom (matches the codebase's testing philosophy — Plan 3c, Task 2); this task is verified by `tsc` + the existing `beatstage` e2e staying green. **If 3d needs trimming, this is the cut: the editor preview (Task 5) already shows styling; this only affects present mode + exported decks.**

- [ ] **Step 1: Extend `appendText` to accept bold/italic**

In `engine/components/layouts/CinematicSlide.tsx`, change the `appendText` signature (line ~244) from:

```ts
  function appendText(host: HTMLElement, value: string, size?: TextSize, align?: TextAlign, dots?: boolean, instant = false, tone?: SlideTheme) {
```

to:

```ts
  function appendText(host: HTMLElement, value: string, size?: TextSize, align?: TextAlign, dots?: boolean, instant = false, tone?: SlideTheme, bold?: boolean, italic?: boolean) {
```

Then, immediately after the line `if (align) p.style.textAlign = align;` (line ~249), add:

```ts
    if (bold) p.style.fontWeight = "700";
    if (italic) p.style.fontStyle = "italic";
```

- [ ] **Step 2: Pass bold/italic at the three text call sites**

In the same file, update all three `appendText(...)` calls that render a `text` action — replace each `, a.tone)` tail on those three lines with `, a.tone, a.bold, a.italic)`:

Line ~152 (static replay):
```ts
            : appendText(a.pos ? makeLineBox(a.pos, a.align) : textHost, a.value, a.size, a.align, a.dots, true, a.tone, a.bold, a.italic);
```

Line ~449 (animated path, instant=true):
```ts
              : appendText(a.pos ? makeLineBox(a.pos, a.align) : host, a.value, a.size, a.align, a.dots, true, a.tone, a.bold, a.italic);
```

Line ~463 (animated path, instant=false):
```ts
            : appendText(a.pos ? makeLineBox(a.pos, a.align) : host, a.value, a.size, a.align, a.dots, false, a.tone, a.bold, a.italic);
```

> The `rotateList` (`appendText(textHost, a.items[0], ...)`) and counter/media call sites are left unchanged — they don't carry bold/italic.

- [ ] **Step 3: Add CSS for the new `xs`/`xl` sizes**

In the same file's injected `<style>` block, immediately after the line `.cin__line--sm { opacity: 0.85; }` (line ~605), add base + treatment-scoped rules for the new sizes:

```css
        .cin__line--xl { font-weight: 900; }
        .deck--warm .cin__line--xl, .deck--paper .cin__line--xl { font-size: clamp(2.6rem, 7cqmin, 4.6rem); line-height: 1.04; }
        .deck--warm .cin__line--xs, .deck--paper .cin__line--xs { font-size: clamp(0.85rem, 2.2cqmin, 1.2rem); font-family: var(--font-body); line-height: 1.4; opacity: 1; }
```

- [ ] **Step 4: Verify types + no engine regression**

Run:
```bash
cd /Users/chris/projects/morgana && lsof -ti :3000 :3100 | xargs kill -9 2>/dev/null || true
npx tsc --noEmit && npm run test:e2e -- e2e/beatstage.spec.ts
```
Expected: tsc clean; the `beatstage` e2e still PASSES (the styling additions are backward-compatible — unset bold/italic/xs/xl don't change existing decks).

- [ ] **Step 5: Commit**

```bash
git add engine/components/layouts/CinematicSlide.tsx
git commit -m "feat(engine): text bold/italic + xs/xl sizes in CinematicSlide (present-mode parity)"
```

---

## Task 7: Self-hosted font bundle (migrate off next/font + starter library)

**Files:**
- Create: `lib/fonts/fonts.json`, `lib/fonts/catalog.ts`, `scripts/sync-fonts.mjs`, `app/fonts.css` (generated)
- Create (vendored): `public/fonts/<family>/*.woff2`, `public/fonts/LICENSES/*`
- Modify: `app/layout.tsx`, `package.json`
- Test: `tests/unit/fonts-catalog.test.ts` (new)

Migrate the 3 current families (kept as defaults → **zero visual change**) plus 5 more into a self-hosted bundle. The woff2 source is the OFL `@fontsource/*` packages; a sync script vendors latin woff2 into `public/fonts/` and generates `@font-face`. This realizes design §5.2 and removes the build-time Google dependency.

- [ ] **Step 1: Add the OFL font packages as devDependencies**

Run:
```bash
cd /Users/chris/projects/morgana
npm i -D @fontsource/londrina-solid @fontsource/bebas-neue @fontsource/space-grotesk @fontsource/atkinson-hyperlegible @fontsource/inter @fontsource/source-serif-4 @fontsource/dancing-script @fontsource/caveat
```

- [ ] **Step 2: Confirm the woff2 file naming for each package**

Run:
```bash
cd /Users/chris/projects/morgana
for p in londrina-solid bebas-neue space-grotesk atkinson-hyperlegible inter source-serif-4 dancing-script caveat; do echo "== $p =="; ls node_modules/@fontsource/$p/files/ | grep -E 'latin-(400|700|900)-normal\.woff2' || ls node_modules/@fontsource/$p/files/ | grep latin | head -3; done
```
Expected: each prints files like `inter-latin-400-normal.woff2`. **If a requested weight is missing for a family, edit that family's `weights` in `lib/fonts/fonts.json` (Step 3) to the nearest available weight before running the sync.**

- [ ] **Step 3: Create the manifest `lib/fonts/fonts.json`**

```json
{
  "defaults": { "display": "Londrina Solid", "body": "Atkinson Hyperlegible", "cursive": "Dancing Script" },
  "families": [
    { "family": "Londrina Solid", "pkg": "londrina-solid", "role": "display", "weights": [400, 900], "license": "OFL-1.1" },
    { "family": "Bebas Neue", "pkg": "bebas-neue", "role": "display", "weights": [400], "license": "OFL-1.1" },
    { "family": "Space Grotesk", "pkg": "space-grotesk", "role": "display", "weights": [400, 700], "license": "OFL-1.1" },
    { "family": "Atkinson Hyperlegible", "pkg": "atkinson-hyperlegible", "role": "body", "weights": [400, 700], "license": "OFL-1.1" },
    { "family": "Inter", "pkg": "inter", "role": "body", "weights": [400, 700], "license": "OFL-1.1" },
    { "family": "Source Serif 4", "pkg": "source-serif-4", "role": "body", "weights": [400, 700], "license": "OFL-1.1" },
    { "family": "Dancing Script", "pkg": "dancing-script", "role": "cursive", "weights": [400, 700], "license": "OFL-1.1" },
    { "family": "Caveat", "pkg": "caveat", "role": "cursive", "weights": [400, 700], "license": "OFL-1.1" }
  ]
}
```

- [ ] **Step 4: Create the sync script `scripts/sync-fonts.mjs`**

```js
// Vendors latin woff2 from @fontsource into public/fonts/, copies licenses, and
// generates app/fonts.css (@font-face + default --font-* vars). Run via `npm run sync:fonts`.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "lib/fonts/fonts.json"), "utf8"));
const outDir = join(root, "public/fonts");
mkdirSync(join(outDir, "LICENSES"), { recursive: true });

const faces = [];
for (const f of manifest.families) {
  const pkgDir = join(root, "node_modules/@fontsource", f.pkg);
  const famDir = join(outDir, f.pkg);
  mkdirSync(famDir, { recursive: true });
  const lic = ["LICENSE", "LICENSE.md", "LICENSE.txt"].map((n) => join(pkgDir, n)).find(existsSync);
  if (lic) copyFileSync(lic, join(outDir, "LICENSES", `${f.pkg}.txt`));
  for (const w of f.weights) {
    const src = join(pkgDir, "files", `${f.pkg}-latin-${w}-normal.woff2`);
    if (!existsSync(src)) throw new Error(`missing woff2: ${src} (fix weights in fonts.json)`);
    const fileName = `${f.pkg}-${w}.woff2`;
    copyFileSync(src, join(famDir, fileName));
    faces.push(
      `@font-face { font-family: '${f.family}'; font-style: normal; font-weight: ${w}; font-display: swap; src: url('/fonts/${f.pkg}/${fileName}') format('woff2'); }`,
    );
  }
}

const d = manifest.defaults;
const css =
  `/* GENERATED by scripts/sync-fonts.mjs — do not edit by hand. */\n` +
  `:root {\n` +
  `  --font-display: '${d.display}', system-ui, sans-serif;\n` +
  `  --font-body: '${d.body}', system-ui, sans-serif;\n` +
  `  --font-cursive: '${d.cursive}', cursive;\n` +
  `}\n` +
  faces.join("\n") + "\n";
writeFileSync(join(root, "app/fonts.css"), css);
console.log(`sync-fonts: ${manifest.families.length} families, ${faces.length} faces → app/fonts.css`);
```

- [ ] **Step 5: Add the `sync:fonts` script and run it**

In `package.json`, add to `"scripts"` (after the `"seed:demo"` line):

```json
    "sync:fonts": "node scripts/sync-fonts.mjs",
```

Run:
```bash
cd /Users/chris/projects/morgana && npm run sync:fonts && ls public/fonts && head -8 app/fonts.css
```
Expected: prints the family count; `public/fonts/<pkg>/*.woff2` exist; `app/fonts.css` starts with the `:root { --font-display … }` block.

- [ ] **Step 6: Migrate `app/layout.tsx` off `next/font/google`**

Replace the entire contents of `app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import "./globals.css";
import "./fonts.css";

export const metadata: Metadata = { title: "Morgana", description: "Cinematic deck editor" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

> `--font-display/body/cursive` now come from `app/fonts.css`'s `:root` block (the old next/font `variable` classes are gone). The editor chrome's `--mm-font-display: 'Londrina Solid'` (mm-tokens.css) now resolves against the bundled `@font-face`, so both deck and editor-chrome text keep their fonts.

- [ ] **Step 7: Create the catalog loader `lib/fonts/catalog.ts`**

```ts
import manifest from "./fonts.json";

export type FontRole = "display" | "body" | "cursive";
export interface FontEntry { family: string; pkg: string; role: FontRole; weights: number[]; license: string; }

export const FONT_DEFAULTS = manifest.defaults as Record<FontRole, string>;
export const FONT_CATALOG = manifest.families as FontEntry[];

/** Families for the picker; pass a role to filter, omit for all. */
export function fontFamilies(role?: FontRole): FontEntry[] {
  return role ? FONT_CATALOG.filter((f) => f.role === role) : FONT_CATALOG;
}
```

> `import manifest from "./fonts.json"` requires `resolveJsonModule` — Next/TS enable it by default. If `tsc` complains, add `"resolveJsonModule": true` under `compilerOptions` in `tsconfig.json`.

- [ ] **Step 8: Write the catalog test**

Create `tests/unit/fonts-catalog.test.ts`:

```ts
import { expect, test } from "vitest";
import { FONT_CATALOG, FONT_DEFAULTS, fontFamilies } from "@/lib/fonts/catalog";

test("catalog has the starter library and the 3 defaults", () => {
  expect(FONT_CATALOG.length).toBeGreaterThanOrEqual(8);
  const names = FONT_CATALOG.map((f) => f.family);
  expect(names).toEqual(expect.arrayContaining(["Londrina Solid", "Atkinson Hyperlegible", "Dancing Script", "Inter"]));
  expect(names).toContain(FONT_DEFAULTS.display);
  expect(names).toContain(FONT_DEFAULTS.body);
  expect(names).toContain(FONT_DEFAULTS.cursive);
});

test("fontFamilies filters by role", () => {
  expect(fontFamilies("cursive").every((f) => f.role === "cursive")).toBe(true);
  expect(fontFamilies().length).toBe(FONT_CATALOG.length);
});
```

- [ ] **Step 9: Verify types, unit, build, and no visual regression**

Run:
```bash
cd /Users/chris/projects/morgana && lsof -ti :3000 :3100 | xargs kill -9 2>/dev/null || true
npx tsc --noEmit && npx vitest run tests/unit/fonts-catalog.test.ts && npm run build && npm run test:e2e -- e2e/theme.spec.ts e2e/editor.spec.ts
```
Expected: tsc clean; catalog test PASSES; `npm run build` succeeds **without any next/font network fetch**; the `theme` + `editor` e2e still PASS (fonts render; defaults unchanged).

- [ ] **Step 10: Commit (including the vendored woff2)**

```bash
git add lib/fonts/ scripts/sync-fonts.mjs app/fonts.css app/layout.tsx package.json package-lock.json public/fonts/ tests/unit/fonts-catalog.test.ts
git commit -m "feat(fonts): self-hosted OFL font bundle + manifest; drop next/font/google"
```

---

## Task 8: Per-deck font picker

**Files:**
- Modify: `engine/deck-doc.ts`
- Modify: `components/editor/DeckSettings.tsx`
- Modify: `components/editor/DeckCanvas.tsx`
- Test: `tests/unit/deck-meta-fonts.test.ts` (new), `e2e/font-picker.spec.ts` (new)

`meta.fonts` holds the per-deck choice; Deck Settings picks from the catalog; the canvas applies the choice as deck-scoped CSS vars. (Per the brainstorm, `deckDocToModule` exports scenes only — per-deck fonts round-trip through the deck JSON save/load, which is the binding test here.)

- [ ] **Step 1: Add `fonts` to `DeckMeta`**

In `engine/deck-doc.ts`, add a `fonts` field to the `DeckMeta` interface (after `chrome?: DeckChrome;`):

```ts
  fonts?: { display?: string; body?: string; cursive?: string };
```

- [ ] **Step 2: Write the store unit test**

Create `tests/unit/deck-meta-fonts.test.ts`:

```ts
import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s", beats: [{ id: "b", timeline: [] }] },
] };

beforeEach(() => useEditor.setState({ doc: null, beats: [], selected: 0, selectedAction: null, past: [], future: [], revision: 0 }));

test("updateMeta sets nested meta.fonts.display", () => {
  const s = useEditor.getState();
  s.load(doc);
  s.updateMeta("fonts.display", "Inter");
  expect(useEditor.getState().doc!.meta.fonts).toEqual({ display: "Inter" });
});
```

- [ ] **Step 3: Run it to verify it passes (meta.fonts is now a valid type)**

Run: `npx vitest run tests/unit/deck-meta-fonts.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean. (`updateMeta`/`setPath` already create nested objects; this test guards the new type + path.)

- [ ] **Step 4: Add font pickers to `components/editor/DeckSettings.tsx`**

Replace the entire contents of `components/editor/DeckSettings.tsx` with:

```tsx
"use client";
import { useEditor } from "@/lib/editor/store";
import { getPath } from "@/lib/editor/paths";
import { Field } from "./Field";
import type { Field as FieldSpec } from "@/lib/editor/registry";
import { fontFamilies, type FontRole } from "@/lib/fonts/catalog";

const FIELDS: FieldSpec[] = [
  { key: "title", label: "Deck title", type: "text" },
  { key: "chrome.splash.tagline", label: "Splash tagline", type: "text" },
  { key: "chrome.splash.logo", label: "Splash logo (filename)", type: "text" },
  { key: "chrome.wordmark", label: "Footer wordmark", type: "text" },
];

const fontField = (role: FontRole, label: string): FieldSpec => ({
  key: `fonts.${role}`,
  label,
  type: "select",
  options: [{ value: "", label: "(theme default)" }, ...fontFamilies().map((f) => ({ value: f.family, label: `${f.family} · ${f.role}` }))],
});

const FONT_FIELDS: FieldSpec[] = [
  fontField("display", "Display font"),
  fontField("body", "Body font"),
  fontField("cursive", "Cursive font"),
];

export function DeckSettings() {
  const doc = useEditor((s) => s.doc);
  const updateMeta = useEditor((s) => s.updateMeta);
  if (!doc) return <div className="ed__inspector" data-testid="deck-settings"><p style={{ opacity: 0.6 }}>No deck.</p></div>;
  return (
    <div className="ed__inspector" data-testid="deck-settings">
      <div style={{ fontFamily: "var(--ed-disp)", fontSize: 14, marginBottom: 11 }}>Deck settings</div>
      {FIELDS.map((f) => (
        <Field key={f.key} spec={f} value={getPath(doc.meta, f.key)} onChange={(v) => updateMeta(f.key, v)} />
      ))}
      <div style={{ fontFamily: "var(--ed-disp)", fontSize: 13, margin: "14px 0 8px", color: "var(--ed-fg-muted)" }}>Typography</div>
      {FONT_FIELDS.map((f) => (
        <Field key={f.key} spec={f} value={getPath(doc.meta, f.key)} onChange={(v) => updateMeta(f.key, v || undefined)} />
      ))}
    </div>
  );
}
```

> `onChange={(v) => updateMeta(f.key, v || undefined)}` stores `undefined` for the "(theme default)" empty option, so an unset font falls back to the bundle default rather than persisting an empty string.

- [ ] **Step 5: Apply `meta.fonts` as CSS vars in `components/editor/DeckCanvas.tsx`**

In `components/editor/DeckCanvas.tsx`, read the deck fonts from the store and apply them to the host. Add this selector inside the `DeckCanvas` function body, right after the existing `const [night, setNight] = useState(0.6);` line:

```tsx
    const fonts = useEditor((s) => s.doc?.meta.fonts);
    const fontVars = {
      ...(fonts?.display ? { ["--font-display"]: `'${fonts.display}'` } : {}),
      ...(fonts?.body ? { ["--font-body"]: `'${fonts.body}'` } : {}),
      ...(fonts?.cursive ? { ["--font-cursive"]: `'${fonts.cursive}'` } : {}),
    } as React.CSSProperties;
```

Then merge `fontVars` into the host `<div>`'s `style` — change the opening host div's style prop from:

```tsx
      <div ref={host} className="ed__canvas-host" style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", maxHeight: "100%", margin: "auto", containerType: "size", overflow: "hidden", background: "var(--color-mm-dark-brown)", boxShadow: "0 4px 24px rgba(0,0,0,0.4)" }}>
```

to:

```tsx
      <div ref={host} className="ed__canvas-host" style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", maxHeight: "100%", margin: "auto", containerType: "size", overflow: "hidden", background: "var(--color-mm-dark-brown)", boxShadow: "0 4px 24px rgba(0,0,0,0.4)", ...fontVars }}>
```

- [ ] **Step 6: Write the font-picker e2e**

Create `e2e/font-picker.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("picking a deck font persists and applies as a CSS var", async ({ page, request }) => {
  const id = "e2e-3d-fonts";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Fonts" }, scenes: [
    { id: "s", beats: [{ id: "a", timeline: [{ kind: "text", value: "Hi", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Fonts" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await page.getByTestId("deck-settings-toggle").click();
  await page.getByTestId("deck-settings").locator("select").last().waitFor();
  // the display-font select is the first select in the Typography group → use the labeled one
  const displaySelect = page.getByTestId("deck-settings").locator("select").nth(0); // chrome has no selects → fonts first
  await displaySelect.selectOption("Inter");
  await expect(page.getByTestId("save-status")).toHaveText("Saved", { timeout: 15000 });

  // applied to the canvas host as a CSS var
  const varVal = await page.locator(".ed__canvas-host").evaluate((el) => getComputedStyle(el).getPropertyValue("--font-display"));
  expect(varVal).toContain("Inter");

  await page.reload();
  await page.getByTestId("deck-settings-toggle").click();
  await expect(page.getByTestId("deck-settings").locator("select").nth(0)).toHaveValue("Inter");

  await request.delete(`/api/decks/${id}`);
});
```

> `DeckSettings` renders the 4 text `<input>`s then the 3 font `<select>`s, so `select` index 0 is the display-font picker.

- [ ] **Step 7: Verify types + the e2e**

Run:
```bash
cd /Users/chris/projects/morgana && lsof -ti :3000 :3100 | xargs kill -9 2>/dev/null || true
npx tsc --noEmit && npx vitest run tests/unit/deck-meta-fonts.test.ts && npm run test:e2e -- e2e/font-picker.spec.ts e2e/deck-settings.spec.ts
```
Expected: tsc clean; unit PASS; `font-picker` PASSES (var contains Inter, survives reload); the existing `deck-settings` spec still PASSES.

- [ ] **Step 8: Commit**

```bash
git add engine/deck-doc.ts components/editor/DeckSettings.tsx components/editor/DeckCanvas.tsx tests/unit/deck-meta-fonts.test.ts e2e/font-picker.spec.ts
git commit -m "feat(editor): per-deck font picker + canvas application"
```

---

## Task 9: Deck management UI + delete-scene wire-up

**Files:**
- Modify: `app/editor/page.tsx`
- Modify: `components/editor/Filmstrip.tsx`
- Modify: `app/editor/editor.css`
- Test: `e2e/deck-manage.spec.ts` (new)

A toolbar deck switcher (over `listDecks`), New (prompt → `createDeck`), Delete (confirm → `deleteDeck`), and the trivial `deleteScene` filmstrip button. Switching navigates via `?deck=` (full reload reloads the deck cleanly).

- [ ] **Step 1: Add a delete-scene button to `components/editor/Filmstrip.tsx`**

In `components/editor/Filmstrip.tsx`, add `deleteScene` to the store selectors (after the `addScene` selector):

```tsx
  const deleteScene = useEditor((s) => s.deleteScene);
```

Then add a per-scene delete button next to the scene label. Change the scene-label line:

```tsx
          <div className="ed__lbl">{g.sceneId}</div>
```

to:

```tsx
          <div className="ed__lbl" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{g.sceneId}</span>
            {groups.length > 1 && (
              <button className="ed__icon" title="Delete scene" data-testid="scene-delete" onClick={() => deleteScene(g.items[0].flatIdx)}>✕</button>
            )}
          </div>
```

> Guarded by `groups.length > 1` so the last scene can't be deleted out from under the editor.

- [ ] **Step 2: Add the deck-switcher toolbar to `app/editor/page.tsx`**

In `app/editor/page.tsx`, add imports for the deck APIs and `useState` for the deck list. Change the existing client import line:

```tsx
import { loadDeck } from "@/lib/api/decks-client";
```

to:

```tsx
import { loadDeck, listDecks, createDeck, deleteDeck } from "@/lib/api/decks-client";
import type { DeckMeta } from "@/engine/deck-doc";
import { DECK_ID_RE } from "@/engine/deck-doc";
```

Add deck-list state + a current-id ref. Immediately after the existing `const [status, setStatus] = useState<SaveStatus>("idle");` line, add:

```tsx
  const [decks, setDecks] = useState<DeckMeta[]>([]);
  const currentId = doc?.meta.id ?? "";
  useEffect(() => { listDecks().then(setDecks).catch(() => {}); }, []);

  const switchDeck = (id: string) => { if (id && id !== currentId) window.location.href = `/editor?deck=${id}`; };
  const onNewDeck = async () => {
    const id = window.prompt("New deck id (lowercase, a–z 0–9 -):")?.trim();
    if (!id) return;
    if (!DECK_ID_RE.test(id)) { window.alert("id must match a-z 0-9 - (start alphanumeric)"); return; }
    await createDeck({ id, title: id });
    window.location.href = `/editor?deck=${id}`;
  };
  const onDeleteDeck = async () => {
    if (!currentId || !window.confirm(`Delete deck "${currentId}"? This cannot be undone.`)) return;
    await deleteDeck(currentId);
    const next = decks.find((d) => d.id !== currentId)?.id ?? "demo";
    window.location.href = `/editor?deck=${next}`;
  };
```

Then replace the read-only deck-title `<span>` in the toolbar:

```tsx
        <span style={{ color: "var(--ed-fg-muted)" }}>{doc?.meta.title ?? (loadError ? "couldn't load deck" : "no deck")}</span>
```

with a switcher + New + Delete:

```tsx
        <select className="ed__pill ed__pill--ghost" data-testid="deck-switcher" value={currentId} onChange={(e) => switchDeck(e.target.value)}>
          {!decks.some((d) => d.id === currentId) && <option value={currentId}>{doc?.meta.title ?? "…"}</option>}
          {decks.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
        <button className="ed__pill ed__pill--ghost" data-testid="deck-new" onClick={onNewDeck}>＋ New</button>
        <button className="ed__pill ed__pill--ghost" data-testid="deck-delete" onClick={onDeleteDeck}>🗑 Delete</button>
        {loadError && <span style={{ color: "var(--ed-fg-muted)" }}>couldn&apos;t load deck</span>}
```

- [ ] **Step 3: Write the deck-management e2e**

Create `e2e/deck-manage.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("deck switcher lists decks; delete-scene removes a scene", async ({ page, request }) => {
  const a = "e2e-3d-manage-a";
  await request.delete(`/api/decks/${a}`).catch(() => {});
  const doc = { version: 1, meta: { id: a, title: "Manage A" }, scenes: [
    { id: "s1", beats: [{ id: "b1", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
    { id: "s2", beats: [{ id: "b2", timeline: [{ kind: "text", value: "B", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id: a, title: "Manage A" } });
  await request.put(`/api/decks/${a}`, { data: doc });

  await page.goto(`/editor?deck=${a}`);
  // switcher shows the current deck selected
  await expect(page.getByTestId("deck-switcher")).toHaveValue(a);

  // two scenes → two delete-scene buttons; delete one → one scene's beats remain
  const film = page.getByTestId("filmstrip");
  await expect(film.getByTestId("scene-delete")).toHaveCount(2);
  await film.getByTestId("scene-delete").first().click();
  await expect(film.locator(".ed__beat")).toHaveCount(1);

  await request.delete(`/api/decks/${a}`);
});
```

- [ ] **Step 4: Verify types + the e2e**

Run:
```bash
cd /Users/chris/projects/morgana && lsof -ti :3000 :3100 | xargs kill -9 2>/dev/null || true
npx tsc --noEmit && npm run test:e2e -- e2e/deck-manage.spec.ts e2e/structural.spec.ts
```
Expected: tsc clean; `deck-manage` PASSES (switcher value correct; delete-scene drops to 1 beat); the existing `structural` spec still PASSES (filmstrip beat controls unregressed).

- [ ] **Step 5: Commit**

```bash
git add app/editor/page.tsx components/editor/Filmstrip.tsx app/editor/editor.css e2e/deck-manage.spec.ts
git commit -m "feat(editor): deck switcher/new/delete + delete-scene button"
```

---

## Task 10: Surface export-to-TS in the toolbar

**Files:**
- Modify: `app/editor/page.tsx`
- Modify: `app/editor/editor.css`
- Test: `e2e/export-ts.spec.ts` (new)

An "Export TS" toggle that renders the generated module text (from the existing `deckDocToModule`) into a read-only panel with a Copy button — testable without download plumbing.

- [ ] **Step 1: Wire the export panel into `app/editor/page.tsx`**

In `app/editor/page.tsx`, add the bridge import after the deck-client import:

```tsx
import { deckDocToModule } from "@/lib/bridge/export-ts";
```

Add export-panel state. After the `const [decks, setDecks] = useState<DeckMeta[]>([]);` line, add:

```tsx
  const [showExport, setShowExport] = useState(false);
  const exportText = doc ? deckDocToModule(doc) : "";
```

Add an Export button to the toolbar — immediately after the `deck-settings-toggle` button line:

```tsx
        <button className="ed__pill ed__pill--ghost" data-testid="export-toggle" onClick={() => setShowExport(v => !v)}>⤓ Export TS</button>
```

Then render the panel. Change the inspector-zone line at the bottom:

```tsx
      {showSettings ? <DeckSettings /> : <Inspector />}
```

to:

```tsx
      {showExport ? (
        <div className="ed__inspector" data-testid="export-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontFamily: "var(--ed-disp)", fontSize: 14 }}>Export TS</span>
            <button className="ed__pill ed__pill--ghost" data-testid="export-copy" onClick={() => navigator.clipboard?.writeText(exportText)}>Copy</button>
          </div>
          <textarea data-testid="export-output" readOnly value={exportText} style={{ width: "100%", height: "100%", minHeight: 240, fontFamily: "var(--ed-mono)", fontSize: 11, background: "var(--ed-bg-2)", color: "var(--ed-fg)", border: "1px solid var(--ed-line)", borderRadius: 8, padding: 8, resize: "none" }} />
        </div>
      ) : showSettings ? <DeckSettings /> : <Inspector />}
```

- [ ] **Step 2: Write the export e2e**

Create `e2e/export-ts.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("Export TS panel shows the generated module for the deck", async ({ page, request }) => {
  const id = "e2e-3d-export";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Export" }, scenes: [
    { id: "s", beats: [{ id: "a", timeline: [{ kind: "text", value: "Exported", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Export" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await page.getByTestId("export-toggle").click();
  const out = page.getByTestId("export-output");
  await expect(out).toBeVisible();
  const text = await out.inputValue();
  expect(text).toContain("export const scenes");
  expect(text).toContain('"value": "Exported"');

  await request.delete(`/api/decks/${id}`);
});
```

- [ ] **Step 3: Verify types + the e2e**

Run:
```bash
cd /Users/chris/projects/morgana && lsof -ti :3000 :3100 | xargs kill -9 2>/dev/null || true
npx tsc --noEmit && npm run test:e2e -- e2e/export-ts.spec.ts
```
Expected: tsc clean; `export-ts` PASSES (panel shows `export const scenes` + the deck's text).

- [ ] **Step 4: Commit**

```bash
git add app/editor/page.tsx app/editor/editor.css e2e/export-ts.spec.ts
git commit -m "feat(editor): surface export-to-TS in a toolbar panel"
```

---

## Task 11: Full suite + verification + handoff

**Files:** none (verification only).

- [ ] **Step 1: Types**

Run: `cd /Users/chris/projects/morgana && npx tsc --noEmit`
Expected: clean (no output).

- [ ] **Step 2: Unit tests**

Run: `npm test`
Expected: all PASS — including the new `registry-addable`, `action-mutations`, `store-actions`, `seek-styling`, `fonts-catalog`, `deck-meta-fonts`, plus every prior suite.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds with **no next/font network fetch** (fonts are vendored).

- [ ] **Step 4: Full e2e (both servers)**

Run:
```bash
cd /Users/chris/projects/morgana && lsof -ti :3000 :3100 | xargs kill -9 2>/dev/null || true
npm run test:e2e
```
Expected: PASS for the `default` project (all specs, incl. the new `action-crud`, `font-picker`, `deck-manage`, `export-ts`, plus prior `persistence`/`structural`/`drag-pos`/`beatstage`/`spike`/`chrome`/`deck-canvas`/`editor`/`theme`/`inspector`/`deck-settings`) and the `standalone` project. Throwaway `e2e-3d-*` decks are created + deleted within their specs and are gitignored under `./data/decks/`.

- [ ] **Step 5: Confirm the demo deck stays pristine**

Run: `git status --porcelain samples/ && git status --porcelain data/`
Expected: no changes under `samples/`; nothing committed under `data/` (it's gitignored).

- [ ] **Step 6: Hand off**

This completes the plan. Hand off to `superpowers:finishing-a-development-branch` for merge / branch / worktree cleanup.

---

## Plan 3d Done — Definition of Done
- **Action CRUD:** actions can be added (kind menu), deleted, reordered, and duplicated within a beat; `click_gate`s render as dividers; every change is undoable + autosaved.
- **Text styling:** text lines support `bold`/`italic` and `xs/sm/md/lg/xl` size, visible in the editor preview and (Task 6) in the real engine.
- **Fonts:** a self-hosted OFL font bundle replaces `next/font/google`; a per-deck picker (display/body/cursive) writes `meta.fonts` and re-skins the canvas; choices persist through save/load.
- **Deck management:** a toolbar switcher lists decks; New creates, Delete removes; scenes can be deleted from the filmstrip.
- **Export:** an Export-TS panel surfaces the existing bridge output.
- All unit + e2e green; `npm run build` succeeds; the seeded demo deck is untouched.

## Self-Review (completed during authoring)
- **Spec coverage (vs. brainstorm §4):** A → Tasks 2/3 (lib/store) + 4 (UI); B → Tasks 5 (preview) + 6 (engine parity); C → Task 9; D → Task 10; E → Task 1; T1+T2 → Task 7; T3 → Task 8; `deleteScene` wire-up → Task 9. Deferred-and-flagged items (inline markup, bespoke editors, particle scrubbing, "add fonts" system, validation/keyboard/a11y, cross-scene move, convert-kind, resizable waits) are explicitly out of scope.
- **Placeholder scan:** every code step ships real code; no TODO/TBD. The only environment-dependent step is the font-file naming check (Task 7 Step 2), which is a verification gate with an explicit fallback instruction.
- **Type consistency:** `newAction`/`ADDABLE_KINDS` (Task 1) consumed by Timeline (Task 4); `insertActionAfter`/`deleteActionAt`/`moveActionBy`/`duplicateActionAt` (Task 2) imported by the store (Task 3) and used by the same names; `addAction`/`deleteAction`/`moveAction`/`duplicateAction` (Task 3) consumed by Timeline (Task 4); `TextSize` widened (Task 5) and consumed by `TEXT_SIZE_PREVIEW` (seek) + the `appendText` size param (Task 6); `text` gains `bold`/`italic` (Task 5) read in seek (Task 5) and CinematicSlide (Task 6); `DeckMeta.fonts` (Task 8) written by `updateMeta("fonts.*", …)` and read by DeckCanvas + DeckSettings; `FONT_CATALOG`/`fontFamilies`/`FONT_DEFAULTS` (Task 7) consumed by DeckSettings (Task 8); `deckDocToModule` (existing) consumed by Task 10. The `--font-display/body/cursive` vars are defined in `app/fonts.css` (Task 7) and overridden per-deck on the canvas host (Task 8).
- **Ordering:** Task 1 (factory) precedes Task 4 (menu); Task 2 precedes Task 3; Task 5 (type) precedes Task 6 (engine read); Task 7 (catalog) precedes Task 8 (picker). No forward references.

## What follows — Plan 3e (trust, polish & font extensibility)
The "add new fonts" system (upload / drop-in registration / subsetting) · deck validation/linting · keyboard-driven authoring · empty-state/onboarding · accessibility pass · (slipped companions) timeline click-gate *segment grouping*, copy/paste of actions & beats, cross-scene beat move / drag-reorder.
