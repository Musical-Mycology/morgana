# Reparent Selection Follow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `useEditor.reparentObject` carry the selection to the moved object's new path instead of leaving a stale index path behind.

**Architecture:** Capture the moved object's id before the mutation, run the existing `commit(...)`, then re-resolve that id's path in the committed document with `findObjectPath` and set `selectedObjectPaths` to it — the same shape `groupObjects` and `addObject` already use. `enteredGroupPath` and `selectedAction` are cleared alongside. A mutation that no-ops (`commit` returns `{}`) leaves the selection untouched.

**Tech Stack:** TypeScript, Zustand store (`lib/editor/store.ts`), Vitest unit tests.

**Spec:** `docs/superpowers/specs/2026-07-27-reparent-selection-follow-design.md`

## Global Constraints

- Do not modify `lib/editor/object-mutations.ts` — the pure `reparentObject` mutation is unchanged.
- Do not add or depend on `swapSelectionSlots`; it lives on the unmerged branch `claude/strange-dirac-b40df6` and this work must stay independent of it.
- Do not add e2e tests — `store.reparentObject` still has no UI caller.
- No new imports are needed in `lib/editor/store.ts`: `getObjectAt`, `findObjectPath`, and `mReparentObject` are already imported there.
- The new selection is exactly the moved object (a single path), discarding any other selected paths.

---

### Task 1: Selection follows a reparented object

**Files:**
- Modify: `lib/editor/store.ts:230` (the `reparentObject` action)
- Test: `tests/unit/store-object-selection.test.ts` (append fixture + 5 tests)

**Interfaces:**
- Consumes (all already imported in `store.ts`):
  - `getObjectAt(objects: SceneObject[], path: ObjectPath): SceneObject | undefined` from `./object-tree`
  - `findObjectPath(objects: SceneObject[], id: string): ObjectPath | null` from `./object-tree`
  - `reparentObject as mReparentObject(doc: DeckDoc, sceneId: string, from: ObjectPath, toParent: ObjectPath, toIndex: number): DeckDoc` from `./object-mutations`
  - `commit(s: EditorState, produce: (doc: DeckDoc) => DeckDoc): Partial<EditorState>` — module-local at `lib/editor/store.ts:62`; returns `{}` (no `doc` key) when the producer hands back the same doc reference.
- Produces: no new exported symbols. The store action signature is unchanged:
  `reparentObject(sceneId: string, from: ObjectPath, toParent: ObjectPath, toIndex: number): void`

**Background for the implementer:**

`selectedObjectPaths` holds arrays of child indices (e.g. `[0, 1]` = second child of the first root object). Those indices are positions, not identities — once `reparentObject` splices a node out of one list and into another, the old path points at whatever now sits at that index. The fix re-derives the path from the object's `id`, which is unique within a scene.

The id must be read **before** `commit`, because after the move the `from` path no longer designates that node.

- [ ] **Step 1: Add the test fixture**

In `tests/unit/store-object-selection.test.ts`, extend the existing type import on line 4 to also bring in `SceneObject`, so the file's imports read:

```ts
import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import { primaryPath } from "@/lib/editor/selection";
import type { DeckDoc } from "@/engine/deck-doc";
import type { SceneObject } from "@/engine/deck/types";
```

Then append this fixture and its two readers directly **below** the existing `const primary = ...` line (before the `beforeEach`):

```ts
const shape = (id: string, x: number): SceneObject =>
  ({ id, kind: "shape", shape: "rect", transform: { x, y: 0, w: 0.1, h: 0.1 } });

/** Root list [grp(a, b), c, d] — paths: grp [0], a [0,0], b [0,1], c [1], d [2]. */
const withGroup = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "grp", kind: "group", transform: { x: 0, y: 0, w: 0.3, h: 0.1 }, children: [shape("a", 0), shape("b", 0.1)] },
    shape("c", 0.5),
    shape("d", 0.7),
  ], beats: [{ id: "b1", timeline: [] }] },
] });

const rootIds = () => useEditor.getState().doc!.scenes[0].objects!.map((o) => o.id);
const kidIds = () => {
  const grp = useEditor.getState().doc!.scenes[0].objects!.find((o) => o.id === "grp");
  return grp && grp.kind === "group" ? grp.children.map((o) => o.id) : [];
};
```

- [ ] **Step 2: Write the five failing tests**

Append to the end of `tests/unit/store-object-selection.test.ts`:

```ts
test("reparentObject into a group selects the moved object and clears the group/action context", () => {
  useEditor.getState().load(withGroup());
  useEditor.getState().selectAction(0);          // must come first: selectAction clears enteredGroupPath
  useEditor.getState().enterGroup([0]);
  useEditor.getState().reparentObject("s1", [1], [0], 0);   // 'c' into grp at index 0
  expect(kidIds()).toEqual(["c", "a", "b"]);
  expect(rootIds()).toEqual(["grp", "d"]);
  expect(useEditor.getState().selectedObjectPaths).toEqual([[0, 0]]);
  expect(useEditor.getState().enteredGroupPath).toBeNull();
  expect(useEditor.getState().selectedAction).toBeNull();
});

test("reparentObject out of a group selects the moved object at its new root path", () => {
  useEditor.getState().load(withGroup());
  useEditor.getState().reparentObject("s1", [0, 0], [], 2);  // 'a' out of grp, to root index 2
  expect(rootIds()).toEqual(["grp", "c", "a", "d"]);
  expect(kidIds()).toEqual(["b"]);
  expect(useEditor.getState().selectedObjectPaths).toEqual([[2]]);
});

test("a forward move within one list selects the adjusted index, not the requested one", () => {
  useEditor.getState().load(withGroup());
  useEditor.getState().reparentObject("s1", [1], [], 3);     // 'c' to the end of the root list
  expect(rootIds()).toEqual(["grp", "d", "c"]);
  // The removal of 'c' shifted the target, so the mutation inserted at 2, not 3.
  expect(useEditor.getState().selectedObjectPaths).toEqual([[2]]);
});

test("a refused reparent changes nothing, including the selection", () => {
  useEditor.getState().load(withGroup());
  useEditor.getState().selectObject([2]);
  const doc = useEditor.getState().doc;
  const rev = useEditor.getState().revision;
  useEditor.getState().reparentObject("s1", [0], [0, 0], 0); // grp into its own subtree
  expect(useEditor.getState().doc).toBe(doc);
  expect(useEditor.getState().revision).toBe(rev);
  expect(useEditor.getState().selectedObjectPaths).toEqual([[2]]);
});

test("reparentObject collapses a multi-selection to the moved object", () => {
  useEditor.getState().load(withGroup());
  useEditor.getState().selectObject([1]);
  useEditor.getState().toggleObjectSelection([2]);           // selection [[1],[2]]
  useEditor.getState().reparentObject("s1", [1], [0], 0);    // move 'c' into grp
  expect(useEditor.getState().selectedObjectPaths).toEqual([[0, 0]]);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/store-object-selection.test.ts
```

Expected: the four positive tests FAIL on the `selectedObjectPaths` assertion — the current action leaves the pre-move selection in place, so they report `[]` (or the stale pre-move path) where a fresh path was expected. The "refused reparent" test passes already; that is fine, it is a regression guard for the no-op guard added in Step 4.

- [ ] **Step 4: Implement the selection bookkeeping**

In `lib/editor/store.ts`, replace line 230 in full:

```ts
  reparentObject: (sceneId, from, toParent, toIndex) => set((s) => commit(s, (doc) => mReparentObject(doc, sceneId, from, toParent, toIndex))),
```

with:

```ts
  reparentObject: (sceneId, from, toParent, toIndex) => set((s) => {
    if (!s.doc) return {};
    // The id must be read before the commit: afterwards `from` designates a different node.
    const movedId = getObjectAt(s.doc.scenes.find((sc) => sc.id === sceneId)?.objects ?? [], from)?.id;
    const part = commit(s, (doc) => mReparentObject(doc, sceneId, from, toParent, toIndex));
    if (!part.doc) return {};                    // refused/unknown move: the selection must not move either
    const scene = part.doc.scenes.find((sc) => sc.id === sceneId);
    const p = movedId && scene ? findObjectPath(scene.objects ?? [], movedId) : null;
    return { ...part, selectedObjectPaths: p ? [p] : [], enteredGroupPath: null, selectedAction: null };
  }),
```

Note the re-resolution by id rather than `[...toParent, toIndex]`: the mutation clamps the insertion index and decrements it when the removal shifted the target, so the requested index is not always where the object lands. Step 2's third test pins exactly this.

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/store-object-selection.test.ts
```

Expected: PASS, all tests in the file.

- [ ] **Step 6: Run the full unit suite and the linter**

Run:

```bash
npm test
```

Expected: PASS, no failures. Then run:

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/editor/store.ts tests/unit/store-object-selection.test.ts
git commit -m "fix(editor): carry the selection with a reparented object"
```

---

## Verification

The whole change is covered by Task 1's steps 5 and 6: `npm test` green and `npm run lint` clean. There is no e2e or manual check — the action has no UI caller yet, which is why the bug was latent.
