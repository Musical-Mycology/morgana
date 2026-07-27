# Selection Follows a Reordered Object — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `reorderObject` carry `selectedObjectPaths` with the object it moves, so Raise/Lower act on the same object twice in a row and the layer toolbar's enabled state describes the object the user actually selected.

**Architecture:** A pure path-remap helper (`swapSelectionSlots`) lands in `lib/editor/selection.ts` alongside the other path-set utilities. The `reorderObject` store action calls it after a successful `commit`, mirroring the shape `groupObjects`/`deleteObject` already use. No change to `lib/editor/object-mutations.ts` — the mutation is correct; only the store's selection bookkeeping was missing.

**Tech Stack:** TypeScript, Zustand store (`lib/editor/store.ts`), Vitest + @testing-library/react (`tests/unit/`).

**Spec:** `docs/superpowers/specs/2026-07-24-reorder-selection-follow-design.md`

## Global Constraints

- Unit tests only. Do **not** touch `e2e/layers-panel.spec.ts` — the improved test this fix unblocks lives on the unmerged branch `claude/jovial-bohr-0ed2dd`; the copy on this branch predates it. The follow-up is recorded in the spec's "Deferred: the e2e assertion" section.
- Do **not** modify `reorderObject` in `lib/editor/object-mutations.ts`.
- Do **not** touch `enteredGroupPath` — explicitly out of scope per the spec.
- `ObjectPath` is `number[]` (`lib/editor/object-tree.ts`); selection paths are document indices, front-of-z = **last** index.
- Test runner: `npx vitest run <file>`. Full suite: `npm test`.
- Existing house style in these files: two-space indent, double-quoted strings, semicolons, `@/`-prefixed imports.

---

### Task 1: `swapSelectionSlots` path-remap helper

**Files:**
- Modify: `lib/editor/selection.ts` (append after `sameParentSiblings`, ~line 32)
- Test: `tests/unit/selection.test.ts`

**Interfaces:**
- Consumes: `isPrefix(prefix: ObjectPath, path: ObjectPath): boolean` and `type ObjectPath` from `./object-tree` — both are **already imported** at the top of `selection.ts`; do not add an import.
- Produces: `swapSelectionSlots(paths: ObjectPath[], parent: ObjectPath, a: number, b: number): ObjectPath[]` — consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Add to the end of `tests/unit/selection.test.ts`, and extend the existing first import line so it reads:

```ts
import { pathsEqual, pathInList, primaryPath, togglePath, sameParentSiblings, swapSelectionSlots } from "@/lib/editor/selection";
```

Then append these tests:

```ts
test("swapSelectionSlots moves a selected path across the swapped slots", () => {
  expect(swapSelectionSlots([[0]], [], 0, 1)).toEqual([[1]]);
  expect(swapSelectionSlots([[1]], [], 0, 1)).toEqual([[0]]);
});

test("swapSelectionSlots carries descendants along with the moved slot", () => {
  expect(swapSelectionSlots([[1, 0], [2, 3, 4]], [], 1, 2)).toEqual([[2, 0], [1, 3, 4]]);
});

test("swapSelectionSlots leaves untouched slots and other parents alone", () => {
  expect(swapSelectionSlots([[3], [0, 1]], [], 1, 2)).toEqual([[3], [0, 1]]);
  expect(swapSelectionSlots([[5, 1]], [0], 1, 2)).toEqual([[5, 1]]);   // swap inside group [0], path under group [5]
});

test("swapSelectionSlots remaps within a nested parent", () => {
  expect(swapSelectionSlots([[0, 1], [0, 2]], [0], 1, 2)).toEqual([[0, 2], [0, 1]]);
});

test("swapSelectionSlots ignores a path that stops above the swap depth", () => {
  expect(swapSelectionSlots([[0]], [0], 0, 1)).toEqual([[0]]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/selection.test.ts`
Expected: FAIL — TypeScript/import error, `swapSelectionSlots is not a function` (or `not exported`).

- [ ] **Step 3: Write the implementation**

Append to `lib/editor/selection.ts`, directly after `sameParentSiblings`:

```ts
/** Remap selection paths across a sibling swap of slots `a` and `b` under `parent`.
 *  Only the element at depth `parent.length` is rewritten, so a descendant of a swapped
 *  slot rides along with its ancestor. Paths outside `parent`, and paths that stop at or
 *  above the swap depth, are returned unchanged. */
export function swapSelectionSlots(paths: ObjectPath[], parent: ObjectPath, a: number, b: number): ObjectPath[] {
  return paths.map((p) => {
    if (p.length <= parent.length || !isPrefix(parent, p)) return p;
    const slot = p[parent.length];
    if (slot !== a && slot !== b) return p;
    const next = p.slice();
    next[parent.length] = slot === a ? b : a;
    return next;
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/selection.test.ts`
Expected: PASS — all tests in the file, including the five new ones.

- [ ] **Step 5: Commit**

```bash
git add lib/editor/selection.ts tests/unit/selection.test.ts && git commit -m "feat(selection): add swapSelectionSlots path remap"
```

---

### Task 2: `reorderObject` carries the selection

**Files:**
- Modify: `lib/editor/store.ts:10` (import) and `lib/editor/store.ts:208` (the action)
- Test: `tests/unit/store-object-selection.test.ts`
- Test: `tests/unit/layers-panel.test.tsx`

**Interfaces:**
- Consumes: `swapSelectionSlots(paths, parent, a, b)` from Task 1.
- Produces: no new exported surface. `reorderObject(sceneId, path, dir)` keeps its signature (`lib/editor/store.ts:54`); only its selection side effect changes.

Background the implementer needs: `commit(s, produce)` (`lib/editor/store.ts:62`) returns `{}` when the producer hands back the **same doc reference**. `mReorderObject` returns the same reference for every no-op — boundary (already topmost/backmost), unknown scene, missing sibling list. So `if (!part.doc) return {}` is exactly the "mutation didn't move it → selection must not move" guard.

- [ ] **Step 1: Write the failing store tests**

Add to `tests/unit/store-object-selection.test.ts`. The file's existing `base()` deck has no objects, so add this builder directly beneath it:

```ts
const withObjects = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "a", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 0.1, h: 0.1 } },
    { id: "b", kind: "shape", shape: "rect", transform: { x: 0.2, y: 0, w: 0.1, h: 0.1 } },
    { id: "c", kind: "shape", shape: "rect", transform: { x: 0.4, y: 0, w: 0.1, h: 0.1 } },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

const objIds = () => useEditor.getState().doc!.scenes[0].objects!.map((o) => o.id);
```

Then append these tests to the end of the file:

```ts
test("reorderObject carries the selection, so raising twice moves the same object", () => {
  useEditor.getState().load(withObjects());
  useEditor.getState().selectObject([0]);                       // 'a', backmost
  useEditor.getState().reorderObject("s1", primary()!, 1);
  expect(objIds()).toEqual(["b", "a", "c"]);
  expect(primary()).toEqual([1]);
  useEditor.getState().reorderObject("s1", primary()!, 1);
  expect(objIds()).toEqual(["b", "c", "a"]);                    // 'a' moved twice, not 'b'
  expect(primary()).toEqual([2]);
});

test("reorderObject remaps a selected swap partner as well as the moved object", () => {
  useEditor.getState().load(withObjects());
  useEditor.getState().selectObject([0]);
  useEditor.getState().toggleObjectSelection([1]);               // selection [[0],[1]], primary [1] = 'b'
  useEditor.getState().reorderObject("s1", [1], -1);             // 'b' lowers past 'a'
  expect(objIds()).toEqual(["b", "a", "c"]);
  expect(useEditor.getState().selectedObjectPaths).toEqual([[1], [0]]);  // 'a' -> [1], 'b' -> [0]
});

test("a boundary reorder is a no-op and leaves the selection where it was", () => {
  useEditor.getState().load(withObjects());
  useEditor.getState().selectObject([2]);                        // already topmost
  const rev = useEditor.getState().revision;
  useEditor.getState().reorderObject("s1", [2], 1);
  expect(objIds()).toEqual(["a", "b", "c"]);
  expect(useEditor.getState().selectedObjectPaths).toEqual([[2]]);
  expect(useEditor.getState().revision).toBe(rev);
});
```

- [ ] **Step 2: Write the failing panel test**

Append to `tests/unit/layers-panel.test.tsx` (its `doc()` is objects `[a, g(→c0), b]`; panel rows render front-of-z first, so `a` is backmost):

```tsx
test("raising twice walks the same object to the top, and the toolbar follows it", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("a"));                        // path [0], backmost
  fireEvent.click(screen.getByTestId("layer-raise"));
  fireEvent.click(screen.getByTestId("layer-raise"));
  // 'a' is raised both times — not the object swapped down by the first click
  expect(useEditor.getState().doc!.scenes[0].objects!.map((o) => o.id)).toEqual(["g", "b", "a"]);
  // the toolbar now describes 'a' at the top of the list, not whatever sits in its old slot
  expect((screen.getByTestId("layer-raise") as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByTestId("layer-lower") as HTMLButtonElement).disabled).toBe(false);
});
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `npx vitest run tests/unit/store-object-selection.test.ts tests/unit/layers-panel.test.tsx`
Expected: FAIL — 3 store failures (`primary()` still `[0]` after the first raise; `objIds()` `["b","c","a"]` received `["a","b","c"]`-style mismatches) and 1 panel failure asserting `["g","b","a"]` but receiving `["a","g","b"]`. The boundary test may already pass; that is fine, it is the regression guard.

- [ ] **Step 4: Write the implementation**

In `lib/editor/store.ts`, extend the selection import on line 10:

```ts
import { togglePath, sameParentSiblings, swapSelectionSlots } from "./selection";
```

Replace the one-line action at line 208:

```ts
  reorderObject: (sceneId, path, dir) => set((s) => commit(s, (doc) => mReorderObject(doc, sceneId, path, dir))),
```

with:

```ts
  reorderObject: (sceneId, path, dir) => set((s) => {
    const part = commit(s, (doc) => mReorderObject(doc, sceneId, path, dir));
    if (!part.doc) return {};                      // boundary/unknown-scene no-op: selection must not move either
    const parent = path.slice(0, -1);
    const idx = path[path.length - 1];
    return { ...part, selectedObjectPaths: swapSelectionSlots(s.selectedObjectPaths, parent, idx, idx + dir) };
  }),
```

- [ ] **Step 5: Run both test files to verify they pass**

Run: `npx vitest run tests/unit/store-object-selection.test.ts tests/unit/layers-panel.test.tsx`
Expected: PASS — every test in both files.

- [ ] **Step 6: Run the full unit suite and the linter**

Run: `npm test`
Expected: PASS — no regressions anywhere (`store-objects`, `store-grouping-selection`, `objects-layer-*`, `object-mutations` all still green).

Run: `npm run lint`
Expected: no new errors or warnings.

- [ ] **Step 7: Commit**

```bash
git add lib/editor/store.ts tests/unit/store-object-selection.test.ts tests/unit/layers-panel.test.tsx && git commit -m "fix(editor): carry the selection with a reordered object"
```

---

## Self-Review

**Spec coverage.** Spec §Design/1 (`swapSelectionSlots`, all four remap cases) → Task 1 Steps 1&3. §Design/2 (store action + `!part.doc` boundary guard) → Task 2 Steps 1&4. §Testing `selection.test.ts` bullets (moved, partner, descendant, other-parent) → Task 1 Step 1. §Testing store bullets (raise twice, boundary no-op, selected partner) → Task 2 Step 1. §Testing `layers-panel.test.tsx` bullets (walks to top, Raise disabled) → Task 2 Step 2. §Out of scope (`enteredGroupPath`) and §Deferred (e2e) → Global Constraints, both as prohibitions. No gaps.

**Placeholder scan.** No TBD/TODO, no "add error handling", no "similar to Task N". Every code step carries complete code; every run step carries an exact command and expected result.

**Type consistency.** `swapSelectionSlots(paths, parent, a, b)` is declared identically in Task 1's Interfaces, Task 1 Step 3's implementation, and Task 2 Step 4's call site. `ObjectPath` and `isPrefix` come from `./object-tree` and are already imported in `selection.ts`. `part.doc` matches `commit`'s `Partial<EditorState>` return.
