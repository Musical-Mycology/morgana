# Tier 1.5 Hardening Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Tier 1.5 "Hardening" row of the end-state design §16 — scene delete/reorder UI, cross-scene beat move, a live lint panel surfacing the two existing validators, and in-place empty/error states.

**Architecture:** Three slices in dependency order. Slice 1 adds scene-index-keyed pure mutations plus a `sceneGroups` helper that iterates `doc.scenes` (so empty scenes stop being invisible), wires them into the Zustand store with beat-identity selection preservation, surfaces them as filmstrip scene-header controls, and mirrors them into the MCP tool surface. Slice 2 adds a pure `lintDeck(doc)` composing `validateDeckDoc` + `validateDeck∘flattenStory` + one new `scene-empty` rule, rendered by a fifth bottom-right panel, and stops the client from discarding the server's save-failure reason. Slice 3 adds empty/error cards driven by a pure selector.

**Tech Stack:** TypeScript, Next.js 15 / React 19, Zustand, Vitest (+ `@testing-library/react`, jsdom), Playwright. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-07-24-tier-1-5-hardening-sweep-design.md`](../specs/2026-07-24-tier-1-5-hardening-sweep-design.md)

## Global Constraints

- **No deck-format change.** `DeckDoc.version` stays `1`; no new persisted fields. Do not touch `engine/deck/types.ts`.
- **Do not touch the engine's render paths** — `engine/authoring/seek.ts`, `engine/components/**`, `engine/authoring/BeatStage.tsx`. This sweep is editor + validation + MCP only. The one engine file that is *read* (never modified) is `engine/deck/validate.ts`.
- **Mutation convention:** every pure mutation is `(doc, …) => DeckDoc` and **returns the same doc reference on a no-op**. `commit()` in `store.ts` relies on this to avoid recording empty undo entries.
- **Empty scenes are legal.** Never auto-prune a scene, and never block an operation because it would empty one.
- **Styling:** global `app/editor/editor.css` with `--ed-*` tokens and the existing `ed__icon` / `ed__pill` / `ed__lbl` classes. No CSS Modules, no Tailwind, no new styling system.
- **Test split:** pure logic → Vitest; component behavior → Vitest + `@testing-library/react`; cross-zone flows → Playwright. Component tests are an established pattern (10+ specs under `tests/unit/*.tsx`).
- **Commands:** unit `npm test`; a single file `npx vitest run tests/unit/<file>`; e2e `CI=1 npm run test:e2e`. Run e2e with default parallelism — `--workers=1` is no longer required.
- **Out of scope:** Tier-2 action-level lints (dangling counters, missing media, gate-less infinite beats), widening `EffectDescriptor` with `validators?`, a first-run tour, scene rename, drag-reorder.

## File Structure

| File | Change |
| --- | --- |
| `lib/editor/mutations.ts` | Modify — add `moveSceneBy`, `deleteSceneAtIndex`, `appendBeatToScene`; rewrite `moveBeatBy`; reduce `deleteSceneAt` to a wrapper |
| `lib/editor/flatten-beats.ts` | Modify — add `SceneGroup`, `sceneGroups`, `flatIndexOfBeat`, `flatIndexOf` |
| `lib/editor/store.ts` | Modify — re-key `deleteScene`; add `moveScene`, `addBeatToScene`; fix `moveBeat` selection |
| `components/editor/Filmstrip.tsx` | Modify — iterate `sceneGroups`, add scene-header controls and the empty-scene row |
| `lib/mcp/tool-defs.ts` | Modify — add `move_scene_by`, `append_beat_to_scene`; extend `delete_scene_at`; reword `move_beat_by` |
| `lib/mcp/tool-handlers.ts` | Modify — handlers for the above |
| `README.md` | Modify — MCP tool list / behavior note |
| `lib/editor/lint.ts` | **Create** — `LintIssue`, `parseDocPath`, `lintDeck`, `lintCounts` |
| `lib/editor/use-lint.ts` | **Create** — `useLint()` hook |
| `components/editor/LintPanel.tsx` | **Create** — presentational panel, takes `issues` as a prop |
| `lib/api/decks-client.ts` | Modify — surface the server's error body |
| `lib/editor/use-autosave.ts` | Modify — pass the failure reason to `onStatus` |
| `lib/editor/empty-state.ts` | **Create** — `canvasPlaceholder`, `isBeatEmpty` |
| `components/editor/EmptyStates.tsx` | **Create** — `CanvasPlaceholderCard`, `EmptyBeatHint` |
| `app/editor/page.tsx` | Modify — `lint` panel, save-error + Retry, empty-state rendering |
| `app/editor/editor.css` | Modify — classes for scene-header rows, lint rows, empty cards |

**Tests:** `tests/unit/mutations.test.ts` (modify), `flatten-beats.test.ts` (modify), `decks-client.test.ts` (modify), `mcp-tool-defs.test.ts` (modify), `mcp-tool-handlers.test.ts` (modify); create `scene-mutations.test.ts`, `store-scene-actions.test.ts`, `filmstrip.test.tsx`, `lint.test.ts`, `samples-lint.test.ts`, `lint-panel.test.tsx`, `empty-state.test.ts`; `e2e/structural.spec.ts` (modify), create `e2e/lint.spec.ts`.

---

# Slice 1 — Scene structural editing

### Task 1: Scene-index-keyed pure mutations

**Files:**
- Modify: `lib/editor/mutations.ts`
- Test: `tests/unit/scene-mutations.test.ts` (create)

**Interfaces:**
- Consumes: existing `mapScene`, `newBeat`, `uniqueBeatId`, `beatLocation` in the same file.
- Produces:
  - `moveSceneBy(doc: DeckDoc, sceneIdx: number, dir: -1 | 1): DeckDoc`
  - `deleteSceneAtIndex(doc: DeckDoc, sceneIdx: number): DeckDoc`
  - `appendBeatToScene(doc: DeckDoc, sceneIdx: number): DeckDoc`
  - `deleteSceneAt(doc: DeckDoc, flatIdx: number): DeckDoc` — unchanged behavior, now a wrapper.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/scene-mutations.test.ts`:

```ts
import { expect, test } from "vitest";
import { moveSceneBy, deleteSceneAtIndex, deleteSceneAt, appendBeatToScene } from "@/lib/editor/mutations";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] },
  { id: "s2", beats: [{ id: "c", timeline: [] }] },
  { id: "s3", beats: [] },
] });

test("moveSceneBy swaps adjacent scenes", () => {
  expect(moveSceneBy(base(), 0, 1).scenes.map((s) => s.id)).toEqual(["s2", "s1", "s3"]);
  expect(moveSceneBy(base(), 2, -1).scenes.map((s) => s.id)).toEqual(["s1", "s3", "s2"]);
});

test("moveSceneBy no-ops at both ends and out of range, returning the same reference", () => {
  const d = base();
  expect(moveSceneBy(d, 0, -1)).toBe(d);
  expect(moveSceneBy(d, 2, 1)).toBe(d);
  expect(moveSceneBy(d, 9, 1)).toBe(d);
  expect(moveSceneBy(d, -1, 1)).toBe(d);
});

test("deleteSceneAtIndex removes the scene by index, including an empty one", () => {
  expect(deleteSceneAtIndex(base(), 0).scenes.map((s) => s.id)).toEqual(["s2", "s3"]);
  expect(deleteSceneAtIndex(base(), 2).scenes.map((s) => s.id)).toEqual(["s1", "s2"]);
});

test("deleteSceneAtIndex no-ops out of range, returning the same reference", () => {
  const d = base();
  expect(deleteSceneAtIndex(d, 9)).toBe(d);
  expect(deleteSceneAtIndex(d, -1)).toBe(d);
});

test("deleteSceneAt still deletes the scene CONTAINING a flat beat index", () => {
  expect(deleteSceneAt(base(), 2).scenes.map((s) => s.id)).toEqual(["s1", "s3"]); // flat 2 is "c" in s2
  const d = base();
  expect(deleteSceneAt(d, 99)).toBe(d);
});

test("appendBeatToScene appends a fresh beat, including to an empty scene", () => {
  const d = appendBeatToScene(base(), 2);
  expect(d.scenes[2].beats.map((b) => b.id)).toEqual(["b-1"]);
  expect(d.scenes[2].beats[0].timeline.length).toBe(1); // newBeat's non-empty default
  expect(appendBeatToScene(base(), 0).scenes[0].beats.map((b) => b.id)).toEqual(["a", "b", "b-1"]);
});

test("appendBeatToScene no-ops out of range, returning the same reference", () => {
  const d = base();
  expect(appendBeatToScene(d, 9)).toBe(d);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/scene-mutations.test.ts`
Expected: FAIL — `moveSceneBy is not a function` (and the other new names).

- [ ] **Step 3: Implement the mutations**

In `lib/editor/mutations.ts`, **replace** the existing `deleteSceneAt` (currently at lines 88–92) with:

```ts
/** Swap a scene with its neighbour. Out of range or at either end → no-op (same reference). */
export function moveSceneBy(doc: DeckDoc, sceneIdx: number, dir: -1 | 1): DeckDoc {
  const target = sceneIdx + dir;
  if (sceneIdx < 0 || sceneIdx >= doc.scenes.length) return doc;
  if (target < 0 || target >= doc.scenes.length) return doc;
  const scenes = doc.scenes.slice();
  [scenes[sceneIdx], scenes[target]] = [scenes[target], scenes[sceneIdx]];
  return { ...doc, scenes };
}

/** Delete a scene by its own index. Addresses empty scenes, which have no flat beat index. */
export function deleteSceneAtIndex(doc: DeckDoc, sceneIdx: number): DeckDoc {
  if (sceneIdx < 0 || sceneIdx >= doc.scenes.length) return doc;
  return { ...doc, scenes: doc.scenes.filter((_, si) => si !== sceneIdx) };
}

/** Delete the scene CONTAINING the given flat beat index. Retained unchanged for the
 *  published `delete_scene_at` MCP tool. */
export function deleteSceneAt(doc: DeckDoc, flatIdx: number): DeckDoc {
  const loc = beatLocation(doc, flatIdx);
  if (!loc) return doc;
  return deleteSceneAtIndex(doc, loc.sceneIdx);
}

/** Append a fresh beat to a scene. Unlike insertBeatAfter (flat-index keyed) this can
 *  target an empty scene, which has no flat index to insert after. */
export function appendBeatToScene(doc: DeckDoc, sceneIdx: number): DeckDoc {
  if (sceneIdx < 0 || sceneIdx >= doc.scenes.length) return doc;
  const beat = newBeat(uniqueBeatId(doc));
  return mapScene(doc, sceneIdx, (s) => ({ ...s, beats: [...s.beats, beat] }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/scene-mutations.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: PASS. `tests/unit/mutations.test.ts`'s existing `appendScene / deleteSceneAt` test must still pass — `deleteSceneAt`'s behavior is unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/editor/mutations.ts tests/unit/scene-mutations.test.ts
git commit -m "feat(scenes): scene-index-keyed move/delete/append-beat mutations"
```

---

### Task 2: Cross-scene `moveBeatBy`

**Files:**
- Modify: `lib/editor/mutations.ts:72-82`
- Modify: `tests/unit/mutations.test.ts` (an existing assertion becomes wrong)
- Test: `tests/unit/scene-mutations.test.ts` (append)

**Interfaces:**
- Consumes: `beatLocation`, `mapScene` from Task 1's file.
- Produces: `moveBeatBy(doc, flatIdx, dir)` with transfer-at-boundary semantics. **A transfer leaves the beat's flat index unchanged** — Task 4 depends on this.

- [ ] **Step 1: Fix the existing test that asserts the old behavior**

In `tests/unit/mutations.test.ts`, the test `moveBeatBy swaps within a scene; no-ops at the scene boundary` asserts that moving beat `"b"` (last in `s1`, with `s2` following) is a no-op. That is exactly the behavior being changed. **Replace that whole test** with:

```ts
test("moveBeatBy swaps within a scene", () => {
  expect(moveBeatBy(base(), 0, 1).scenes[0].beats.map((b) => b.id)).toEqual(["b", "a"]);
});

test("moveBeatBy transfers across a scene boundary instead of no-opping", () => {
  const d = moveBeatBy(base(), 1, 1);                 // "b" is last in s1 → prepend to s2
  expect(d.scenes[0].beats.map((b) => b.id)).toEqual(["a"]);
  expect(d.scenes[1].beats.map((b) => b.id)).toEqual(["b", "c"]);
});
```

- [ ] **Step 2: Write the new failing tests**

In `tests/unit/scene-mutations.test.ts`, add `moveBeatBy` to the existing `@/lib/editor/mutations` import at the top of the file, add a new top-level import `import { flattenBeats } from "@/lib/editor/flatten-beats";`, then append these tests:

```ts
test("moveBeatBy down off a scene tail prepends to the next scene, keeping the flat index", () => {
  const d = moveBeatBy(base(), 1, 1);                 // "b" tail of s1 → head of s2
  expect(d.scenes[0].beats.map((b) => b.id)).toEqual(["a"]);
  expect(d.scenes[1].beats.map((b) => b.id)).toEqual(["b", "c"]);
  expect(flattenBeats(d).map((f) => f.beat.id).indexOf("b")).toBe(1); // unchanged
});

test("moveBeatBy up off a scene head appends to the previous scene, keeping the flat index", () => {
  const d = moveBeatBy(base(), 2, -1);                // "c" head of s2 → tail of s1
  expect(d.scenes[0].beats.map((b) => b.id)).toEqual(["a", "b", "c"]);
  expect(d.scenes[1].beats).toEqual([]);
  expect(flattenBeats(d).map((f) => f.beat.id).indexOf("c")).toBe(2); // unchanged
});

test("moveBeatBy transfers into an empty scene", () => {
  const d = moveBeatBy(base(), 2, 1);                 // "c" tail of s2 → head of empty s3
  expect(d.scenes[1].beats).toEqual([]);
  expect(d.scenes[2].beats.map((b) => b.id)).toEqual(["c"]);
});

test("moveBeatBy may leave the source scene empty", () => {
  const d = moveBeatBy(base(), 2, -1);                // "c" was s2's only beat
  expect(d.scenes.map((s) => s.id)).toEqual(["s1", "s2", "s3"]); // scene NOT pruned
  expect(d.scenes[1].beats).toEqual([]);
});

test("moveBeatBy no-ops only when there is no adjacent scene", () => {
  const d = base();
  expect(moveBeatBy(d, 0, -1)).toBe(d);               // first beat of the first scene
  expect(moveBeatBy(d, 99, 1)).toBe(d);               // no such beat
  const tail: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "s1", beats: [{ id: "a", timeline: [] }] },
  ] };
  expect(moveBeatBy(tail, 0, 1)).toBe(tail);          // only beat of the only scene
});

test("moveBeatBy CAN move the flat-0 beat up when a leading empty scene exists", () => {
  const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "empty", beats: [] },
    { id: "s", beats: [{ id: "a", timeline: [] }] },
  ] };
  const d = moveBeatBy(doc, 0, -1);
  expect(d.scenes[0].beats.map((b) => b.id)).toEqual(["a"]);
  expect(d.scenes[1].beats).toEqual([]);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/scene-mutations.test.ts tests/unit/mutations.test.ts`
Expected: FAIL — the transfer tests report the doc unchanged (boundary no-op still in effect).

- [ ] **Step 4: Rewrite `moveBeatBy`**

In `lib/editor/mutations.ts`, replace the function at lines 72–82 entirely:

```ts
/** Move a beat one position in flat (filmstrip) order. Within a scene this swaps with the
 *  neighbouring beat. At a scene boundary it TRANSFERS the beat into the adjacent scene —
 *  which may be empty, and which may leave the source scene empty (both are legal). No-op
 *  only when there is no adjacent scene in that direction.
 *
 *  NOTE: a transfer leaves the beat's FLAT index unchanged (it is removed from one scene's
 *  edge and re-inserted at the adjacent scene's facing edge). Callers must resolve the new
 *  selection by beat id, not by `flatIdx + dir`. */
export function moveBeatBy(doc: DeckDoc, flatIdx: number, dir: -1 | 1): DeckDoc {
  const loc = beatLocation(doc, flatIdx);
  if (!loc) return doc;
  const beats = doc.scenes[loc.sceneIdx].beats;
  const target = loc.beatIdx + dir;

  if (target >= 0 && target < beats.length) {         // within-scene swap
    const next = beats.slice();
    [next[loc.beatIdx], next[target]] = [next[target], next[loc.beatIdx]];
    return mapScene(doc, loc.sceneIdx, (s) => ({ ...s, beats: next }));
  }

  const destIdx = loc.sceneIdx + dir;                  // scene boundary → transfer
  if (destIdx < 0 || destIdx >= doc.scenes.length) return doc;
  const beat = beats[loc.beatIdx];
  return {
    ...doc,
    scenes: doc.scenes.map((s, si) => {
      if (si === loc.sceneIdx) return { ...s, beats: s.beats.filter((_, bi) => bi !== loc.beatIdx) };
      if (si === destIdx) return { ...s, beats: dir === -1 ? [...s.beats, beat] : [beat, ...s.beats] };
      return s;
    }),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/scene-mutations.test.ts tests/unit/mutations.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/editor/mutations.ts tests/unit/scene-mutations.test.ts tests/unit/mutations.test.ts
git commit -m "feat(scenes): moveBeatBy transfers across scene boundaries"
```

---

### Task 3: `sceneGroups` and flat-index helpers

**Files:**
- Modify: `lib/editor/flatten-beats.ts`
- Test: `tests/unit/flatten-beats.test.ts` (append)

**Interfaces:**
- Produces:
  - `interface SceneGroup { sceneIdx: number; sceneId: string; items: { flatIdx: number; beatId: string }[] }`
  - `sceneGroups(doc: DeckDoc): SceneGroup[]`
  - `flatIndexOfBeat(doc: DeckDoc, beatId: string): number` — `-1` when absent.
  - `flatIndexOf(doc: DeckDoc, sceneIdx: number, beatIdx: number): number` — `-1` when out of range.

- [ ] **Step 1: Write the failing test**

In `tests/unit/flatten-beats.test.ts`, add `sceneGroups`, `flatIndexOfBeat`, and `flatIndexOf` to the existing `@/lib/editor/flatten-beats` import at the top of the file, then append:

```ts
const withEmpty = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] },
  { id: "gap", beats: [] },
  { id: "s2", beats: [{ id: "c", timeline: [] }] },
] });

test("sceneGroups keeps empty scenes, unlike grouping the flat beat list", () => {
  const groups = sceneGroups(withEmpty());
  expect(groups.map((g) => g.sceneId)).toEqual(["s1", "gap", "s2"]);
  expect(groups.map((g) => g.sceneIdx)).toEqual([0, 1, 2]);
  expect(groups[1].items).toEqual([]);
});

test("sceneGroups assigns flat indices continuously across empty scenes", () => {
  const groups = sceneGroups(withEmpty());
  expect(groups[0].items).toEqual([{ flatIdx: 0, beatId: "a" }, { flatIdx: 1, beatId: "b" }]);
  expect(groups[2].items).toEqual([{ flatIdx: 2, beatId: "c" }]);
});

test("flatIndexOfBeat finds a beat by id, or returns -1", () => {
  expect(flatIndexOfBeat(withEmpty(), "c")).toBe(2);
  expect(flatIndexOfBeat(withEmpty(), "nope")).toBe(-1);
});

test("flatIndexOf maps scene+beat coordinates to a flat index, or returns -1", () => {
  expect(flatIndexOf(withEmpty(), 2, 0)).toBe(2);
  expect(flatIndexOf(withEmpty(), 0, 1)).toBe(1);
  expect(flatIndexOf(withEmpty(), 1, 0)).toBe(-1); // empty scene has no beats
  expect(flatIndexOf(withEmpty(), 9, 0)).toBe(-1);
});
```

If `DeckDoc` is not already imported in that file, add `import type { DeckDoc } from "@/engine/deck-doc";`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/flatten-beats.test.ts`
Expected: FAIL — `sceneGroups is not a function`.

- [ ] **Step 3: Implement the helpers**

Append to `lib/editor/flatten-beats.ts`:

```ts
export interface SceneGroup {
  sceneIdx: number;
  sceneId: string;
  items: { flatIdx: number; beatId: string }[];
}

/** Group beats by scene in document order. Unlike deriving groups from the flat beat list,
 *  this iterates `doc.scenes`, so a scene with no beats yields an empty `items` array
 *  instead of vanishing from the filmstrip entirely. */
export function sceneGroups(doc: DeckDoc): SceneGroup[] {
  let flatIdx = 0;
  return doc.scenes.map((s, sceneIdx) => ({
    sceneIdx,
    sceneId: s.id,
    items: s.beats.map((b) => ({ flatIdx: flatIdx++, beatId: b.id })),
  }));
}

/** Flat (filmstrip-order) index of the beat with `beatId`, or -1 if it no longer exists.
 *  Used to keep the same beat selected across structural edits that shift indices. */
export function flatIndexOfBeat(doc: DeckDoc, beatId: string): number {
  let n = 0;
  for (const s of doc.scenes) {
    for (const b of s.beats) { if (b.id === beatId) return n; n++; }
  }
  return -1;
}

/** Flat index of `scenes[sceneIdx].beats[beatIdx]`, or -1 if out of range. */
export function flatIndexOf(doc: DeckDoc, sceneIdx: number, beatIdx: number): number {
  if (sceneIdx < 0 || sceneIdx >= doc.scenes.length) return -1;
  if (beatIdx < 0 || beatIdx >= doc.scenes[sceneIdx].beats.length) return -1;
  let n = 0;
  for (let si = 0; si < sceneIdx; si++) n += doc.scenes[si].beats.length;
  return n + beatIdx;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/flatten-beats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/editor/flatten-beats.ts tests/unit/flatten-beats.test.ts
git commit -m "feat(scenes): sceneGroups + flat-index helpers that survive empty scenes"
```

---

### Task 4: Store scene actions with selection preservation

**Files:**
- Modify: `lib/editor/store.ts`
- Test: `tests/unit/store-scene-actions.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's `moveSceneBy`/`deleteSceneAtIndex`/`appendBeatToScene`, Task 2's `moveBeatBy`, Task 3's `flatIndexOfBeat`, existing `uniqueBeatId`.
- Produces, on the store:
  - `deleteScene(sceneIdx: number) => void` — **re-keyed** from flat index to scene index.
  - `moveScene(sceneIdx: number, dir: -1 | 1) => void`
  - `addBeatToScene(sceneIdx: number) => void`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/store-scene-actions.test.ts`:

```ts
import { beforeEach, expect, test } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const deck = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] },
  { id: "s2", beats: [{ id: "c", timeline: [] }] },
] });

beforeEach(() => useEditor.getState().load(deck()));

test("moveScene reorders scenes and keeps the SAME beat selected", () => {
  useEditor.getState().select(2);                     // "c" in s2
  useEditor.getState().moveScene(1, -1);              // s2 moves ahead of s1
  const s = useEditor.getState();
  expect(s.doc!.scenes.map((x) => x.id)).toEqual(["s2", "s1"]);
  expect(s.beats[s.selected].beat.id).toBe("c");      // followed the beat, not the index
  expect(s.selected).toBe(0);
});

test("deleteScene is keyed by SCENE index and clamps selection when the beat is gone", () => {
  useEditor.getState().select(2);                     // "c" in s2
  useEditor.getState().deleteScene(1);                // delete s2 itself
  const s = useEditor.getState();
  expect(s.doc!.scenes.map((x) => x.id)).toEqual(["s1"]);
  expect(s.selected).toBe(1);                         // clamped to the last remaining beat
  expect(s.selectedAction).toBeNull();
});

test("deleteScene can delete an empty scene, which has no flat beat index", () => {
  useEditor.getState().load({ version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "s1", beats: [{ id: "a", timeline: [] }] },
    { id: "gap", beats: [] },
  ] });
  useEditor.getState().deleteScene(1);
  expect(useEditor.getState().doc!.scenes.map((x) => x.id)).toEqual(["s1"]);
});

test("addBeatToScene appends to the target scene and selects the new beat", () => {
  useEditor.getState().addBeatToScene(0);
  const s = useEditor.getState();
  expect(s.doc!.scenes[0].beats.map((b) => b.id)).toEqual(["a", "b", "b-1"]);
  expect(s.beats[s.selected].beat.id).toBe("b-1");
});

test("addBeatToScene fills an empty scene", () => {
  useEditor.getState().load({ version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "s1", beats: [{ id: "a", timeline: [] }] },
    { id: "gap", beats: [] },
  ] });
  useEditor.getState().addBeatToScene(1);
  const s = useEditor.getState();
  expect(s.doc!.scenes[1].beats.length).toBe(1);
  expect(s.selected).toBe(1);
});

test("moveBeat across a scene boundary keeps the moved beat selected", () => {
  useEditor.getState().select(1);                     // "b", tail of s1
  useEditor.getState().moveBeat(1, 1);                // transfers to the head of s2
  const s = useEditor.getState();
  expect(s.doc!.scenes[1].beats.map((b) => b.id)).toEqual(["b", "c"]);
  expect(s.beats[s.selected].beat.id).toBe("b");      // NOT flatIdx + dir, which would be "c"
});

test("scene actions are undoable", () => {
  useEditor.getState().deleteScene(1);
  expect(useEditor.getState().doc!.scenes.length).toBe(1);
  useEditor.getState().undo();
  expect(useEditor.getState().doc!.scenes.length).toBe(2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/store-scene-actions.test.ts`
Expected: FAIL — `moveScene is not a function`.

- [ ] **Step 3: Extend the store**

In `lib/editor/store.ts`:

**(a)** Extend the mutations import (line 6) to add the three new names:

```ts
import { insertBeatAfter, duplicateBeatAt, deleteBeatAt, moveBeatBy, appendScene, deleteSceneAtIndex, appendBeatToScene, moveSceneBy, uniqueBeatId, insertActionAfter, duplicateActionAt, deleteActionAt, moveActionBy, convertActionKind } from "./mutations";
```

Note `deleteSceneAt` is **removed** from this import — the store now uses `deleteSceneAtIndex`. Leave `deleteSceneAt` exported from `mutations.ts` for the MCP handler.

**(b)** Extend the `flatten-beats` import (line 4):

```ts
import { flattenBeats, beatLocation, flatIndexOfBeat, type FlatBeat } from "./flatten-beats";
```

**(c)** In the `EditorState` interface, replace `deleteScene: (flatIdx: number) => void;` with:

```ts
  deleteScene: (sceneIdx: number) => void;
  moveScene: (sceneIdx: number, dir: -1 | 1) => void;
  addBeatToScene: (sceneIdx: number) => void;
```

**(d)** Add this helper directly below the existing `commit()` function:

```ts
/** Re-resolve `selected` after a structural edit: keep the SAME beat selected by id, or
 *  clamp into range if it no longer exists. Clears action/object selection, matching the
 *  existing deleteBeat/deleteScene behavior. */
function reselect(s: EditorState, part: Partial<EditorState>, beatId: string | null): Partial<EditorState> {
  if (!part.doc || !part.beats) return {};
  const found = beatId ? flatIndexOfBeat(part.doc, beatId) : -1;
  const selected = found >= 0 ? found : Math.min(s.selected, Math.max(0, part.beats.length - 1));
  return { ...part, selected, selectedAction: null, selectedObjectPaths: [], enteredGroupPath: null };
}
```

**(e)** Replace the existing `deleteScene` implementation (lines 145–150) with the three scene actions:

```ts
  deleteScene: (sceneIdx) => set((s) => reselect(s, commit(s, (doc) => deleteSceneAtIndex(doc, sceneIdx)), s.beats[s.selected]?.beat.id ?? null)),
  moveScene: (sceneIdx, dir) => set((s) => reselect(s, commit(s, (doc) => moveSceneBy(doc, sceneIdx, dir)), s.beats[s.selected]?.beat.id ?? null)),
  addBeatToScene: (sceneIdx) => set((s) => {
    if (!s.doc) return {};
    const newId = uniqueBeatId(s.doc);                // the id appendBeatToScene will assign
    return reselect(s, commit(s, (doc) => appendBeatToScene(doc, sceneIdx)), newId);
  }),
```

**(f)** Replace the existing `moveBeat` implementation (lines 138–143) — the `flatIdx + dir` arithmetic is wrong for a cross-scene transfer:

```ts
  moveBeat: (flatIdx, dir) => set((s) => {
    if (!s.doc) return {};
    const beatId = s.beats[flatIdx]?.beat.id ?? null;
    const next = moveBeatBy(s.doc, flatIdx, dir);
    if (next === s.doc) return {};
    const part = commit(s, () => next);
    const found = beatId && part.doc ? flatIndexOfBeat(part.doc, beatId) : -1;
    return { ...part, selected: found >= 0 ? found : flatIdx };
  }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/store-scene-actions.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full unit suite and the type check**

Run: `npm test && npx tsc --noEmit`
Expected: PASS with no type errors. If `tsc` reports an unused-import error for `deleteSceneAt` in `store.ts`, remove it from that import.

- [ ] **Step 6: Commit**

```bash
git add lib/editor/store.ts tests/unit/store-scene-actions.test.ts
git commit -m "feat(scenes): store scene actions with beat-identity selection"
```

---

### Task 5: Filmstrip scene-header controls

**Files:**
- Modify: `components/editor/Filmstrip.tsx`
- Modify: `app/editor/editor.css`
- Test: `tests/unit/filmstrip.test.tsx` (create)

**Interfaces:**
- Consumes: Task 3's `sceneGroups`, Task 4's `moveScene`/`deleteScene`/`addBeatToScene`.
- Produces: test-ids `scene-up`, `scene-down`, `scene-add-beat`, `scene-delete`, `scene-empty-row`, and `scene-row` on each scene header.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/filmstrip.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEditor } from "@/lib/editor/store";
import { Filmstrip } from "@/components/editor/Filmstrip";
import type { DeckDoc } from "@/engine/deck-doc";

const deck = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] },
  { id: "gap", beats: [] },
  { id: "s2", beats: [{ id: "c", timeline: [] }] },
] });

beforeEach(() => useEditor.getState().load(deck()));
afterEach(cleanup);

test("renders every scene, including one with no beats", () => {
  render(<Filmstrip />);
  expect(screen.getAllByTestId("scene-row")).toHaveLength(3);
  expect(screen.getByTestId("scene-empty-row")).toBeTruthy();
});

test("scene delete removes that scene by index", () => {
  render(<Filmstrip />);
  fireEvent.click(screen.getAllByTestId("scene-delete")[1]);   // the "gap" scene
  expect(useEditor.getState().doc!.scenes.map((s) => s.id)).toEqual(["s1", "s2"]);
});

test("scene down reorders scenes", () => {
  render(<Filmstrip />);
  fireEvent.click(screen.getAllByTestId("scene-down")[0]);
  expect(useEditor.getState().doc!.scenes.map((s) => s.id)).toEqual(["gap", "s1", "s2"]);
});

test("scene up reorders scenes", () => {
  render(<Filmstrip />);
  fireEvent.click(screen.getAllByTestId("scene-up")[2]);
  expect(useEditor.getState().doc!.scenes.map((s) => s.id)).toEqual(["s1", "s2", "gap"]);
});

test("the empty scene's add-beat button fills it", () => {
  render(<Filmstrip />);
  fireEvent.click(screen.getAllByTestId("scene-add-beat")[1]);
  expect(useEditor.getState().doc!.scenes[1].beats).toHaveLength(1);
});

test("beat controls still appear only on the selected beat", () => {
  render(<Filmstrip />);
  expect(screen.queryAllByTestId("beat-delete")).toHaveLength(1); // beat 0 is selected on load
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/filmstrip.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="scene-row"]`.

- [ ] **Step 3: Rewrite the Filmstrip**

Replace `components/editor/Filmstrip.tsx` entirely:

```tsx
"use client";
import { useEditor } from "@/lib/editor/store";
import { sceneGroups } from "@/lib/editor/flatten-beats";

export function Filmstrip() {
  const doc = useEditor((s) => s.doc);
  const selected = useEditor((s) => s.selected);
  const select = useEditor((s) => s.select);
  const addBeat = useEditor((s) => s.addBeat);
  const duplicateBeat = useEditor((s) => s.duplicateBeat);
  const deleteBeat = useEditor((s) => s.deleteBeat);
  const moveBeat = useEditor((s) => s.moveBeat);
  const addScene = useEditor((s) => s.addScene);
  const moveScene = useEditor((s) => s.moveScene);
  const deleteScene = useEditor((s) => s.deleteScene);
  const addBeatToScene = useEditor((s) => s.addBeatToScene);

  const groups = doc ? sceneGroups(doc) : [];

  return (
    <div className="ed__film" data-testid="filmstrip">
      {groups.map((g) => (
        <div key={g.sceneId}>
          <div className="ed__scene-row" data-testid="scene-row">
            <span className="ed__lbl" style={{ flex: 1, padding: 0 }}>{g.sceneId}</span>
            <button className="ed__icon" title="Move scene up" data-testid="scene-up" onClick={() => moveScene(g.sceneIdx, -1)}>↑</button>
            <button className="ed__icon" title="Move scene down" data-testid="scene-down" onClick={() => moveScene(g.sceneIdx, 1)}>↓</button>
            <button className="ed__icon" title="Add beat" data-testid="scene-add-beat" onClick={() => addBeatToScene(g.sceneIdx)}>＋</button>
            <button className="ed__icon" title="Delete scene" data-testid="scene-delete" onClick={() => deleteScene(g.sceneIdx)}>✕</button>
          </div>
          {g.items.length === 0 && (
            <div className="ed__scene-empty" data-testid="scene-empty-row">No beats</div>
          )}
          {g.items.map(({ flatIdx, beatId }) => (
            <div key={`${g.sceneId}-${beatId}-${flatIdx}`} style={{ display: "flex", alignItems: "center" }}>
              <button onClick={() => select(flatIdx)} aria-current={flatIdx === selected} className="ed__beat" style={{ flex: 1 }}>
                <span style={{ color: "var(--ed-fg-muted)", marginRight: 8 }}>{String(flatIdx + 1).padStart(2, "0")}</span>
                {beatId}
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

- [ ] **Step 4: Add the two new CSS classes**

Append to `app/editor/editor.css`:

```css
.ed__scene-row { display: flex; align-items: center; gap: 2px; padding: 9px 8px 4px 12px; }
.ed__scene-empty { font-size: 11px; color: var(--ed-fg-muted); font-style: italic; padding: 4px 12px 8px; }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/filmstrip.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the full unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/editor/Filmstrip.tsx app/editor/editor.css tests/unit/filmstrip.test.tsx
git commit -m "feat(scenes): filmstrip scene-header controls + empty-scene row"
```

---

### Task 6: MCP parity for the new scene capabilities

**Files:**
- Modify: `lib/mcp/tool-defs.ts`
- Modify: `lib/mcp/tool-handlers.ts`
- Modify: `README.md`
- Test: `tests/unit/mcp-tool-defs.test.ts`, `tests/unit/mcp-tool-handlers.test.ts`

**Interfaces:**
- Consumes: Task 1's `moveSceneBy`/`deleteSceneAtIndex`/`appendBeatToScene`, existing `deleteSceneAt`.
- Produces: tools `move_scene_by`, `append_beat_to_scene`; `delete_scene_at` accepting `beat_index` **or** `scene_index`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/mcp-tool-defs.test.ts`:

```ts
test("includes the scene-structural tools", () => {
  const names = TOOL_DEFS.map((t) => t.name);
  expect(names).toEqual(expect.arrayContaining(["move_scene_by", "append_beat_to_scene"]));
});

test("delete_scene_at accepts either a beat index or a scene index, requiring neither outright", () => {
  const tool = TOOL_DEFS.find((t) => t.name === "delete_scene_at")!;
  const props = tool.inputSchema.properties as Record<string, unknown>;
  expect(props.beat_index).toBeDefined();
  expect(props.scene_index).toBeDefined();
  expect(tool.inputSchema.required).toEqual(["deck_id"]);
});

test("move_beat_by's description reflects that it now crosses scene boundaries", () => {
  const tool = TOOL_DEFS.find((t) => t.name === "move_beat_by")!;
  expect(tool.description.toLowerCase()).toContain("scene");
  expect(tool.description.toLowerCase()).not.toContain("no-op at a scene boundary");
});
```

Append to `tests/unit/mcp-tool-handlers.test.ts`:

```ts
test("move_scene_by reorders scenes", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await callTool("append_scene", { deck_id: "demo" });
  await callTool("append_scene", { deck_id: "demo" });
  const before = (await loadDeck("demo")).scenes.map((s) => s.id);
  const after = await callTool("move_scene_by", { deck_id: "demo", scene_index: 0, dir: 1 }) as DeckDoc;
  expect(after.scenes.map((s) => s.id)).toEqual([before[1], before[0]]);
});

test("append_beat_to_scene fills a scene emptied by delete_beat_at", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await callTool("append_scene", { deck_id: "demo" });
  await callTool("delete_beat_at", { deck_id: "demo", beat_index: 0 });
  expect((await loadDeck("demo")).scenes[0].beats).toEqual([]);
  const filled = await callTool("append_beat_to_scene", { deck_id: "demo", scene_index: 0 }) as DeckDoc;
  expect(filled.scenes[0].beats).toHaveLength(1);
});

test("delete_scene_at addresses an empty scene by scene_index", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await callTool("append_scene", { deck_id: "demo" });
  await callTool("delete_beat_at", { deck_id: "demo", beat_index: 0 });
  const after = await callTool("delete_scene_at", { deck_id: "demo", scene_index: 0 }) as DeckDoc;
  expect(after.scenes).toEqual([]);
});

test("delete_scene_at rejects both or neither index", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await callTool("append_scene", { deck_id: "demo" });
  await expect(callTool("delete_scene_at", { deck_id: "demo" })).rejects.toThrow(ToolCallError);
  await expect(callTool("delete_scene_at", { deck_id: "demo", beat_index: 0, scene_index: 0 })).rejects.toThrow(ToolCallError);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/mcp-tool-defs.test.ts tests/unit/mcp-tool-handlers.test.ts`
Expected: FAIL — the new tool names are absent.

- [ ] **Step 3: Add the tool definitions**

In `lib/mcp/tool-defs.ts`, add this constant beside the existing `BEAT_INDEX`:

```ts
const SCENE_INDEX = { scene_index: { type: "number", description: "Scene index in document order, 0-based." } };
```

**Replace** the existing `move_beat_by` and `delete_scene_at` entries, and add the two new tools, so the scene block reads:

```ts
  {
    name: "move_beat_by",
    description: "Move a beat one position in filmstrip order (dir -1 = earlier, 1 = later). Within a scene this swaps with the neighbouring beat; at a scene edge it moves the beat into the adjacent scene. Only a no-op when there is no adjacent scene in that direction.",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX, ...DIR }, ["deck_id", "beat_index", "dir"]),
  },
  {
    name: "append_scene",
    description: "Append a new scene (with one empty beat) to the end of the deck.",
    inputSchema: schema({ ...DECK_ID }, ["deck_id"]),
  },
  {
    name: "move_scene_by",
    description: "Swap a scene with its neighbour (dir -1 = earlier, 1 = later). No-op at either end of the deck.",
    inputSchema: schema({ ...DECK_ID, ...SCENE_INDEX, ...DIR }, ["deck_id", "scene_index", "dir"]),
  },
  {
    name: "append_beat_to_scene",
    description: "Append a new beat to the end of a scene, addressed by scene index. Use this to fill a scene that has no beats, which no flat beat index can address.",
    inputSchema: schema({ ...DECK_ID, ...SCENE_INDEX }, ["deck_id", "scene_index"]),
  },
  {
    name: "delete_scene_at",
    description: "Delete a whole scene and all of its beats. Give exactly one of beat_index (deletes the scene containing that beat) or scene_index (deletes that scene directly, including one with no beats).",
    inputSchema: schema({ ...DECK_ID, ...BEAT_INDEX, ...SCENE_INDEX }, ["deck_id"]),
    annotations: { destructiveHint: true },
  },
```

- [ ] **Step 4: Add the handlers**

In `lib/mcp/tool-handlers.ts`, extend the mutations import:

```ts
import {
  insertBeatAfter, duplicateBeatAt, deleteBeatAt, moveBeatBy,
  appendScene, deleteSceneAt, deleteSceneAtIndex, moveSceneBy, appendBeatToScene,
  insertActionAfter, duplicateActionAt, deleteActionAt, moveActionBy, convertActionKind,
} from "@/lib/editor/mutations";
```

**Replace** the `delete_scene_at` case and add the two new cases:

```ts
    case "delete_scene_at": {
      const beatIndex = optionalNumber(a, "beat_index");
      const sceneIndex = optionalNumber(a, "scene_index");
      if ((beatIndex == null) === (sceneIndex == null)) {
        throw new ToolCallError('give exactly one of "beat_index" or "scene_index"');
      }
      return mutate(deckId, (doc) =>
        sceneIndex == null ? deleteSceneAt(doc, beatIndex!) : deleteSceneAtIndex(doc, sceneIndex));
    }
    case "move_scene_by":
      return mutate(deckId, (doc) => moveSceneBy(doc, requireNumber(a, "scene_index"), requireDir(a, "dir")));
    case "append_beat_to_scene":
      return mutate(deckId, (doc) => appendBeatToScene(doc, requireNumber(a, "scene_index")));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/mcp-tool-defs.test.ts tests/unit/mcp-tool-handlers.test.ts`
Expected: PASS.

- [ ] **Step 6: Update the README's MCP section**

In `README.md`, find the section documenting the MCP tools (added in commit `02b3ca5`). Add the two new tools to the tool list and add this note under it:

```markdown
`move_beat_by` moves a beat one position in filmstrip order. Within a scene it swaps with
the neighbouring beat; at a scene edge it moves the beat into the adjacent scene. It is only
a no-op when there is no adjacent scene in that direction. (Before 2026-07-24 it no-opped at
every scene boundary.)

A scene may legitimately have no beats. Use `append_beat_to_scene` to fill one and
`delete_scene_at` with `scene_index` to remove one — a flat `beat_index` cannot address a
scene that contains no beats.
```

- [ ] **Step 7: Run the full unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/mcp/tool-defs.ts lib/mcp/tool-handlers.ts README.md tests/unit/mcp-tool-defs.test.ts tests/unit/mcp-tool-handlers.test.ts
git commit -m "feat(mcp): scene reorder/append-beat tools + scene_index addressing"
```

---

### Task 7: End-to-end coverage for scene editing

**Files:**
- Modify: `e2e/structural.spec.ts`

**Interfaces:**
- Consumes: the test-ids from Task 5.

- [ ] **Step 1: Write the e2e tests**

Append to `e2e/structural.spec.ts`:

```ts
test("delete and reorder scenes, persisting across a reload", async ({ page, request }) => {
  const id = "e2e-scenes";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Scenes" }, scenes: [
    { id: "one", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
    { id: "two", beats: [{ id: "b", timeline: [{ kind: "text", value: "B", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Scenes" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const film = page.getByTestId("filmstrip");
  await expect(film.getByTestId("scene-row")).toHaveCount(2);

  await film.getByTestId("scene-down").first().click();          // "one" moves after "two"
  await expect(film.getByTestId("scene-row").first()).toContainText("two");

  await film.getByTestId("scene-delete").first().click();        // delete "two"
  await expect(film.getByTestId("scene-row")).toHaveCount(1);
  await expect(page.getByTestId("save-status")).toHaveText("Saved");

  await page.reload();
  await expect(page.getByTestId("filmstrip").getByTestId("scene-row")).toHaveCount(1);

  await request.delete(`/api/decks/${id}`);
});

test("a beat moves across a scene boundary, empties its scene, and can refill it", async ({ page, request }) => {
  const id = "e2e-cross-scene";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Cross" }, scenes: [
    { id: "one", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
    { id: "two", beats: [{ id: "b", timeline: [{ kind: "text", value: "B", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Cross" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const film = page.getByTestId("filmstrip");

  await film.locator(".ed__beat").first().click();               // select "a"
  await page.getByTestId("beat-down").click();                   // transfer into scene "two"
  await expect(film.getByTestId("scene-empty-row")).toHaveCount(1);
  await expect(film.locator(".ed__beat")).toHaveCount(2);        // both beats still exist

  await film.getByTestId("scene-add-beat").first().click();      // refill the emptied scene
  await expect(film.getByTestId("scene-empty-row")).toHaveCount(0);
  await expect(film.locator(".ed__beat")).toHaveCount(3);

  await request.delete(`/api/decks/${id}`);
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `CI=1 npm run test:e2e -- e2e/structural.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 3: Run the whole e2e suite for regressions**

Run: `CI=1 npm run test:e2e`
Expected: PASS. The filmstrip markup changed, so watch specs that select `.ed__beat` or the filmstrip.

- [ ] **Step 4: Commit**

```bash
git add e2e/structural.spec.ts
git commit -m "test(scenes): e2e scene reorder/delete and cross-scene beat move"
```

---

# Slice 2 — Lint panel

### Task 8: The `lintDeck` module

**Files:**
- Create: `lib/editor/lint.ts`
- Test: `tests/unit/lint.test.ts` (create)

**Interfaces:**
- Consumes: `validateDeckDoc` (`@/engine/deck-doc`), `validateDeck` (`@/engine/deck/validate`), `flattenStory` (`@/engine/deck/flatten`). **Read only — do not modify these.**
- Produces:
  - `type LintSeverity = "error" | "warning"`
  - `interface LintLocation { sceneIdx: number; beatIdx?: number; actionIdx?: number }`
  - `interface LintIssue { rule: string; severity: LintSeverity; message: string; at?: LintLocation }`
  - `parseDocPath(message: string): LintLocation | undefined`
  - `lintDeck(doc: DeckDoc): LintIssue[]`
  - `lintCounts(issues: LintIssue[]): { errors: number; warnings: number }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lint.test.ts`:

```ts
import { expect, test } from "vitest";
import { lintDeck, parseDocPath, lintCounts } from "@/lib/editor/lint";
import type { DeckDoc } from "@/engine/deck-doc";

const clean = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
] });

test("parseDocPath reads all three prefix depths", () => {
  expect(parseDocPath("scenes[2].id required")).toEqual({ sceneIdx: 2 });
  expect(parseDocPath("scenes[1].beats[3] bad")).toEqual({ sceneIdx: 1, beatIdx: 3 });
  expect(parseDocPath("scenes[0].beats[1].timeline[2]: bad target")).toEqual({ sceneIdx: 0, beatIdx: 1, actionIdx: 2 });
});

test("parseDocPath maps object-tree messages to their scene, and gives up on deck-level ones", () => {
  expect(parseDocPath("scenes[1].objects[0].id must match /re/")).toEqual({ sceneIdx: 1 });
  expect(parseDocPath("version must be 1")).toBeUndefined();
});

test("a clean deck lints clean", () => {
  expect(lintDeck(clean())).toEqual([]);
});

test("structural failures become errors, located where the path says", () => {
  const doc = clean();
  doc.scenes[0].beats[0].timeline = [{ kind: "obj_reveal", target: "ghost" } as never];
  const issues = lintDeck(doc);
  const err = issues.find((i) => i.severity === "error")!;
  expect(err.rule).toBe("structure");
  expect(err.at).toEqual({ sceneIdx: 0, beatIdx: 0, actionIdx: 0 });
});

test("deck-level structural failures carry no location", () => {
  const doc = { ...clean(), version: 2 } as unknown as DeckDoc;
  const issues = lintDeck(doc);
  expect(issues.some((i) => i.severity === "error" && i.at === undefined)).toBe(true);
});

test("an empty scene is a warning located at that scene", () => {
  const doc = clean();
  doc.scenes.push({ id: "gap", beats: [] });
  const issues = lintDeck(doc);
  const w = issues.find((i) => i.rule === "scene-empty")!;
  expect(w.severity).toBe("warning");
  expect(w.at).toEqual({ sceneIdx: 1 });
  expect(w.message).toContain("gap");
});

test("slide-level warnings resolve their slide id back to a beat location", () => {
  const doc = clean();
  doc.scenes[0].beats.push({ id: "hollow", timeline: [] });   // no art, no timeline
  const issues = lintDeck(doc);
  const w = issues.find((i) => i.rule === "slide")!;
  expect(w.severity).toBe("warning");
  expect(w.at).toEqual({ sceneIdx: 0, beatIdx: 1 });
});

test("slide warnings are suppressed while structural errors exist", () => {
  const doc = clean();
  doc.scenes[0].beats.push({ id: "hollow", timeline: [] });   // would warn
  (doc as unknown as { version: number }).version = 2;         // but the doc is structurally broken
  const issues = lintDeck(doc);
  expect(issues.some((i) => i.severity === "error")).toBe(true);
  expect(issues.some((i) => i.rule === "slide")).toBe(false);
});

test("errors come first; warnings are sorted into document order", () => {
  const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "s0", beats: [{ id: "hollow", timeline: [] }] },     // slide warning at scene 0
    { id: "gap", beats: [] },                                   // scene-empty warning at scene 1
  ] };
  const issues = lintDeck(doc);
  expect(issues.every((i) => i.severity === "warning")).toBe(true);
  expect(issues.map((i) => i.at!.sceneIdx)).toEqual([0, 1]);
});

test("lintCounts tallies by severity", () => {
  const doc = clean();
  doc.scenes.push({ id: "gap", beats: [] });
  expect(lintCounts(lintDeck(doc))).toEqual({ errors: 0, warnings: 1 });
  expect(lintCounts([])).toEqual({ errors: 0, warnings: 0 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lint.test.ts`
Expected: FAIL — cannot resolve `@/lib/editor/lint`.

- [ ] **Step 3: Implement the module**

Create `lib/editor/lint.ts`:

```ts
import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";
import { validateDeck } from "@/engine/deck/validate";
import { flattenStory } from "@/engine/deck/flatten";

export type LintSeverity = "error" | "warning";
export interface LintLocation { sceneIdx: number; beatIdx?: number; actionIdx?: number }
export interface LintIssue {
  rule: string;
  severity: LintSeverity;
  message: string;
  /** Absent = a deck-level issue with nowhere to jump to. */
  at?: LintLocation;
}

const DOC_PATH_RE = /^scenes\[(\d+)\](?:\.beats\[(\d+)\](?:\.timeline\[(\d+)\])?)?/;

/** Read the leading `scenes[i][.beats[j][.timeline[k]]]` path that validateDeckDoc messages
 *  already carry. Object-tree messages (`scenes[i].objects[j]…`) match only the `scenes[i]`
 *  prefix and so resolve to the scene — the right granularity, since object selection is
 *  path-keyed rather than index-keyed. */
export function parseDocPath(message: string): LintLocation | undefined {
  const m = DOC_PATH_RE.exec(message);
  if (!m) return undefined;
  const at: LintLocation = { sceneIdx: Number(m[1]) };
  if (m[2] !== undefined) at.beatIdx = Number(m[2]);
  if (m[3] !== undefined) at.actionIdx = Number(m[3]);
  return at;
}

const SLIDE_ID_RE = /^slide "([^"]+)":/;

/** flattenStory builds slide ids as `${scene.id}.${beat.id}`, so a validateDeck message
 *  resolves back to a beat by scanning for that pair. */
function locateSlide(doc: DeckDoc, message: string): LintLocation | undefined {
  const m = SLIDE_ID_RE.exec(message);
  if (!m) return undefined;
  for (let sceneIdx = 0; sceneIdx < doc.scenes.length; sceneIdx++) {
    const scene = doc.scenes[sceneIdx];
    for (let beatIdx = 0; beatIdx < scene.beats.length; beatIdx++) {
      if (`${scene.id}.${scene.beats[beatIdx].id}` === m[1]) return { sceneIdx, beatIdx };
    }
  }
  return undefined;
}

const LAST = Number.MAX_SAFE_INTEGER;

/** Document order, with unlocated issues last. */
function byLocation(a: LintIssue, b: LintIssue): number {
  const key = (i: LintIssue) => i.at
    ? [i.at.sceneIdx, i.at.beatIdx ?? -1, i.at.actionIdx ?? -1]
    : [LAST, LAST, LAST];
  const ka = key(a), kb = key(b);
  for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}

/** Every problem in a deck, errors first. An "error" is exactly what makes the server reject
 *  a PUT, so it means "this deck will not save"; a "warning" is advisory only. */
export function lintDeck(doc: DeckDoc): LintIssue[] {
  // validateDeckDoc emits deck-meta problems before per-scene ones, which is the right
  // priority already — so errors keep their emission order rather than being sorted.
  const errors: LintIssue[] = validateDeckDoc(doc).errors.map((message) => ({
    rule: "structure",
    severity: "error" as const,
    message,
    at: parseDocPath(message),
  }));

  const warnings: LintIssue[] = doc.scenes.flatMap((s, sceneIdx) =>
    s.beats.length === 0
      ? [{ rule: "scene-empty", severity: "warning" as const, message: `scene "${s.id}" has no beats`, at: { sceneIdx } }]
      : []);

  // validateDeck and flattenStory both assume a structurally valid document, so they only
  // run on a clean one. The try/catch means a validator crash can never blank the panel.
  if (errors.length === 0) {
    try {
      for (const message of validateDeck(flattenStory(doc.scenes))) {
        warnings.push({ rule: "slide", severity: "warning", message, at: locateSlide(doc, message) });
      }
    } catch { /* ignore — an unlintable deck is still an editable deck */ }
  }

  return [...errors, ...warnings.sort(byLocation)];
}

export function lintCounts(issues: LintIssue[]): { errors: number; warnings: number } {
  return {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lint.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Check the shipped sample decks against the woken-up validator**

`validateDeck` has never run in production, so it may warn on `samples/demo.deck.json` and `samples/our-story.deck.json`. Lock that down as a kept regression test rather than a one-off script.

Create `tests/unit/samples-lint.test.ts`:

```ts
// @vitest-environment node
import { expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lintDeck } from "@/lib/editor/lint";
import type { DeckDoc } from "@/engine/deck-doc";

const samples = readdirSync("samples").filter((f) => f.endsWith(".deck.json"));

test("there are sample decks to check", () => {
  expect(samples.length).toBeGreaterThan(0);
});

test.each(samples)("%s has no structural errors", (file) => {
  const doc = JSON.parse(readFileSync(join("samples", file), "utf8")) as DeckDoc;
  const errors = lintDeck(doc).filter((i) => i.severity === "error");
  expect(errors).toEqual([]);   // an error means the deck would not even save
});

test.each(samples)("%s has no lint warnings", (file) => {
  const doc = JSON.parse(readFileSync(join("samples", file), "utf8")) as DeckDoc;
  const warnings = lintDeck(doc).filter((i) => i.severity === "warning");
  expect(warnings).toEqual([]);
});
```

Run: `npx vitest run tests/unit/samples-lint.test.ts`

The errors test **must** pass — an error means the shipped sample could not be saved, which would be a genuine bug. If the warnings test fails, **fix the sample deck, not the rule**: a warning firing on the shipped demo is either a real authoring defect or evidence the rule is wrong, and both deserve a look before shipping. Record what you found and what you changed in the commit message.

- [ ] **Step 6: Commit**

```bash
git add lib/editor/lint.ts tests/unit/lint.test.ts tests/unit/samples-lint.test.ts
git commit -m "feat(lint): pure lintDeck composing the structural and slide validators"
```

---

### Task 9: The lint panel

**Files:**
- Create: `components/editor/LintPanel.tsx`
- Create: `lib/editor/use-lint.ts`
- Modify: `app/editor/page.tsx`
- Modify: `app/editor/editor.css`
- Test: `tests/unit/lint-panel.test.tsx` (create)

**Interfaces:**
- Consumes: Task 8's `lintDeck`/`lintCounts`/`LintIssue`, Task 3's `flatIndexOf`, the store's `select`/`selectAction`.
- Produces: `useLint(): LintIssue[]`; `<LintPanel issues={LintIssue[]} />`; test-ids `lint-toggle`, `lint-count`, `lint-panel`, `lint-issue`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lint-panel.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEditor } from "@/lib/editor/store";
import { LintPanel } from "@/components/editor/LintPanel";
import type { LintIssue } from "@/lib/editor/lint";
import type { DeckDoc } from "@/engine/deck-doc";

const deck = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
  { id: "s2", beats: [{ id: "b", timeline: [{ kind: "text", value: "B", in: "fade" }] }] },
] });

beforeEach(() => useEditor.getState().load(deck()));
afterEach(cleanup);

test("renders one row per issue with its severity", () => {
  const issues: LintIssue[] = [
    { rule: "structure", severity: "error", message: "boom", at: { sceneIdx: 0, beatIdx: 0 } },
    { rule: "scene-empty", severity: "warning", message: "quiet", at: { sceneIdx: 1 } },
  ];
  render(<LintPanel issues={issues} />);
  const rows = screen.getAllByTestId("lint-issue");
  expect(rows).toHaveLength(2);
  expect(rows[0].getAttribute("data-severity")).toBe("error");
  expect(rows[1].getAttribute("data-severity")).toBe("warning");
});

test("shows a clean state when there are no issues", () => {
  render(<LintPanel issues={[]} />);
  expect(screen.queryAllByTestId("lint-issue")).toHaveLength(0);
  expect(screen.getByTestId("lint-panel").textContent).toContain("No issues");
});

test("clicking a located row selects that beat and action", () => {
  const issues: LintIssue[] = [
    { rule: "structure", severity: "error", message: "boom", at: { sceneIdx: 1, beatIdx: 0, actionIdx: 0 } },
  ];
  render(<LintPanel issues={issues} />);
  fireEvent.click(screen.getByTestId("lint-issue"));
  expect(useEditor.getState().selected).toBe(1);       // flat index of s2's only beat
  expect(useEditor.getState().selectedAction).toBe(0);
});

test("a deck-level row is not interactive", () => {
  const issues: LintIssue[] = [{ rule: "structure", severity: "error", message: "version must be 1" }];
  render(<LintPanel issues={issues} />);
  const row = screen.getByTestId("lint-issue");
  expect(row.tagName).not.toBe("BUTTON");
  expect(row.getAttribute("data-located")).toBe("false");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lint-panel.test.tsx`
Expected: FAIL — cannot resolve `@/components/editor/LintPanel`.

- [ ] **Step 3: Create the hook**

Create `lib/editor/use-lint.ts`:

```ts
import { useMemo } from "react";
import { useEditor } from "./store";
import { lintDeck, type LintIssue } from "./lint";

/** Re-lints whenever the doc reference changes. `commit()` produces a new reference on every
 *  real edit and none on a no-op, so this recomputes exactly when the deck actually changed. */
export function useLint(): LintIssue[] {
  const doc = useEditor((s) => s.doc);
  return useMemo(() => (doc ? lintDeck(doc) : []), [doc]);
}
```

- [ ] **Step 4: Create the panel**

Create `components/editor/LintPanel.tsx`:

```tsx
"use client";
import { useEditor } from "@/lib/editor/store";
import { flatIndexOf } from "@/lib/editor/flatten-beats";
import type { LintIssue } from "@/lib/editor/lint";

export function LintPanel({ issues }: { issues: LintIssue[] }) {
  const doc = useEditor((s) => s.doc);
  const select = useEditor((s) => s.select);
  const selectAction = useEditor((s) => s.selectAction);

  const jump = (at: NonNullable<LintIssue["at"]>) => {
    if (!doc) return;
    const flatIdx = flatIndexOf(doc, at.sceneIdx, at.beatIdx ?? 0);
    if (flatIdx < 0) return;
    select(flatIdx);
    if (at.actionIdx !== undefined) selectAction(at.actionIdx);
  };

  return (
    <div className="ed__inspector" data-testid="lint-panel">
      <div className="ed__lbl">Issues</div>
      {issues.length === 0 && <p className="ed__lint-clean">No issues.</p>}
      {issues.map((issue, i) => {
        const located = issue.at !== undefined && doc !== null;
        const props = {
          key: i,
          className: "ed__lint-row",
          "data-testid": "lint-issue",
          "data-severity": issue.severity,
          "data-rule": issue.rule,
          "data-located": String(located),
        };
        const body = (
          <>
            <span className={`ed__lint-chip ed__lint-chip--${issue.severity}`}>
              {issue.severity === "error" ? "error" : "warn"}
            </span>
            <span>{issue.message}</span>
          </>
        );
        return located
          ? <button {...props} type="button" onClick={() => jump(issue.at!)}>{body}</button>
          : <div {...props}>{body}</div>;
      })}
    </div>
  );
}
```

- [ ] **Step 5: Add the CSS**

Append to `app/editor/editor.css`:

The token set is defined in `app/editor/theme.css`: there is **no** `--ed-danger`, so errors use `--ed-accent-2` (terracotta), the palette's warm-red accent. The panel container reuses `ed__inspector`, the same class `DeckSettings.tsx` and `ExportPanel.tsx` use for the bottom-right slot.

```css
.ed__lint-clean { color: var(--ed-fg-muted); font-size: 12px; padding: 4px 12px; }
.ed__lint-row { display: flex; align-items: baseline; gap: 8px; width: 100%; text-align: left; font-size: 12px; padding: 6px 12px; background: transparent; border: 0; border-top: 1px solid var(--ed-line); color: var(--ed-fg); font-family: var(--ed-body); }
button.ed__lint-row { cursor: pointer; }
button.ed__lint-row:hover { background: rgba(253,243,228,0.06); }
.ed__lint-chip { font-family: var(--ed-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; flex: none; }
.ed__lint-chip--error { color: var(--ed-accent-2); }
.ed__lint-chip--warning { color: var(--ed-fg-muted); }
.ed__lint-badge { font-family: var(--ed-mono); font-size: 10px; margin-left: 4px; }
```

- [ ] **Step 6: Wire it into the editor page**

In `app/editor/page.tsx`:

```ts
import { LintPanel } from "@/components/editor/LintPanel";
import { useLint } from "@/lib/editor/use-lint";
import { lintCounts } from "@/lib/editor/lint";
```

Widen the panel union and compute the issues:

```ts
  type Panel = "inspector" | "settings" | "export" | "mcp" | "lint";
```

```ts
  const issues = useLint();
  const counts = lintCounts(issues);
```

Add the toolbar pill after the existing `mcp-toggle` button:

```tsx
        <button className="ed__pill ed__pill--ghost" data-testid="lint-toggle" onClick={() => togglePanel("lint")}>
          Issues
          {counts.errors + counts.warnings > 0 && (
            <span className="ed__lint-badge" data-testid="lint-count" data-errors={counts.errors}>
              {counts.errors > 0 ? `${counts.errors}!` : counts.warnings}
            </span>
          )}
        </button>
```

Extend the panel switch at the end of the component:

```tsx
      {panel === "settings" ? <DeckSettings /> : panel === "export" ? <ExportPanel /> : panel === "mcp" ? <McpPanel /> : panel === "lint" ? <LintPanel issues={issues} /> : <Inspector />}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lint-panel.test.tsx && npm test && npx tsc --noEmit`
Expected: PASS with no type errors.

- [ ] **Step 8: Commit**

```bash
git add components/editor/LintPanel.tsx lib/editor/use-lint.ts app/editor/page.tsx app/editor/editor.css tests/unit/lint-panel.test.tsx
git commit -m "feat(lint): Issues panel with count badge and jump-to-fix"
```

---

### Task 10: Surface the save-failure reason

**Files:**
- Modify: `lib/api/decks-client.ts:3-7`
- Modify: `lib/editor/use-autosave.ts`
- Modify: `app/editor/page.tsx`
- Test: `tests/unit/decks-client.test.ts` (append)

**Interfaces:**
- Produces: `req()` throws `Error(body.error)` when the server sends one; `useAutosave`'s callback becomes `onStatus(s: SaveStatus, error?: string) => void`.

- [ ] **Step 1: Write the failing test**

In `tests/unit/decks-client.test.ts`, add `saveDeck` to the existing `@/lib/api/decks-client` import at the top of the file, then append:

```ts
test("a failed request throws the server's error message, not just the status", async () => {
  const doc: DeckDoc = { version: 1, meta: { id: "demo", title: "Demo" }, scenes: [] };
  stubFetch(400, { error: "scenes[0].id required" });
  await expect(saveDeck(doc)).rejects.toThrow("scenes[0].id required");
});

test("a failed request with no usable body falls back to the status line", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 500 })));
  const doc: DeckDoc = { version: 1, meta: { id: "demo", title: "Demo" }, scenes: [] };
  await expect(saveDeck(doc)).rejects.toThrow("500");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/decks-client.test.ts`
Expected: FAIL — the thrown message is `PUT /api/decks/demo → 400`, not the server's text.

- [ ] **Step 3: Surface the error body**

In `lib/api/decks-client.ts`, replace `req`:

```ts
async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { method: "GET", ...init });
  if (!res.ok) {
    // The API answers failures with { error }. Losing it here is what left the editor
    // showing a bare "Save failed" with no way to tell what the server objected to.
    let detail: string | null = null;
    try { detail = ((await res.json()) as { error?: string }).error ?? null; } catch { detail = null; }
    throw new Error(detail ?? `${init?.method ?? "GET"} ${url} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}
```

- [ ] **Step 4: Pass the reason through autosave**

In `lib/editor/use-autosave.ts`, change the `onStatus` parameter type and the catch:

```ts
export function useAutosave(
  doc: DeckDoc | null,
  revision: number,
  onStatus: (s: SaveStatus, error?: string) => void,
  delay = 700,
): void {
```

```ts
      saveDeck(doc)
        .then(() => { lastSaved.current = rev; onStatus("saved"); })
        .catch((e) => onStatus("error", e instanceof Error ? e.message : String(e)));
```

- [ ] **Step 5: Show the reason and a Retry button**

In `app/editor/page.tsx`, add `saveDeck` to the existing decks-client import:

```ts
import { loadDeck, saveDeck } from "@/lib/api/decks-client";
```

Add the error state beside `status`:

```ts
  const [saveError, setSaveError] = useState<string | null>(null);
```

Replace `onStatus`:

```ts
  const onStatus = useCallback((s: SaveStatus, error?: string) => {
    setStatus(s);
    setSaveError(s === "error" ? (error ?? "unknown error") : null);
    if (s === "saved") externalChange.resync();
  }, [externalChange]);
```

Add a retry callback below it:

```ts
  const retrySave = useCallback(() => {
    if (!doc) return;
    setStatus("saving");
    setSaveError(null);
    saveDeck(doc)
      .then(() => { setStatus("saved"); externalChange.resync(); })
      .catch((e) => { setStatus("error"); setSaveError(e instanceof Error ? e.message : String(e)); });
  }, [doc, externalChange]);
```

Replace the `save-status` span with a status group:

```tsx
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {saveError && (
            <span data-testid="save-error" title={saveError} style={{ color: "var(--ed-fg-muted)", fontFamily: "var(--ed-mono)", fontSize: 12, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {saveError}
            </span>
          )}
          {saveError && (
            <button className="ed__pill ed__pill--ghost" data-testid="save-retry" onClick={retrySave}>Retry</button>
          )}
          <span data-testid="save-status" style={{ color: "var(--ed-fg-muted)", fontFamily: "var(--ed-mono)", fontSize: 12 }}>{STATUS_LABEL[status]}</span>
        </span>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/decks-client.test.ts && npm test && npx tsc --noEmit`
Expected: PASS with no type errors.

- [ ] **Step 7: Commit**

```bash
git add lib/api/decks-client.ts lib/editor/use-autosave.ts app/editor/page.tsx tests/unit/decks-client.test.ts
git commit -m "fix(editor): surface the server's save-failure reason with a retry"
```

---

### Task 11: End-to-end coverage for the lint panel

**Files:**
- Create: `e2e/lint.spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `e2e/lint.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("the Issues badge counts warnings and a row jumps to the offending beat", async ({ page, request }) => {
  const id = "e2e-lint";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Lint" }, scenes: [
    { id: "one", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
    { id: "gap", beats: [] },                                  // scene-empty warning
  ] };
  await request.post("/api/decks", { data: { id, title: "Lint" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await expect(page.getByTestId("lint-count")).toHaveText("1");

  await page.getByTestId("lint-toggle").click();
  const rows = page.getByTestId("lint-issue");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("gap");

  await request.delete(`/api/decks/${id}`);
});

test("a clean deck shows no badge and an empty Issues panel", async ({ page, request }) => {
  const id = "e2e-lint-clean";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Clean" }, scenes: [
    { id: "one", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Clean" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await expect(page.getByTestId("lint-count")).toHaveCount(0);
  await page.getByTestId("lint-toggle").click();
  await expect(page.getByTestId("lint-panel")).toContainText("No issues");

  await request.delete(`/api/decks/${id}`);
});

test("deleting a scene's last beat raises a warning that clears when refilled", async ({ page, request }) => {
  const id = "e2e-lint-live";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Live" }, scenes: [
    { id: "one", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
    { id: "two", beats: [{ id: "b", timeline: [{ kind: "text", value: "B", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Live" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await expect(page.getByTestId("lint-count")).toHaveCount(0);

  await page.getByTestId("filmstrip").locator(".ed__beat").first().click();
  await page.getByTestId("beat-delete").click();               // empties scene "one"
  await expect(page.getByTestId("lint-count")).toHaveText("1");

  await page.getByTestId("filmstrip").getByTestId("scene-add-beat").first().click();
  await expect(page.getByTestId("lint-count")).toHaveCount(0);

  await request.delete(`/api/decks/${id}`);
});
```

- [ ] **Step 2: Run the e2e spec**

Run: `CI=1 npm run test:e2e -- e2e/lint.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 3: Commit**

```bash
git add e2e/lint.spec.ts
git commit -m "test(lint): e2e badge counting, panel contents, and live recompute"
```

---

# Slice 3 — Empty states & error recovery

### Task 12: Empty-state selector and cards

**Files:**
- Create: `lib/editor/empty-state.ts`
- Create: `components/editor/EmptyStates.tsx`
- Modify: `app/editor/page.tsx`
- Modify: `app/editor/editor.css`
- Test: `tests/unit/empty-state.test.ts` (create)
- Modify: `e2e/structural.spec.ts`

**Interfaces:**
- Consumes: `FlatBeat` from `flatten-beats`, the store's `addScene`.
- Produces:
  - `type CanvasPlaceholder = "load-error" | "empty-deck" | "empty-scene" | null`
  - `canvasPlaceholder(opts: { loadError: boolean; doc: DeckDoc | null; selectedFlat: FlatBeat | null }): CanvasPlaceholder`
  - `isBeatEmpty(doc: DeckDoc, flat: FlatBeat): boolean`
  - `<CanvasPlaceholderCard kind deckId onRetry />`, `<EmptyBeatHint />`
  - test-ids `couldnt-load-deck`, `empty-deck`, `empty-scene`, `empty-beat`, `load-retry`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/empty-state.test.ts`:

```ts
import { expect, test } from "vitest";
import { canvasPlaceholder, isBeatEmpty } from "@/lib/editor/empty-state";
import type { DeckDoc } from "@/engine/deck-doc";
import type { FlatBeat } from "@/lib/editor/flatten-beats";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
] });
const flat = (d: DeckDoc): FlatBeat => ({ sceneId: d.scenes[0].id, beat: d.scenes[0].beats[0] });

test("a load failure wins over everything else", () => {
  expect(canvasPlaceholder({ loadError: true, doc: null, selectedFlat: null })).toBe("load-error");
  const d = doc();
  expect(canvasPlaceholder({ loadError: true, doc: d, selectedFlat: flat(d) })).toBe("load-error");
});

test("a deck that has not arrived yet shows no card", () => {
  expect(canvasPlaceholder({ loadError: false, doc: null, selectedFlat: null })).toBeNull();
});

test("a deck with no scenes shows the empty-deck card", () => {
  const d: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [] };
  expect(canvasPlaceholder({ loadError: false, doc: d, selectedFlat: null })).toBe("empty-deck");
});

test("scenes but no selectable beat shows the empty-scene card", () => {
  const d: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "gap", beats: [] }] };
  expect(canvasPlaceholder({ loadError: false, doc: d, selectedFlat: null })).toBe("empty-scene");
});

test("a normal deck shows no card", () => {
  const d = doc();
  expect(canvasPlaceholder({ loadError: false, doc: d, selectedFlat: flat(d) })).toBeNull();
});

test("isBeatEmpty is true only with no art, no timeline, and no scene objects", () => {
  const d: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "s1", beats: [{ id: "a", timeline: [] }] },
  ] };
  expect(isBeatEmpty(d, { sceneId: "s1", beat: d.scenes[0].beats[0] })).toBe(true);

  const withAction = structuredClone(d);
  withAction.scenes[0].beats[0].timeline = [{ kind: "text", value: "A", in: "fade" }];
  expect(isBeatEmpty(withAction, { sceneId: "s1", beat: withAction.scenes[0].beats[0] })).toBe(false);

  const withObject = structuredClone(d);
  withObject.scenes[0].objects = [{ id: "o1", kind: "text", transform: { x: 0, y: 0, w: 0.1, h: 0.1 } } as never];
  expect(isBeatEmpty(withObject, { sceneId: "s1", beat: withObject.scenes[0].beats[0] })).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/empty-state.test.ts`
Expected: FAIL — cannot resolve `@/lib/editor/empty-state`.

- [ ] **Step 3: Implement the selector**

Create `lib/editor/empty-state.ts`:

```ts
import type { DeckDoc } from "@/engine/deck-doc";
import type { FlatBeat } from "./flatten-beats";

export type CanvasPlaceholder = "load-error" | "empty-deck" | "empty-scene" | null;

/** Which full-canvas card (if any) replaces the stage. Ordered by precedence: a load failure
 *  beats everything, and a not-yet-arrived deck shows nothing rather than flashing a card. */
export function canvasPlaceholder(opts: {
  loadError: boolean;
  doc: DeckDoc | null;
  selectedFlat: FlatBeat | null;
}): CanvasPlaceholder {
  if (opts.loadError) return "load-error";
  if (!opts.doc) return null;
  if (opts.doc.scenes.length === 0) return "empty-deck";
  if (!opts.selectedFlat) return "empty-scene";
  return null;
}

/** True when a beat draws nothing at all. The scene-objects check matters: objects render on
 *  a beat with an empty timeline, so the hint must not cover them. */
export function isBeatEmpty(doc: DeckDoc, flat: FlatBeat): boolean {
  if (flat.beat.art) return false;
  if (flat.beat.timeline.length > 0) return false;
  const scene = doc.scenes.find((s) => s.id === flat.sceneId);
  return !scene?.objects?.length;
}
```

- [ ] **Step 4: Create the cards**

Create `components/editor/EmptyStates.tsx`:

```tsx
"use client";
import { useEditor } from "@/lib/editor/store";
import type { CanvasPlaceholder } from "@/lib/editor/empty-state";

const TEST_ID: Record<Exclude<CanvasPlaceholder, null>, string> = {
  "load-error": "couldnt-load-deck",
  "empty-deck": "empty-deck",
  "empty-scene": "empty-scene",
};

export function CanvasPlaceholderCard({ kind, deckId, onRetry }: {
  kind: Exclude<CanvasPlaceholder, null>;
  deckId: string | null;
  onRetry: () => void;
}) {
  const addScene = useEditor((s) => s.addScene);
  return (
    <div className="ed__empty-card" data-testid={TEST_ID[kind]}>
      {kind === "load-error" && (
        <>
          <p>Couldn&apos;t load deck{deckId ? ` "${deckId}"` : ""}.</p>
          <span style={{ display: "flex", gap: 8 }}>
            <button className="ed__pill ed__pill--ghost" data-testid="load-retry" onClick={onRetry}>Retry</button>
            <a className="ed__pill ed__pill--ghost" href="/">Back to library</a>
          </span>
        </>
      )}
      {kind === "empty-deck" && (
        <>
          <p>No scenes yet.</p>
          <button className="ed__pill ed__pill--ghost" onClick={() => addScene()}>＋ Add the first scene</button>
        </>
      )}
      {kind === "empty-scene" && <p>This scene has no beats. Use ＋ on the scene in the filmstrip to add one.</p>}
    </div>
  );
}

export function EmptyBeatHint() {
  return <div className="ed__empty-hint" data-testid="empty-beat">This beat is empty — add an action in the timeline below.</div>;
}
```

- [ ] **Step 5: Add the CSS**

Append to `app/editor/editor.css`:

```css
.ed__empty-card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 100%; color: var(--ed-fg-muted); font-size: 13px; text-align: center; }
.ed__empty-hint { position: absolute; inset: auto 0 12px; text-align: center; color: var(--ed-fg-muted); font-size: 12px; pointer-events: none; }
```

- [ ] **Step 6: Wire into the editor page**

In `app/editor/page.tsx`:

```ts
import { CanvasPlaceholderCard, EmptyBeatHint } from "@/components/editor/EmptyStates";
import { canvasPlaceholder, isBeatEmpty } from "@/lib/editor/empty-state";
```

Extract the deck load into a reusable callback so Retry can reuse it. Replace the existing `useEffect` deck-load block:

```ts
  const loadDeckById = useCallback((id: string) => {
    setLoadError(false);
    loadDeck(id).then(load).catch((e) => { console.error("failed to load deck", e); setLoadError(true); });
  }, [load]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("deck") ?? "demo";
    setDeckId(id);
    loadDeckById(id);
  }, [loadDeckById]);
```

Compute the states below `selectedFlat`:

```ts
  const placeholder = canvasPlaceholder({ loadError, doc, selectedFlat });
  const beatEmpty = doc && selectedFlat ? isBeatEmpty(doc, selectedFlat) : false;
```

Replace the canvas div:

```tsx
      <div className="ed__canvas" style={{ position: "relative" }}>
        {placeholder
          ? <CanvasPlaceholderCard kind={placeholder} deckId={deckId} onRetry={() => deckId && loadDeckById(deckId)} />
          : <><DeckCanvas ref={canvasRef} flat={selectedFlat} onTime={onTime} />{beatEmpty && <EmptyBeatHint />}</>}
      </div>
```

Simplify the title span, which no longer carries error duty:

```tsx
        <span style={{ color: "var(--ed-fg-muted)" }}>{doc?.meta.title ?? "no deck"}</span>
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/empty-state.test.ts && npm test && npx tsc --noEmit`
Expected: PASS with no type errors.

- [ ] **Step 8: Add e2e coverage**

Append to `e2e/structural.spec.ts`:

```ts
test("an empty deck offers to add the first scene", async ({ page, request }) => {
  const id = "e2e-empty-deck";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  await request.post("/api/decks", { data: { id, title: "Empty" } });
  await request.put(`/api/decks/${id}`, { data: { version: 1, meta: { id, title: "Empty" }, scenes: [] } });

  await page.goto(`/editor?deck=${id}`);
  await expect(page.getByTestId("empty-deck")).toBeVisible();
  await page.getByTestId("empty-deck").getByRole("button").click();
  await expect(page.getByTestId("empty-deck")).toHaveCount(0);
  await expect(page.getByTestId("filmstrip").locator(".ed__beat")).toHaveCount(1);

  await request.delete(`/api/decks/${id}`);
});

test("a missing deck offers Retry and a way back to the library", async ({ page }) => {
  await page.goto("/editor?deck=does-not-exist");
  await expect(page.getByTestId("couldnt-load-deck")).toBeVisible();
  await expect(page.getByTestId("load-retry")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to library" })).toBeVisible();
});
```

- [ ] **Step 9: Run the full e2e suite**

Run: `CI=1 npm run test:e2e`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/editor/empty-state.ts components/editor/EmptyStates.tsx app/editor/page.tsx app/editor/editor.css tests/unit/empty-state.test.ts e2e/structural.spec.ts
git commit -m "feat(editor): empty-deck/scene/beat states and recoverable load errors"
```

---

### Task 13: Documentation sync and final verification

**Files:**
- Modify: `docs/MM_MORGANA.md`
- Modify: `docs/2026-06-29-morgana-end-state-design.md`

- [ ] **Step 1: Run the whole verification set**

```bash
npm test && npx tsc --noEmit && CI=1 npm run test:e2e
```

Expected: all PASS. Do not proceed until they do.

- [ ] **Step 2: Mark Tier 1.5 complete in the end-state design**

In `docs/2026-06-29-morgana-end-state-design.md` §16, update the Tier 1.5 row to record that the tier is closed, naming this plan. Also update the §3 feature-matrix rows for scene delete/reorder, cross-scene move, validators, and empty states from ⚠️/❌ to ✅.

- [ ] **Step 3: Update the deep-dive**

In `docs/MM_MORGANA.md`, note in the design-docs section that Tier 1.5 is complete and that the MCP surface now includes the scene-structural tools.

- [ ] **Step 4: Commit**

```bash
git add docs/MM_MORGANA.md docs/2026-06-29-morgana-end-state-design.md
git commit -m "docs: mark Tier 1.5 hardening complete"
```

---

## Verification checklist

- [ ] `npm test` passes
- [ ] `npx tsc --noEmit` reports no errors
- [ ] `CI=1 npm run test:e2e` passes at default parallelism
- [ ] A scene can be deleted, reordered, and refilled from the filmstrip
- [ ] A beat moves across a scene boundary and stays selected
- [ ] An emptied scene stays visible and is flagged by the lint panel
- [ ] The Issues badge counts live and rows jump to the offending beat
- [ ] A rejected save shows the server's reason and Retry succeeds
- [ ] A missing deck shows Retry and Back to library
- [ ] `samples/*.deck.json` lint clean (or the exceptions are recorded)
