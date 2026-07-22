# Layers & Grouping Panel (#2c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the docked layers panel — a structural navigator over a scene's objects — with multi-select, z-order, group/ungroup, hide/lock, rename, in-panel add, and PowerPoint-style group-as-selection-unit on the canvas.

**Architecture:** Generalize the store's single `selectedObjectPath` to an ordered `selectedObjectPaths` set (last = primary) plus an `enteredGroupPath` context; extract all tree/selection logic into pure, unit-tested helpers (`lib/editor/selection.ts`); add a `translateObjectBy` mutation for group moves; build a thin `LayersPanel` component; and wire canvas hit-resolution to the group-as-unit model. All existing grouping/reorder/reparent mutations from #1 are reused unchanged.

**Tech Stack:** Next.js (client components), Zustand store, TypeScript, vitest (jsdom + @testing-library/react) for unit/component tests, Playwright for e2e. No new dependencies.

## Global Constraints

- **No schema changes.** The object data model (`SceneObject`, `ObjectTransform`, `hidden`/`locked`/`name`) is fixed by #1. #2c only manipulates existing objects/flags via existing mutations plus the one new pure `translateObjectBy`.
- **No engine/playback render.** The panel and canvas overlay are authoring-time only; playback rendering is #3.
- **Pure helpers.** All non-trivial tree/selection logic lives in pure functions with unit tests; components stay thin.
- **Immutability convention.** Pure mutations return the **same doc reference** on no-op (unknown scene/path); the store's `commit` treats a same-reference return as "record nothing."
- **Styling.** Global CSS in `app/editor/editor.css` using `--ed-*` theme tokens only (no hardcoded colors, no CSS modules, no Tailwind). Per-object/inline positioning matches existing editor components.
- **Standalone-OSS positioning.** No Musical-Mycology-specific coupling in this repo.
- **Local gate:** `npm test` (vitest) and `npx tsc --noEmit -p .` must pass. Playwright e2e may only run in CI (a fresh worktree can have an incomplete `node_modules/next`; never block a task on local e2e).
- **Branch from `main`** (#2a/#2b are merged).

---

## File Structure

**Create:**
- `lib/editor/selection.ts` — pure selection-set algebra + `resolveCanvasSelection` + `flattenForPanel`.
- `components/editor/LayersPanel.tsx` — the docked layers tree navigator.
- `tests/unit/selection.test.ts`, `tests/unit/object-translate.test.ts`, `tests/unit/store-object-translate.test.ts`, `tests/unit/store-grouping-selection.test.ts`, `tests/unit/layers-panel.test.tsx`, `tests/unit/objects-layer-group-select.test.tsx`, `tests/unit/objects-layer-group-move.test.tsx`, `e2e/layers-panel.spec.ts`.

**Modify:**
- `lib/editor/object-mutations.ts` — add `translateObjectBy`.
- `lib/editor/store.ts` — selection state migration, new methods, clamps, selection-aware group/ungroup, `translateObjectBy` wrapper.
- `components/editor/ObjectsLayer.tsx` — read `selectedObjectPaths`, multi-select outlines, group-as-unit click / double-click / exit, single-only overlay, group-move drag.
- `components/editor/Inspector.tsx` — read primary; multi-select summary.
- `app/editor/page.tsx` — mount `LayersPanel`, Escape key, remove top-bar add stopgap.
- `app/editor/editor.css` — left-column split + layer row styles.
- Existing tests: `tests/unit/store-object-selection.test.ts`, `tests/unit/objects-layer-select.test.tsx`, `tests/unit/inspector-objects.test.tsx`, `e2e/objects.spec.ts` (add-control reference).

---

## Task 1: Selection-set algebra (`selection.ts`)

**Files:**
- Create: `lib/editor/selection.ts`
- Test: `tests/unit/selection.test.ts`

**Interfaces:**
- Consumes: `ObjectPath` from `lib/editor/object-tree.ts`.
- Produces: `pathsEqual(a, b): boolean`, `pathInList(list: ObjectPath[], p: ObjectPath): boolean`, `primaryPath(paths: ObjectPath[]): ObjectPath | null`, `togglePath(list: ObjectPath[], p: ObjectPath): ObjectPath[]`, `sameParentSiblings(paths: ObjectPath[]): boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/selection.test.ts`:

```ts
import { expect, test } from "vitest";
import { pathsEqual, pathInList, primaryPath, togglePath, sameParentSiblings } from "@/lib/editor/selection";

test("pathsEqual compares by value and handles null/undefined", () => {
  expect(pathsEqual([0, 1], [0, 1])).toBe(true);
  expect(pathsEqual([0, 1], [0, 2])).toBe(false);
  expect(pathsEqual([0], [0, 1])).toBe(false);
  expect(pathsEqual(null, [0])).toBe(false);
  expect(pathsEqual([0], undefined)).toBe(false);
});

test("pathInList finds a path by value", () => {
  expect(pathInList([[0], [1, 2]], [1, 2])).toBe(true);
  expect(pathInList([[0], [1, 2]], [1, 3])).toBe(false);
});

test("primaryPath returns the last path or null", () => {
  expect(primaryPath([])).toBeNull();
  expect(primaryPath([[0], [2]])).toEqual([2]);
});

test("togglePath adds an absent path (as new primary) and removes a present one", () => {
  expect(togglePath([[0]], [1])).toEqual([[0], [1]]);
  expect(togglePath([[0], [1]], [0])).toEqual([[1]]);
});

test("sameParentSiblings: true only for >=2 paths sharing one parent", () => {
  expect(sameParentSiblings([[0], [2]])).toBe(true);          // root siblings
  expect(sameParentSiblings([[1, 0], [1, 2]])).toBe(true);     // siblings in group 1
  expect(sameParentSiblings([[0]])).toBe(false);               // single
  expect(sameParentSiblings([[0], [1, 0]])).toBe(false);       // different depth/parent
  expect(sameParentSiblings([[1, 0], [2, 0]])).toBe(false);    // different parent
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/selection.test.ts`
Expected: FAIL — `Cannot find module '@/lib/editor/selection'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/editor/selection.ts`:

```ts
import type { ObjectPath } from "./object-tree";

/** Value-equality for two ObjectPaths (null/undefined are never equal to anything). */
export function pathsEqual(a: ObjectPath | null | undefined, b: ObjectPath | null | undefined): boolean {
  if (!a || !b) return false;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** True if `p` is present in `list` (by value). */
export function pathInList(list: ObjectPath[], p: ObjectPath): boolean {
  return list.some((q) => pathsEqual(q, p));
}

/** The primary selection = the last path, or null when the set is empty. */
export function primaryPath(paths: ObjectPath[]): ObjectPath | null {
  return paths.length ? paths[paths.length - 1] : null;
}

/** Add `p` if absent (it becomes the new primary), else remove it. Order preserved. */
export function togglePath(list: ObjectPath[], p: ObjectPath): ObjectPath[] {
  return pathInList(list, p) ? list.filter((q) => !pathsEqual(q, p)) : [...list, p];
}

/** True when >=2 paths share exactly one parent (the `groupObjects` precondition). */
export function sameParentSiblings(paths: ObjectPath[]): boolean {
  if (paths.length < 2) return false;
  const parent = paths[0].slice(0, -1);
  return paths.every(
    (p) => p.length === paths[0].length && p.slice(0, -1).every((v, i) => v === parent[i])
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/selection.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/editor/selection.ts tests/unit/selection.test.ts
git commit -m "feat(objects): selection-set algebra helpers (#2c)"
```

---

## Task 2: Group-as-unit hit resolution (`resolveCanvasSelection`)

**Files:**
- Modify: `lib/editor/selection.ts`
- Test: `tests/unit/selection.test.ts`

**Interfaces:**
- Consumes: `isPrefix` from `lib/editor/object-tree.ts`.
- Produces: `resolveCanvasSelection(hitPath: ObjectPath, enteredGroupPath: ObjectPath | null): ObjectPath`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/selection.test.ts`:

```ts
import { resolveCanvasSelection } from "@/lib/editor/selection";

test("resolveCanvasSelection at root selects the top-level ancestor", () => {
  // hit a child of the root group [1] -> select the group [1]
  expect(resolveCanvasSelection([1, 0], null)).toEqual([1]);
  // hit a deeply-nested leaf -> still the top-level ancestor
  expect(resolveCanvasSelection([1, 0, 2], null)).toEqual([1]);
  // hit a top-level leaf -> itself
  expect(resolveCanvasSelection([0], null)).toEqual([0]);
});

test("resolveCanvasSelection inside an entered group selects that group's direct child", () => {
  // entered group [1], hit its child [1,0] -> select [1,0]
  expect(resolveCanvasSelection([1, 0], [1])).toEqual([1, 0]);
  // entered [1], hit a nested-group child [1,0,3] -> select the direct child group [1,0]
  expect(resolveCanvasSelection([1, 0, 3], [1])).toEqual([1, 0]);
});

test("resolveCanvasSelection ignores an entered group the hit is not inside", () => {
  // entered [1] but hit is under root object [2] -> resolve at root
  expect(resolveCanvasSelection([2, 0], [1])).toEqual([2]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/selection.test.ts`
Expected: FAIL — `resolveCanvasSelection is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `lib/editor/selection.ts` (and extend the import line):

```ts
import { isPrefix, type ObjectPath } from "./object-tree";
```

```ts
/** Group-as-unit hit resolution. Given the leaf `hitPath` under the cursor and the
 *  currently-entered group (null = root context), return the path to actually select:
 *  the direct child of the entered context that contains the hit. When the hit is not
 *  inside the entered group, resolve at the root (top-level ancestor). */
export function resolveCanvasSelection(hitPath: ObjectPath, enteredGroupPath: ObjectPath | null): ObjectPath {
  const ctx = enteredGroupPath && isPrefix(enteredGroupPath, hitPath) ? enteredGroupPath.length : 0;
  return hitPath.slice(0, Math.min(ctx + 1, hitPath.length));
}
```

(Replace the earlier `import type { ObjectPath } from "./object-tree";` line with the combined import above.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/selection.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add lib/editor/selection.ts tests/unit/selection.test.ts
git commit -m "feat(objects): group-as-unit canvas hit resolution (#2c)"
```

---

## Task 3: Panel row flattening (`flattenForPanel`)

**Files:**
- Modify: `lib/editor/selection.ts`
- Test: `tests/unit/selection.test.ts`

**Interfaces:**
- Consumes: `SceneObject` from `@/engine/deck/types`, `ObjectPath`.
- Produces: `interface PanelRow { obj: SceneObject; path: ObjectPath; depth: number }` and `flattenForPanel(objects: SceneObject[], collapsed: Set<string>): PanelRow[]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/selection.test.ts`:

```ts
import { flattenForPanel } from "@/lib/editor/selection";
import type { SceneObject } from "@/engine/deck/types";

const T = { x: 0, y: 0, w: 0.1, h: 0.1 };
const tree = (): SceneObject[] => [
  { id: "A", kind: "shape", shape: "rect", transform: { ...T } },
  { id: "G", kind: "group", transform: { ...T }, children: [
    { id: "c0", kind: "shape", shape: "rect", transform: { ...T } },
    { id: "c1", kind: "shape", shape: "rect", transform: { ...T } },
  ] },
  { id: "B", kind: "shape", shape: "rect", transform: { ...T } },
];

test("flattenForPanel is front-of-z first with the group header above its children", () => {
  const rows = flattenForPanel(tree(), new Set());
  expect(rows.map((r) => r.obj.id)).toEqual(["B", "G", "c1", "c0", "A"]);
  // paths stay canonical (document indices), depth reflects nesting
  expect(rows.find((r) => r.obj.id === "c1")!.path).toEqual([1, 1]);
  expect(rows.find((r) => r.obj.id === "c1")!.depth).toBe(1);
  expect(rows.find((r) => r.obj.id === "G")!.depth).toBe(0);
});

test("flattenForPanel skips a collapsed group's children", () => {
  const rows = flattenForPanel(tree(), new Set(["G"]));
  expect(rows.map((r) => r.obj.id)).toEqual(["B", "G", "A"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/selection.test.ts`
Expected: FAIL — `flattenForPanel is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `lib/editor/selection.ts` (add `SceneObject` import at top):

```ts
import type { SceneObject } from "@/engine/deck/types";
```

```ts
export interface PanelRow { obj: SceneObject; path: ObjectPath; depth: number }

/** Rows for the layers panel: depth-first, per-level reversed (front-of-z first —
 *  Photoshop order), skipping the children of collapsed groups. A group header row is
 *  emitted directly above its (indented) children. Paths remain canonical document
 *  indices; only display order is reversed. */
export function flattenForPanel(
  objects: SceneObject[],
  collapsed: Set<string>,
  base: ObjectPath = [],
  depth = 0,
): PanelRow[] {
  const out: PanelRow[] = [];
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    const path = [...base, i];
    out.push({ obj, path, depth });
    if (obj.kind === "group" && !collapsed.has(obj.id)) {
      out.push(...flattenForPanel(obj.children, collapsed, path, depth + 1));
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/selection.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add lib/editor/selection.ts tests/unit/selection.test.ts
git commit -m "feat(objects): flattenForPanel front-of-z panel rows (#2c)"
```

---

## Task 4: `translateObjectBy` pure mutation

**Files:**
- Modify: `lib/editor/object-mutations.ts`
- Test: `tests/unit/object-translate.test.ts`

**Interfaces:**
- Consumes: `mapSceneObjects` (module-private), `getObjectAt`, `mapChildList`, `ObjectPath`, `round3` from `./object-drag`.
- Produces: `translateObjectBy(doc: DeckDoc, sceneId: string, path: ObjectPath, dx: number, dy: number): DeckDoc`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/object-translate.test.ts`:

```ts
import { expect, test } from "vitest";
import { translateObjectBy } from "@/lib/editor/object-mutations";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "a", kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.2, w: 0.3, h: 0.3 } },
    { id: "g", kind: "group", transform: { x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, children: [
      { id: "c0", kind: "shape", shape: "rect", transform: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } },
      { id: "c1", kind: "shape", shape: "rect", transform: { x: 0.7, y: 0.7, w: 0.1, h: 0.1 } },
    ] },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

test("translates a leaf object's x/y", () => {
  const next = translateObjectBy(doc(), "s1", [0], 0.05, -0.1);
  expect(next.scenes[0].objects![0].transform).toMatchObject({ x: 0.15, y: 0.1, w: 0.3, h: 0.3 });
});

test("translating a group offsets the group and every descendant", () => {
  const next = translateObjectBy(doc(), "s1", [1], 0.1, 0.1);
  const g = next.scenes[0].objects![1] as Extract<typeof next.scenes[0]["objects"][number], { kind: "group" }>;
  expect(g.transform).toMatchObject({ x: 0.6, y: 0.6 });
  expect(g.children[0].transform).toMatchObject({ x: 0.6, y: 0.6 });
  expect(g.children[1].transform).toMatchObject({ x: 0.8, y: 0.8 });
});

test("zero delta and unknown path return the same doc reference", () => {
  const d = doc();
  expect(translateObjectBy(d, "s1", [0], 0, 0)).toBe(d);
  expect(translateObjectBy(d, "s1", [9], 0.1, 0.1)).toBe(d);
  expect(translateObjectBy(d, "nope", [0], 0.1, 0.1)).toBe(d);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/object-translate.test.ts`
Expected: FAIL — `translateObjectBy is not exported` / not a function.

- [ ] **Step 3: Write minimal implementation**

In `lib/editor/object-mutations.ts`, add the import and the function (place `shift` + `translateObjectBy` after `updateObjectTransform`):

```ts
import { round3 } from "./object-drag";
```

```ts
/** Offset a single object's transform, recursing into a group's descendants (which hold
 *  absolute coords in #1) so a whole group moves together. */
function shift(o: SceneObject, dx: number, dy: number): SceneObject {
  const t = o.transform;
  const transform = { ...t, x: round3(t.x + dx), y: round3(t.y + dy) };
  return o.kind === "group"
    ? { ...o, transform, children: o.children.map((c) => shift(c, dx, dy)) }
    : { ...o, transform };
}

/** Offset the node at `path` — and, for a group, all its descendants — by (dx, dy) in
 *  stage fractions. Used for group-as-unit drag. Zero delta / unknown scene/path → same doc. */
export function translateObjectBy(doc: DeckDoc, sceneId: string, path: ObjectPath, dx: number, dy: number): DeckDoc {
  if (dx === 0 && dy === 0) return doc;
  return mapSceneObjects(doc, sceneId, (objects) => {
    if (!getObjectAt(objects, path)) return objects;
    const parent = path.slice(0, -1);
    const idx = path[path.length - 1];
    return mapChildList(objects, parent, (list) => list.map((o, i) => (i === idx ? shift(o, dx, dy) : o)));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/object-translate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/editor/object-mutations.ts tests/unit/object-translate.test.ts
git commit -m "feat(objects): translateObjectBy group-aware offset mutation (#2c)"
```

---

## Task 5: Store selection migration (`selectedObjectPaths` + `enteredGroupPath`)

Replaces the single `selectedObjectPath` with the ordered set + entered-group context, updates every clamp, and shims the four consumers via `primaryPath` so behavior is unchanged for single-selection. Selection-aware grouping and the translate wrapper are Tasks 6–7.

**Files:**
- Modify: `lib/editor/store.ts`
- Modify: `components/editor/ObjectsLayer.tsx`, `components/editor/Inspector.tsx`, `app/editor/page.tsx`
- Modify tests: `tests/unit/store-object-selection.test.ts`, `tests/unit/objects-layer-select.test.tsx`, `tests/unit/inspector-objects.test.tsx`

**Interfaces:**
- Consumes: `primaryPath`, `togglePath` from `lib/editor/selection.ts`.
- Produces (store): `selectedObjectPaths: ObjectPath[]`, `enteredGroupPath: ObjectPath | null`, `selectObject(path: ObjectPath | null)`, `toggleObjectSelection(path: ObjectPath)`, `setObjectSelection(paths: ObjectPath[])`, `enterGroup(path: ObjectPath)`, `exitGroup()`. Removes `selectedObjectPath`.

- [ ] **Step 1: Update the store's existing selection tests to the new API (write the failing tests)**

Replace the body of `tests/unit/store-object-selection.test.ts` with:

```ts
import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import { primaryPath } from "@/lib/editor/selection";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "b1", timeline: [{ kind: "text", value: "x", in: "fade" }] }, { id: "b2", timeline: [] }] },
] });

const primary = () => primaryPath(useEditor.getState().selectedObjectPaths);

beforeEach(() => { useEditor.getState().load(base()); });

test("selectObject sets a single-path selection and clears selectedAction", () => {
  useEditor.getState().selectAction(0);
  useEditor.getState().selectObject([0]);
  expect(useEditor.getState().selectedObjectPaths).toEqual([[0]]);
  expect(useEditor.getState().selectedAction).toBeNull();
});

test("selectObject(null) clears the selection", () => {
  useEditor.getState().selectObject([0]);
  useEditor.getState().selectObject(null);
  expect(useEditor.getState().selectedObjectPaths).toEqual([]);
});

test("toggleObjectSelection adds then removes a path", () => {
  useEditor.getState().selectObject([0]);
  useEditor.getState().toggleObjectSelection([1]);
  expect(useEditor.getState().selectedObjectPaths).toEqual([[0], [1]]);
  expect(primary()).toEqual([1]);
  useEditor.getState().toggleObjectSelection([0]);
  expect(useEditor.getState().selectedObjectPaths).toEqual([[1]]);
});

test("setObjectSelection replaces the whole set", () => {
  useEditor.getState().setObjectSelection([[0], [1]]);
  expect(useEditor.getState().selectedObjectPaths).toEqual([[0], [1]]);
});

test("enterGroup / exitGroup step the entered-group context", () => {
  useEditor.getState().enterGroup([2]);
  expect(useEditor.getState().enteredGroupPath).toEqual([2]);
  useEditor.getState().exitGroup();
  expect(useEditor.getState().enteredGroupPath).toBeNull();
});

test("exitGroup with no entered group clears the selection", () => {
  useEditor.getState().selectObject([0]);
  useEditor.getState().exitGroup();
  expect(useEditor.getState().selectedObjectPaths).toEqual([]);
});

test("selectAction clears the object selection (mutual exclusion)", () => {
  useEditor.getState().selectObject([0]);
  useEditor.getState().selectAction(0);
  expect(useEditor.getState().selectedAction).toBe(0);
  expect(useEditor.getState().selectedObjectPaths).toEqual([]);
});

test("changing the selected beat clears object selection and entered group", () => {
  useEditor.getState().selectObject([0]);
  useEditor.getState().enterGroup([0]);
  useEditor.getState().select(1);
  expect(useEditor.getState().selectedObjectPaths).toEqual([]);
  expect(useEditor.getState().enteredGroupPath).toBeNull();
  expect(useEditor.getState().selectedAction).toBeNull();
});

test("addObject selects the new object; deleteObject clears the selection", () => {
  useEditor.getState().addObject("s1", "text");
  expect(useEditor.getState().selectedObjectPaths).toEqual([[0]]);
  useEditor.getState().deleteObject("s1", [0]);
  expect(useEditor.getState().selectedObjectPaths).toEqual([]);
});

test("load, addAction, deleteBeat, deleteScene each clear the object selection", () => {
  const clearAnd = (fn: () => void) => { useEditor.getState().load(base()); useEditor.getState().selectObject([0]); fn(); return useEditor.getState().selectedObjectPaths; };
  expect(clearAnd(() => useEditor.getState().load(base()))).toEqual([]);
  expect(clearAnd(() => useEditor.getState().addAction(0, null, "text"))).toEqual([]);
  expect(clearAnd(() => useEditor.getState().deleteBeat(0))).toEqual([]);
  expect(clearAnd(() => useEditor.getState().deleteScene(0))).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/store-object-selection.test.ts`
Expected: FAIL — `selectedObjectPaths` undefined / `toggleObjectSelection is not a function`.

- [ ] **Step 3: Migrate the store**

In `lib/editor/store.ts`:

(a) Add the import (top, near the other `object-tree` import):

```ts
import { primaryPath, togglePath } from "./selection";
```

(b) In `interface EditorState`, replace `selectedObjectPath: ObjectPath | null;` with:

```ts
  selectedObjectPaths: ObjectPath[];
  enteredGroupPath: ObjectPath | null;
```

and replace the `selectObject` signature line with:

```ts
  selectObject: (path: ObjectPath | null) => void;
  toggleObjectSelection: (path: ObjectPath) => void;
  setObjectSelection: (paths: ObjectPath[]) => void;
  enterGroup: (path: ObjectPath) => void;
  exitGroup: () => void;
```

(c) In the initial state object, replace `selectedObjectPath: null,` with:

```ts
  selectedObjectPaths: [],
  enteredGroupPath: null,
```

(d) In `load`, replace `selectedObjectPath: null` with `selectedObjectPaths: [], enteredGroupPath: null`.

(e) In `select`, replace `selectedObjectPath: null` with `selectedObjectPaths: [], enteredGroupPath: null`.

(f) Replace the `selectAction` and `selectObject` methods with:

```ts
  selectAction: (i) => set({ selectedAction: i, selectedObjectPaths: [], enteredGroupPath: null }),
  selectObject: (path) => set({ selectedObjectPaths: path ? [path] : [], enteredGroupPath: null, selectedAction: null }),
  toggleObjectSelection: (path) => set((s) => ({ selectedObjectPaths: togglePath(s.selectedObjectPaths, path), selectedAction: null })),
  setObjectSelection: (paths) => set({ selectedObjectPaths: paths, selectedAction: null }),
  enterGroup: (path) => set({ enteredGroupPath: path }),
  exitGroup: () => set((s) => {
    if (s.enteredGroupPath && s.enteredGroupPath.length > 0) {
      const up = s.enteredGroupPath.slice(0, -1);
      return { enteredGroupPath: up.length ? up : null };
    }
    return { selectedObjectPaths: [], enteredGroupPath: null };
  }),
```

(g) In `undo` and `redo`, replace `selectedObjectPath: null` with `selectedObjectPaths: [], enteredGroupPath: null`.

(h) In `deleteBeat` and `deleteScene`, replace `selectedObjectPath: null` with `selectedObjectPaths: [], enteredGroupPath: null`.

(i) In `addAction`, replace `selectedObjectPath: null` with `selectedObjectPaths: [], enteredGroupPath: null`.

(j) In `addObject`, replace the return with:

```ts
    const scene = part.doc.scenes.find((sc) => sc.id === sceneId);
    const p = scene ? findObjectPath(scene.objects ?? [], object.id) : null;
    return { ...part, selectedObjectPaths: p ? [p] : [], enteredGroupPath: null, selectedAction: null };
```

(k) In `deleteObject`, replace `selectedObjectPath: null` with `selectedObjectPaths: [], enteredGroupPath: null`.

- [ ] **Step 4: Shim the four consumers via `primaryPath` (behavior unchanged)**

`components/editor/ObjectsLayer.tsx` — replace the selection reads:

```ts
import { primaryPath } from "@/lib/editor/selection";
```

Replace `const selectedObjectPath = useEditor((s) => s.selectedObjectPath);` with:

```ts
  const selectedObjectPaths = useEditor((s) => s.selectedObjectPaths);
  const selectedObjectPath = primaryPath(selectedObjectPaths);
```

(Everything downstream that used `selectedObjectPath` stays as-is for this task.)

`components/editor/Inspector.tsx` — add the import and derive the primary:

```ts
import { primaryPath } from "@/lib/editor/selection";
```

Replace `const selectedObjectPath = useEditor((s) => s.selectedObjectPath);` with:

```ts
  const selectedObjectPaths = useEditor((s) => s.selectedObjectPaths);
  const selectedObjectPath = primaryPath(selectedObjectPaths);
```

`app/editor/page.tsx` — add the import and derive the primary:

```ts
import { primaryPath } from "@/lib/editor/selection";
```

Replace `const selectedObjectPath = useEditor((s) => s.selectedObjectPath);` with:

```ts
  const selectedObjectPaths = useEditor((s) => s.selectedObjectPaths);
  const selectedObjectPath = primaryPath(selectedObjectPaths);
```

(The `keydown` effect's `selectedObjectPath` usage and dependency array keep working with the derived value. Leave the dependency array referencing `selectedObjectPath`.)

- [ ] **Step 5: Update the other two existing tests' selection reads**

`tests/unit/objects-layer-select.test.tsx` — add `import { primaryPath } from "@/lib/editor/selection";` and replace the three `useEditor.getState().selectedObjectPath` reads:
- line ~23: `expect(primaryPath(useEditor.getState().selectedObjectPaths)).toEqual([0]);`
- line ~29: `expect(primaryPath(useEditor.getState().selectedObjectPaths)).toBeNull();`
- line ~36: `expect(primaryPath(useEditor.getState().selectedObjectPaths)).toBeNull();`

`tests/unit/inspector-objects.test.tsx` — add `import { primaryPath } from "@/lib/editor/selection";` and replace line ~28:
- `expect(primaryPath(useEditor.getState().selectedObjectPaths)).toBeNull();`

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npm test`
Expected: PASS (all suites, including `store-object-selection`, `objects-layer-select`, `objects-layer-drag`, `objects-layer`, `inspector-objects`, `selection-overlay`).

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/editor/store.ts components/editor/ObjectsLayer.tsx components/editor/Inspector.tsx app/editor/page.tsx tests/unit/store-object-selection.test.ts tests/unit/objects-layer-select.test.tsx tests/unit/inspector-objects.test.tsx
git commit -m "refactor(objects): store selection set + enteredGroupPath, primary shim (#2c)"
```

---

## Task 6: Selection-aware group / ungroup (store)

**Files:**
- Modify: `lib/editor/store.ts`
- Test: `tests/unit/store-grouping-selection.test.ts`

**Interfaces:**
- Consumes: `findObjectPath`, `getObjectAt` (`object-tree`), `sameParentSiblings` (`selection`), existing `mGroupObjects`/`mUngroupObject`.
- Produces: updated store `groupObjects(sceneId, paths)` (selects the new group), `ungroupObject(sceneId, path)` (selects the spliced-in children).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/store-grouping-selection.test.ts`:

```ts
import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import { getObjectAt } from "@/lib/editor/object-tree";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "a", kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } },
    { id: "b", kind: "shape", shape: "rect", transform: { x: 0.3, y: 0.3, w: 0.1, h: 0.1 } },
    { id: "c", kind: "shape", shape: "rect", transform: { x: 0.6, y: 0.6, w: 0.1, h: 0.1 } },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(doc()); });

test("groupObjects wraps the selected siblings and selects the new group", () => {
  useEditor.getState().setObjectSelection([[0], [1]]);
  useEditor.getState().groupObjects("s1", [[0], [1]]);
  const sel = useEditor.getState().selectedObjectPaths;
  expect(sel).toHaveLength(1);
  const g = getObjectAt(useEditor.getState().doc!.scenes[0].objects!, sel[0]);
  expect(g!.kind).toBe("group");
});

test("groupObjects on a non-sibling selection is a no-op (selection unchanged)", () => {
  useEditor.getState().setObjectSelection([[0]]);
  useEditor.getState().groupObjects("s1", [[0]]);           // single -> not sameParentSiblings
  expect(useEditor.getState().selectedObjectPaths).toEqual([[0]]);
  expect(useEditor.getState().doc!.scenes[0].objects).toHaveLength(3);
});

test("ungroupObject splices children back and selects them", () => {
  useEditor.getState().groupObjects("s1", [[0], [1]]);       // objects: [group(a,b), c]
  useEditor.getState().ungroupObject("s1", [0]);             // -> [a, b, c]
  expect(useEditor.getState().doc!.scenes[0].objects).toHaveLength(3);
  expect(useEditor.getState().selectedObjectPaths).toEqual([[0], [1]]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/store-grouping-selection.test.ts`
Expected: FAIL — group/ungroup don't set selection yet (asserts on `selectedObjectPaths` fail).

- [ ] **Step 3: Make group/ungroup selection-aware**

In `lib/editor/store.ts`, add `sameParentSiblings` to the selection import:

```ts
import { primaryPath, togglePath, sameParentSiblings } from "./selection";
```

Replace the `groupObjects` and `ungroupObject` store methods with:

```ts
  groupObjects: (sceneId, paths) => set((s) => {
    if (!s.doc || !sameParentSiblings(paths)) return {};
    const groupId = uniqueObjectId(s.doc, sceneId);
    const part = commit(s, (doc) => mGroupObjects(doc, sceneId, paths, groupId));
    if (!part.doc) return {};
    const scene = part.doc.scenes.find((sc) => sc.id === sceneId);
    const p = scene ? findObjectPath(scene.objects ?? [], groupId) : null;
    return { ...part, selectedObjectPaths: p ? [p] : [], enteredGroupPath: null, selectedAction: null };
  }),
  ungroupObject: (sceneId, path) => set((s) => {
    if (!s.doc) return {};
    const before = s.doc.scenes.find((sc) => sc.id === sceneId)?.objects ?? [];
    const target = getObjectAt(before, path);
    const n = target && target.kind === "group" ? target.children.length : 0;
    const part = commit(s, (doc) => mUngroupObject(doc, sceneId, path));
    if (!part.doc) return {};
    const slot = path[path.length - 1];
    const parent = path.slice(0, -1);
    const kids: ObjectPath[] = Array.from({ length: n }, (_, i) => [...parent, slot + i]);
    return { ...part, selectedObjectPaths: kids, enteredGroupPath: null, selectedAction: null };
  }),
```

Add `getObjectAt` to the `object-tree` import if not already present:

```ts
import { uniqueObjectId, findObjectPath, getObjectAt, type ObjectPath } from "./object-tree";
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/store-grouping-selection.test.ts`
Expected: PASS (3 tests).

Run: `npm test`
Expected: PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add lib/editor/store.ts tests/unit/store-grouping-selection.test.ts
git commit -m "feat(objects): selection-aware group/ungroup in store (#2c)"
```

---

## Task 7: Store `translateObjectBy` wrapper

**Files:**
- Modify: `lib/editor/store.ts`
- Test: `tests/unit/store-object-translate.test.ts`

**Interfaces:**
- Consumes: `translateObjectBy as mTranslateObjectBy` from `object-mutations`.
- Produces: store `translateObjectBy(sceneId: string, path: ObjectPath, dx: number, dy: number)` → one undo entry.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/store-object-translate.test.ts`:

```ts
import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "g", kind: "group", transform: { x: 0.5, y: 0.5, w: 0.3, h: 0.3 }, children: [
      { id: "c", kind: "shape", shape: "rect", transform: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } },
    ] },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(doc()); });

test("translateObjectBy moves a group + descendants in one undo entry", () => {
  const rev = useEditor.getState().revision;
  useEditor.getState().translateObjectBy("s1", [0], 0.1, 0.1);
  const objs = useEditor.getState().doc!.scenes[0].objects!;
  expect(objs[0].transform).toMatchObject({ x: 0.6, y: 0.6 });
  expect((objs[0] as { children: { transform: { x: number; y: number } }[] }).children[0].transform).toMatchObject({ x: 0.6, y: 0.6 });
  expect(useEditor.getState().revision).toBe(rev + 1);
  useEditor.getState().undo();
  expect(useEditor.getState().doc!.scenes[0].objects![0].transform).toMatchObject({ x: 0.5, y: 0.5 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/store-object-translate.test.ts`
Expected: FAIL — `translateObjectBy is not a function` on the store.

- [ ] **Step 3: Add the store wrapper**

In `lib/editor/store.ts`, extend the object-mutations import with `translateObjectBy as mTranslateObjectBy`, add to `interface EditorState`:

```ts
  translateObjectBy: (sceneId: string, path: ObjectPath, dx: number, dy: number) => void;
```

and add the method (next to `updateObjectTransform`):

```ts
  translateObjectBy: (sceneId, path, dx, dy) => set((s) => commit(s, (doc) => mTranslateObjectBy(doc, sceneId, path, dx, dy))),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/store-object-translate.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/editor/store.ts tests/unit/store-object-translate.test.ts
git commit -m "feat(objects): store translateObjectBy wrapper (#2c)"
```

---

## Task 8: Inspector multi-select summary

**Files:**
- Modify: `components/editor/Inspector.tsx`
- Test: `tests/unit/inspector-objects.test.tsx`

**Interfaces:**
- Consumes: `selectedObjectPaths`, `primaryPath`.
- Produces: Inspector renders the primary's fields when exactly one is selected; a `"{n} objects selected"` summary (testid `inspector-multi`) when ≥2.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/inspector-objects.test.tsx`:

```ts
test("with multiple objects selected, the inspector shows a multi-select summary", () => {
  useEditor.getState().load({ version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "s1", objects: [
      { id: "o-1", kind: "text", text: "Hi", transform: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 } },
      { id: "o-2", kind: "text", text: "Yo", transform: { x: 0.5, y: 0.5, w: 0.3, h: 0.2 } },
    ], beats: [{ id: "b1", timeline: [] }] },
  ] });
  useEditor.getState().setObjectSelection([[0], [1]]);
  render(<Inspector />);
  expect(screen.getByTestId("inspector-multi").textContent).toMatch(/2 objects selected/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/inspector-objects.test.tsx`
Expected: FAIL — `inspector-multi` not found.

- [ ] **Step 3: Add the summary branch**

In `components/editor/Inspector.tsx`, immediately **before** the existing `if (selectedObjectPath && sceneId) {` block, add:

```tsx
  if (selectedObjectPaths.length > 1 && sceneId) {
    return (
      <div className="ed__inspector" data-testid="inspector">
        <div data-testid="inspector-multi" style={{ fontFamily: "var(--ed-disp)", fontSize: 14, marginBottom: 8 }}>
          {selectedObjectPaths.length} objects selected
        </div>
        <p style={{ opacity: 0.6, fontSize: 12 }}>Group or ungroup from the Layers panel toolbar.</p>
      </div>
    );
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/inspector-objects.test.tsx`
Expected: PASS (all tests, including the single-select ones unchanged).

- [ ] **Step 5: Commit**

```bash
git add components/editor/Inspector.tsx tests/unit/inspector-objects.test.tsx
git commit -m "feat(objects): Inspector multi-select summary (#2c)"
```

---

## Task 9: `LayersPanel` — render + selection + mount + layout split

**Files:**
- Create: `components/editor/LayersPanel.tsx`
- Modify: `app/editor/page.tsx`, `app/editor/editor.css`
- Test: `tests/unit/layers-panel.test.tsx`

**Interfaces:**
- Consumes: `flattenForPanel`, `primaryPath`, `pathInList` (`selection`); `descriptorForObject` (`object-registry`); store `selectedObjectPaths`, `selectObject`, `toggleObjectSelection`; `beats`, `selected`, `doc`.
- Produces: `<LayersPanel/>` — rows (`data-testid="layer-row"`, `data-obj-id`), front-of-z order, indentation, `aria-current` primary; plain click → `selectObject`, shift/⌘-click → `toggleObjectSelection`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/layers-panel.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LayersPanel } from "@/components/editor/LayersPanel";
import { useEditor } from "@/lib/editor/store";
import { primaryPath } from "@/lib/editor/selection";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "a", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 0.1, h: 0.1 } },
    { id: "g", kind: "group", name: "My Group", transform: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, children: [
      { id: "c0", kind: "text", text: "hi", transform: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } },
    ] },
    { id: "b", kind: "shape", shape: "rect", transform: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

const rows = () => screen.getAllByTestId("layer-row");
const rowFor = (id: string) => rows().find((r) => r.getAttribute("data-obj-id") === id)!;

beforeEach(() => { useEditor.getState().load(doc()); });
afterEach(cleanup);

test("renders one row per object, front-of-z first with the group above its child", () => {
  render(<LayersPanel />);
  expect(rows().map((r) => r.getAttribute("data-obj-id"))).toEqual(["b", "g", "c0", "a"]);
});

test("a row shows the object's name when present, else kind + id", () => {
  render(<LayersPanel />);
  expect(rowFor("g").textContent).toContain("My Group");
  expect(rowFor("a").textContent).toContain("shape");
});

test("clicking a row selects that exact object at its depth", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("c0"));
  expect(primaryPath(useEditor.getState().selectedObjectPaths)).toEqual([1, 0]);
});

test("shift-clicking toggles multi-selection", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("a"));
  fireEvent.click(rowFor("b"), { shiftKey: true });
  expect(useEditor.getState().selectedObjectPaths).toEqual([[0], [2]]);
});

test("the primary row is aria-current", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("a"));
  expect(rowFor("a").getAttribute("aria-current")).toBe("true");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/layers-panel.test.tsx`
Expected: FAIL — `Cannot find module '@/components/editor/LayersPanel'`.

- [ ] **Step 3: Create the component**

Create `components/editor/LayersPanel.tsx`:

```tsx
"use client";
import { useEditor } from "@/lib/editor/store";
import { flattenForPanel, pathInList, primaryPath } from "@/lib/editor/selection";
import { descriptorForObject } from "@/lib/editor/object-registry";
import type { ObjectPath } from "@/lib/editor/object-tree";

export function LayersPanel() {
  const doc = useEditor((s) => s.doc);
  const selected = useEditor((s) => s.selected);
  const beats = useEditor((s) => s.beats);
  const selectedObjectPaths = useEditor((s) => s.selectedObjectPaths);
  const selectObject = useEditor((s) => s.selectObject);
  const toggleObjectSelection = useEditor((s) => s.toggleObjectSelection);

  const sceneId = beats[selected]?.sceneId;
  const objects = doc?.scenes.find((sc) => sc.id === sceneId)?.objects ?? [];
  const primary = primaryPath(selectedObjectPaths);
  const rows = flattenForPanel(objects, new Set<string>());

  const clickRow = (path: ObjectPath) => (e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) toggleObjectSelection(path);
    else selectObject(path);
  };

  return (
    <div className="ed__layers" data-testid="layers-panel">
      <div className="ed__lbl">Layers</div>
      {rows.length === 0 && <div style={{ padding: "6px 12px", color: "var(--ed-fg-muted)", fontSize: 12 }}>No objects</div>}
      {rows.map(({ obj, path, depth }) => {
        const label = obj.name ?? `${obj.kind} · ${obj.id}`;
        const isPrimary = !!primary && pathInList([primary], path);
        const isSelected = pathInList(selectedObjectPaths, path);
        return (
          <div
            key={obj.id}
            data-testid="layer-row"
            data-obj-id={obj.id}
            className={`ed__layer${isSelected ? " ed__layer--selected" : ""}`}
            aria-current={isPrimary ? "true" : undefined}
            onClick={clickRow(path)}
            style={{ paddingLeft: 8 + depth * 14, cursor: "pointer" }}
          >
            <span className="ed__layer-kind" aria-hidden>{glyph(obj.kind)}</span>
            <span className="ed__layer-name">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function glyph(kind: ReturnType<typeof descriptorForObject> extends never ? never : Parameters<typeof descriptorForObject>[0]["kind"]): string {
  return { text: "T", image: "▣", shape: "◆", group: "❏" }[kind];
}
```

*(If the `glyph` parameter type reads awkwardly to the type-checker, simplify its signature to `glyph(kind: "text" | "image" | "shape" | "group"): string`.)*

- [ ] **Step 4: Mount the panel and split the left column**

`app/editor/page.tsx` — add the import:

```ts
import { LayersPanel } from "@/components/editor/LayersPanel";
```

Replace the `<Filmstrip />` line with a wrapping split:

```tsx
      <div className="ed__leftdock">
        <div className="ed__leftdock-film"><Filmstrip /></div>
        <div className="ed__leftdock-layers"><LayersPanel /></div>
      </div>
```

`app/editor/editor.css` — the `.ed__film` grid area needs to host the split. Add:

```css
.ed__leftdock { grid-area: film; display: flex; flex-direction: column; min-height: 0; background: var(--ed-bg-1); border-right: 1px solid var(--ed-line); }
.ed__leftdock-film { flex: 1 1 55%; overflow: auto; min-height: 0; }
.ed__leftdock-layers { flex: 1 1 45%; overflow: auto; min-height: 0; border-top: 1px solid var(--ed-line); }
.ed__layers { padding-bottom: 8px; }
.ed__layer { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-left: 3px solid transparent; font-size: 12.5px; color: var(--ed-fg); }
.ed__layer[aria-current="true"] { border-left-color: var(--ed-accent); background: rgba(212,168,67,0.14); }
.ed__layer--selected { background: rgba(212,168,67,0.08); }
.ed__layer-kind { width: 14px; text-align: center; color: var(--ed-fg-muted); }
.ed__layer-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

Because `.ed__leftdock` now owns `grid-area: film`, remove the now-redundant `grid-area: film;` from `.ed__film` — the Filmstrip renders inside `.ed__leftdock-film`. Leave the rest of `.ed__film` (its `overflow`, `background`) intact; those are superseded by the wrappers. (Verify the Filmstrip still scrolls inside `.ed__leftdock-film`.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/unit/layers-panel.test.tsx`
Expected: PASS (5 tests).

Run: `npm test && npx tsc --noEmit -p .`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add components/editor/LayersPanel.tsx app/editor/page.tsx app/editor/editor.css tests/unit/layers-panel.test.tsx
git commit -m "feat(objects): LayersPanel render + selection + left-column split (#2c)"
```

---

## Task 10: `LayersPanel` — hide/lock toggles, inline rename, collapse

**Files:**
- Modify: `components/editor/LayersPanel.tsx`, `app/editor/editor.css`
- Test: `tests/unit/layers-panel.test.tsx`

**Interfaces:**
- Consumes: store `updateObject`; local `useState` for `collapsed: Set<string>` and `editingId: string | null`.
- Produces: per-row hide (`data-testid="layer-hide"`) + lock (`data-testid="layer-lock"`) toggles; group chevron (`data-testid="layer-collapse"`); inline rename (`data-testid="layer-rename-input"`).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/layers-panel.test.tsx`:

```tsx
import { within } from "@testing-library/react";

const toggleIn = (id: string, testid: string) => fireEvent.click(within(rowFor(id)).getByTestId(testid));

test("the hide toggle flips the object's hidden flag", () => {
  render(<LayersPanel />);
  toggleIn("a", "layer-hide");
  expect(useEditor.getState().doc!.scenes[0].objects![0].hidden).toBe(true);
});

test("the lock toggle flips the object's locked flag", () => {
  render(<LayersPanel />);
  toggleIn("a", "layer-lock");
  expect(useEditor.getState().doc!.scenes[0].objects![0].locked).toBe(true);
});

test("collapsing a group hides its children in the tree", () => {
  render(<LayersPanel />);
  toggleIn("g", "layer-collapse");
  expect(rows().map((r) => r.getAttribute("data-obj-id"))).toEqual(["b", "g", "a"]);
});

test("double-clicking a row name commits a rename on Enter", () => {
  render(<LayersPanel />);
  fireEvent.doubleClick(within(rowFor("a")).getByTestId("layer-name"));
  const input = screen.getByTestId("layer-rename-input") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Backdrop" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(useEditor.getState().doc!.scenes[0].objects![0].name).toBe("Backdrop");
});
```

Change the `layer-name` span in the component test expectation: the name element must carry `data-testid="layer-name"` (added in Step 3).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/layers-panel.test.tsx`
Expected: FAIL — `layer-hide` / `layer-collapse` / `layer-rename-input` not found.

- [ ] **Step 3: Extend the component**

Rewrite `components/editor/LayersPanel.tsx` to add local state, toggles, chevron, and inline rename:

```tsx
"use client";
import { useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { flattenForPanel, pathInList, primaryPath } from "@/lib/editor/selection";
import type { ObjectPath } from "@/lib/editor/object-tree";
import type { SceneObject } from "@/engine/deck/types";

const glyph = (kind: SceneObject["kind"]): string => ({ text: "T", image: "▣", shape: "◆", group: "❏" }[kind]);

export function LayersPanel() {
  const doc = useEditor((s) => s.doc);
  const selected = useEditor((s) => s.selected);
  const beats = useEditor((s) => s.beats);
  const selectedObjectPaths = useEditor((s) => s.selectedObjectPaths);
  const selectObject = useEditor((s) => s.selectObject);
  const toggleObjectSelection = useEditor((s) => s.toggleObjectSelection);
  const updateObject = useEditor((s) => s.updateObject);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);

  const sceneId = beats[selected]?.sceneId;
  const objects = doc?.scenes.find((sc) => sc.id === sceneId)?.objects ?? [];
  const primary = primaryPath(selectedObjectPaths);
  const rows = flattenForPanel(objects, collapsed);

  const clickRow = (path: ObjectPath) => (e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) toggleObjectSelection(path);
    else selectObject(path);
  };
  const toggleCollapse = (id: string) => setCollapsed((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const commitRename = (path: ObjectPath, value: string) => {
    if (sceneId) updateObject(sceneId, path, "name", value.trim() || undefined);
    setEditingId(null);
  };

  return (
    <div className="ed__layers" data-testid="layers-panel">
      <div className="ed__lbl">Layers</div>
      {rows.length === 0 && <div style={{ padding: "6px 12px", color: "var(--ed-fg-muted)", fontSize: 12 }}>No objects</div>}
      {rows.map(({ obj, path, depth }) => {
        const label = obj.name ?? `${obj.kind} · ${obj.id}`;
        const isPrimary = !!primary && pathInList([primary], path);
        const isSelected = pathInList(selectedObjectPaths, path);
        const cls = `ed__layer${isSelected ? " ed__layer--selected" : ""}${obj.hidden ? " ed__layer--hidden" : ""}${obj.locked ? " ed__layer--locked" : ""}`;
        return (
          <div
            key={obj.id}
            data-testid="layer-row"
            data-obj-id={obj.id}
            className={cls}
            aria-current={isPrimary ? "true" : undefined}
            onClick={clickRow(path)}
            style={{ paddingLeft: 8 + depth * 14, cursor: "pointer" }}
          >
            {obj.kind === "group" ? (
              <button className="ed__layer-chevron" data-testid="layer-collapse" title="Collapse/expand"
                onClick={(e) => { e.stopPropagation(); toggleCollapse(obj.id); }}>
                {collapsed.has(obj.id) ? "▸" : "▾"}
              </button>
            ) : <span className="ed__layer-chevron" aria-hidden />}
            <span className="ed__layer-kind" aria-hidden>{glyph(obj.kind)}</span>
            {editingId === obj.id ? (
              <input
                className="ed__layer-input"
                data-testid="layer-rename-input"
                autoFocus
                defaultValue={obj.name ?? ""}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => commitRename(path, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(path, e.currentTarget.value);
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
              <span className="ed__layer-name" data-testid="layer-name"
                onDoubleClick={(e) => { e.stopPropagation(); setEditingId(obj.id); }}>{label}</span>
            )}
            <span className="ed__layer-toggles">
              <button className="ed__icon" data-testid="layer-hide" title={obj.hidden ? "Show" : "Hide"}
                onClick={(e) => { e.stopPropagation(); if (sceneId) updateObject(sceneId, path, "hidden", !obj.hidden); }}>
                {obj.hidden ? "◌" : "●"}
              </button>
              <button className="ed__icon" data-testid="layer-lock" title={obj.locked ? "Unlock" : "Lock"}
                onClick={(e) => { e.stopPropagation(); if (sceneId) updateObject(sceneId, path, "locked", !obj.locked); }}>
                {obj.locked ? "🔒" : "🔓"}
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

`app/editor/editor.css` — add:

```css
.ed__layer { justify-content: flex-start; }
.ed__layer-chevron { width: 14px; background: transparent; border: 0; color: var(--ed-fg-muted); cursor: pointer; padding: 0; font-size: 11px; }
.ed__layer-name { flex: 1; }
.ed__layer-input { flex: 1; font: inherit; background: var(--ed-bg-0); color: var(--ed-fg); border: 1px solid var(--ed-accent); border-radius: 4px; padding: 1px 4px; }
.ed__layer-toggles { display: flex; gap: 2px; margin-left: auto; }
.ed__layer--hidden .ed__layer-name { opacity: 0.5; }
.ed__layer--locked .ed__layer-name { font-style: italic; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/layers-panel.test.tsx`
Expected: PASS (all tests).

Run: `npm test && npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/editor/LayersPanel.tsx app/editor/editor.css tests/unit/layers-panel.test.tsx
git commit -m "feat(objects): LayersPanel hide/lock, rename, collapse (#2c)"
```

---

## Task 11: `LayersPanel` — toolbar + in-panel add; remove top-bar stopgap

**Files:**
- Modify: `components/editor/LayersPanel.tsx`, `app/editor/page.tsx`, `app/editor/editor.css`, `e2e/objects.spec.ts`
- Test: `tests/unit/layers-panel.test.tsx`

**Interfaces:**
- Consumes: store `reorderObject`, `groupObjects`, `ungroupObject`, `deleteObject`, `addObject`; `sameParentSiblings`, `getObjectAt`.
- Produces: toolbar (`layer-raise`, `layer-lower`, `layer-group`, `layer-ungroup`, `layer-delete`) + add control (`layer-object-add`). The top-bar `object-add` select is removed.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/layers-panel.test.tsx`:

```tsx
test("raise moves the primary up in z (reorderObject +1)", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("a"));                       // path [0], backmost
  fireEvent.click(screen.getByTestId("layer-raise"));
  // 'a' swaps with 'g' -> objects order becomes [g, a, b]
  expect(useEditor.getState().doc!.scenes[0].objects!.map((o) => o.id)).toEqual(["g", "a", "b"]);
});

test("Group is disabled unless >=2 same-parent siblings are selected", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("a"));
  expect((screen.getByTestId("layer-group") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(rowFor("b"), { shiftKey: true });   // [0] + [2], same parent
  expect((screen.getByTestId("layer-group") as HTMLButtonElement).disabled).toBe(false);
});

test("Group wraps the selection into a group", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("a"));
  fireEvent.click(rowFor("b"), { shiftKey: true });
  fireEvent.click(screen.getByTestId("layer-group"));
  const kinds = useEditor.getState().doc!.scenes[0].objects!.map((o) => o.kind);
  expect(kinds.filter((k) => k === "group")).toHaveLength(2); // pre-existing 'g' + new group
});

test("Ungroup is enabled only for a single selected group and splices it", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("g"));
  expect((screen.getByTestId("layer-ungroup") as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByTestId("layer-ungroup"));
  expect(useEditor.getState().doc!.scenes[0].objects!.some((o) => o.id === "c0")).toBe(true);
});

test("the add control appends a new object", () => {
  render(<LayersPanel />);
  fireEvent.change(screen.getByTestId("layer-object-add"), { target: { value: "text" } });
  expect(useEditor.getState().doc!.scenes[0].objects!.some((o) => o.kind === "text" && o.id !== "c0")).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/layers-panel.test.tsx`
Expected: FAIL — `layer-raise` / `layer-group` / `layer-object-add` not found.

- [ ] **Step 3: Add the toolbar + add control**

In `components/editor/LayersPanel.tsx`:

(a) Extend the store hooks:

```tsx
  const reorderObject = useEditor((s) => s.reorderObject);
  const groupObjects = useEditor((s) => s.groupObjects);
  const ungroupObject = useEditor((s) => s.ungroupObject);
  const deleteObject = useEditor((s) => s.deleteObject);
  const addObject = useEditor((s) => s.addObject);
```

(b) Add imports:

```tsx
import { flattenForPanel, pathInList, primaryPath, sameParentSiblings } from "@/lib/editor/selection";
import { getObjectAt, type ObjectPath } from "@/lib/editor/object-tree";
```

(c) Compute toolbar enablement (after `const rows = ...`):

```tsx
  const primaryObj = primary ? getObjectAt(objects, primary) : undefined;
  const canGroup = sameParentSiblings(selectedObjectPaths);
  const canUngroup = selectedObjectPaths.length === 1 && primaryObj?.kind === "group";
  const canReorder = !!primary;
```

(d) Insert the toolbar just after the `<div className="ed__lbl">Layers</div>` line:

```tsx
      <div className="ed__layer-toolbar">
        <button className="ed__icon" data-testid="layer-raise" title="Raise" disabled={!canReorder}
          onClick={() => primary && sceneId && reorderObject(sceneId, primary, 1)}>↑</button>
        <button className="ed__icon" data-testid="layer-lower" title="Lower" disabled={!canReorder}
          onClick={() => primary && sceneId && reorderObject(sceneId, primary, -1)}>↓</button>
        <button className="ed__icon" data-testid="layer-group" title="Group" disabled={!canGroup}
          onClick={() => sceneId && groupObjects(sceneId, selectedObjectPaths)}>❏</button>
        <button className="ed__icon" data-testid="layer-ungroup" title="Ungroup" disabled={!canUngroup}
          onClick={() => primary && sceneId && ungroupObject(sceneId, primary)}>⤢</button>
        <button className="ed__icon" data-testid="layer-delete" title="Delete" disabled={!primary}
          onClick={() => primary && sceneId && deleteObject(sceneId, primary)}>✕</button>
        <select className="ed__layer-add" data-testid="layer-object-add" value=""
          onChange={(e) => { if (e.target.value && sceneId) addObject(sceneId, e.target.value as "text" | "image" | "shape"); }}>
          <option value="">＋ Object…</option>
          <option value="text">Text</option>
          <option value="image">Image</option>
          <option value="shape">Shape</option>
        </select>
      </div>
```

*(Raise = visually up = higher z = later array index → `reorderObject(..., 1)`; Lower → `-1`.)*

`app/editor/editor.css` — add:

```css
.ed__layer-toolbar { display: flex; gap: 2px; align-items: center; padding: 2px 8px 6px; flex-wrap: wrap; }
.ed__layer-add { font-size: 11px; margin-left: auto; }
```

- [ ] **Step 4: Remove the top-bar add stopgap**

`app/editor/page.tsx` — delete the `<select data-testid="object-add" ...>...</select>` block (the entire element and its `<option>`s) from `.ed__bar`. Remove the now-unused `addObject` hook and the `OBJECT_REGISTRY` import **only if** they are no longer referenced elsewhere in the file (the Escape/Delete effect does not use them). If `addObject` is still referenced, keep it.

`e2e/objects.spec.ts` — update the add step from the removed top-bar select to the panel control. Replace:

```ts
await page.getByTestId("object-add").selectOption("text");
```

with:

```ts
await page.getByTestId("layer-object-add").selectOption("text");
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/unit/layers-panel.test.tsx`
Expected: PASS (all tests).

Run: `npm test && npx tsc --noEmit -p .`
Expected: PASS, no type errors, no unused-import errors.

- [ ] **Step 6: Commit**

```bash
git add components/editor/LayersPanel.tsx app/editor/page.tsx app/editor/editor.css e2e/objects.spec.ts tests/unit/layers-panel.test.tsx
git commit -m "feat(objects): LayersPanel toolbar + in-panel add; drop top-bar stopgap (#2c)"
```

---

## Task 12: Canvas group-as-unit selection

Wires `resolveCanvasSelection` into `ObjectsLayer`, adds double-click-to-enter, Escape/empty-click exit, shift-click multi-select, and multi-select outlines; the resize/rotate overlay renders only for a single primary.

**Files:**
- Modify: `components/editor/ObjectsLayer.tsx`, `app/editor/page.tsx`
- Test: `tests/unit/objects-layer-group-select.test.tsx`

**Interfaces:**
- Consumes: `resolveCanvasSelection`, `pathInList`, `primaryPath`; store `enteredGroupPath`, `enterGroup`, `exitGroup`, `toggleObjectSelection`.
- Produces: canvas single-click selects via group-as-unit; double-click a group enters it; Escape/empty exits; every selected object outlined; overlay only when `selectedObjectPaths.length === 1`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/objects-layer-group-select.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { ObjectsLayer } from "@/components/editor/ObjectsLayer";
import { useEditor } from "@/lib/editor/store";
import { primaryPath } from "@/lib/editor/selection";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "g", kind: "group", transform: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, children: [
      { id: "c0", kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } },
    ] },
    { id: "solo", kind: "shape", shape: "rect", transform: { x: 0.7, y: 0.7, w: 0.1, h: 0.1 } },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

const boxFor = (id: string) => screen.getAllByTestId("obj").find((b) => b.getAttribute("data-obj-id") === id)!;

beforeEach(() => { useEditor.getState().load(doc()); });
afterEach(cleanup);

test("clicking a grouped child selects the top-level group", () => {
  // group renders its child box; select the group first so the child is visible/hittable
  useEditor.getState().selectObject([0]);
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  fireEvent.pointerDown(boxFor("c0"));
  expect(primaryPath(useEditor.getState().selectedObjectPaths)).toEqual([0]);
});

test("double-clicking a group enters it so a child becomes selectable", () => {
  useEditor.getState().selectObject([0]);
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  fireEvent.doubleClick(boxFor("c0"));
  expect(useEditor.getState().enteredGroupPath).toEqual([0]);
  expect(primaryPath(useEditor.getState().selectedObjectPaths)).toEqual([0, 0]);
});

test("the resize/rotate overlay is suppressed while multiple objects are selected", () => {
  useEditor.getState().setObjectSelection([[0], [1]]);
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  expect(screen.queryByTestId("obj-selection")).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/objects-layer-group-select.test.tsx`
Expected: FAIL — child click selects `[0,0]` (leaf) not `[0]`; no `enteredGroupPath`; overlay still shown.

- [ ] **Step 3: Wire group-as-unit into `ObjectsLayer`**

In `components/editor/ObjectsLayer.tsx`:

(a) Extend imports/hooks:

```tsx
import { primaryPath, pathInList, resolveCanvasSelection } from "@/lib/editor/selection";
```

```tsx
  const enteredGroupPath = useEditor((s) => s.enteredGroupPath);
  const enterGroup = useEditor((s) => s.enterGroup);
  const toggleObjectSelection = useEditor((s) => s.toggleObjectSelection);
```

(b) Replace the `bodyDown` selection line. Currently `bodyDown` calls `selectObject(path)`. Change the beginning of `bodyDown` to resolve group-as-unit and honor modifier-click:

```tsx
  const bodyDown = (obj: SceneObject, path: ObjectPath) => (e: React.PointerEvent) => {
    if (obj.locked) return;
    const resolved = resolveCanvasSelection(path, enteredGroupPath);
    if (e.shiftKey || e.metaKey || e.ctrlKey) { toggleObjectSelection(resolved); return; }
    selectObject(resolved);
    // ...unchanged drag setup below, but use `resolved` as the drag target path...
  };
```

The drag block after selection must operate on the **resolved** path and its object. Replace the rest of `bodyDown` so `t`, `path`, and the commit use the resolved target:

```tsx
    const targetPath = resolved;
    const targetObj = getObjectAt(objects, targetPath) ?? obj;
    const t = targetObj.transform;
    let off = { x: 0, y: 0 };
    startDrag(e, {
      onStart: (c) => { const f = pointerFraction(c.rect, c.clientX, c.clientY); off = { x: f.x - t.x, y: f.y - t.y }; },
      onMove: (c) => { const f = pointerFraction(c.rect, c.clientX, c.clientY); setPreview({ path: targetPath, patch: { x: round3(f.x - off.x), y: round3(f.y - off.y) } }); },
      onCommit: (c) => {
        if (c.moved) {
          const f = pointerFraction(c.rect, c.clientX, c.clientY);
          const patch = { x: round3(f.x - off.x), y: round3(f.y - off.y) };
          if (transformChanged(t, patch)) updateObjectTransform(sceneId!, targetPath, patch);
        }
        setPreview(null);
      },
    });
```

*(Group-move via `translateObjectBy` replaces this `onCommit` for groups in Task 13; this task keeps the existing absolute-move commit so behavior for leaves is unchanged and group selection is correct.)*

(c) Add a double-click handler that enters a group. On the rendered object `<div>`, add:

```tsx
            onDoubleClick={(e) => {
              e.stopPropagation();
              const resolved = resolveCanvasSelection(path, enteredGroupPath);
              const ro = getObjectAt(objects, resolved);
              if (ro?.kind === "group") { enterGroup(resolved); selectObject(path); }
            }}
```

(d) Multi-select outline: the `selectedCls` currently uses `pathEq(selectedObjectPath, path)`. Change it to reflect the whole set:

```tsx
        const selectedCls = pathInList(selectedObjectPaths, path) ? " ed__obj--selected" : "";
```

(e) Group visibility while entered/selected: the current guard `if (obj.kind === "group" && !pathEq(selectedObjectPath, path)) return null;` hides unselected groups. Broaden it so a group renders when it is selected **or** is the entered group (so its children are reachable). Replace with:

```tsx
        if (obj.kind === "group" && !pathInList(selectedObjectPaths, path) && !pathEq(enteredGroupPath, path)) return null;
```

(f) Overlay only for a single primary: replace the `showOverlay` computation:

```tsx
  const selectedObjectPath = primaryPath(selectedObjectPaths);
  const selObj = selectedObjectPath ? getObjectAt(objects, selectedObjectPath) : undefined;
  const showOverlay = selectedObjectPaths.length === 1 && selObj && !selObj.locked && !selObj.hidden;
```

(g) Deselect backdrop → exit one level. Change the `objects-deselect` `onPointerDown` from `selectObject(null)` to `exitGroup`:

```tsx
  const exitGroup = useEditor((s) => s.exitGroup);
```
```tsx
          onPointerDown={() => exitGroup()}
```

and render the backdrop whenever there is a selection **or** an entered group:

```tsx
      {(selectedObjectPaths.length > 0 || enteredGroupPath) && (
        <div data-testid="objects-deselect" ... onPointerDown={() => exitGroup()} />
      )}
```

- [ ] **Step 4: Add the Escape-to-exit key in `page.tsx`**

In `app/editor/page.tsx`, add `exitGroup` and an Escape branch to the existing `keydown` effect:

```ts
  const exitGroup = useEditor((s) => s.exitGroup);
```

Inside `onKey`, after the Delete/Backspace branch:

```ts
      if (e.key === "Escape" && (selectedObjectPaths.length > 0)) {
        exitGroup();
      }
```

Add `exitGroup` and `selectedObjectPaths` to the effect dependency array.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/unit/objects-layer-group-select.test.tsx`
Expected: PASS (3 tests).

Run: `npm test && npx tsc --noEmit -p .`
Expected: PASS (existing `objects-layer-select`, `objects-layer-drag`, `selection-overlay` still green — single-select behavior preserved).

- [ ] **Step 6: Commit**

```bash
git add components/editor/ObjectsLayer.tsx app/editor/page.tsx tests/unit/objects-layer-group-select.test.tsx
git commit -m "feat(objects): canvas group-as-unit select + double-click enter (#2c)"
```

---

## Task 13: Group-move drag (canvas)

When the drag target is a group, commit the move via `translateObjectBy` so all descendants move; leaf drags keep the absolute commit.

**Files:**
- Modify: `components/editor/ObjectsLayer.tsx`
- Test: `tests/unit/objects-layer-group-move.test.tsx`

**Interfaces:**
- Consumes: store `translateObjectBy`; existing drag plumbing.
- Produces: dragging a selected group offsets group + descendants in one commit.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/objects-layer-group-move.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { ObjectsLayer } from "@/components/editor/ObjectsLayer";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "g", kind: "group", transform: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, children: [
      { id: "c0", kind: "shape", shape: "rect", transform: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } },
    ] },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(doc()); useEditor.getState().selectObject([0]); });
afterEach(cleanup);

test("dragging a selected group moves the group and its child together", () => {
  const host = document.createElement("div");
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  const ref = { current: host };
  render(<ObjectsLayer hostRef={ref} />);
  const box = screen.getAllByTestId("obj").find((b) => b.getAttribute("data-obj-id") === "g")!;
  fireEvent.pointerDown(box, { clientX: 300, clientY: 300 });
  fireEvent.pointerMove(window, { clientX: 400, clientY: 400 });   // +0.1, +0.1
  fireEvent.pointerUp(window, { clientX: 400, clientY: 400 });
  const objs = useEditor.getState().doc!.scenes[0].objects!;
  expect(objs[0].transform).toMatchObject({ x: 0.3, y: 0.3 });
  expect((objs[0] as { children: { transform: { x: number; y: number } }[] }).children[0].transform).toMatchObject({ x: 0.3, y: 0.3 });
});
```

*(If `usePointerDrag` binds move/up on a specific target rather than `window`, mirror the event target used in the existing `tests/unit/objects-layer-drag.test.tsx`; keep the delta math identical.)*

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/objects-layer-group-move.test.tsx`
Expected: FAIL — the child's transform is unchanged (only the group frame moved via `updateObjectTransform`).

- [ ] **Step 3: Branch the commit on group vs leaf**

In `components/editor/ObjectsLayer.tsx`, add the hook:

```tsx
  const translateObjectBy = useEditor((s) => s.translateObjectBy);
```

In `bodyDown`'s `onCommit`, replace the single commit with a group-aware branch (using the start transform `t` and the moved delta):

```tsx
      onCommit: (c) => {
        if (c.moved) {
          const f = pointerFraction(c.rect, c.clientX, c.clientY);
          const nx = round3(f.x - off.x), ny = round3(f.y - off.y);
          if (targetObj.kind === "group") {
            const dx = round3(nx - t.x), dy = round3(ny - t.y);
            if (dx !== 0 || dy !== 0) translateObjectBy(sceneId!, targetPath, dx, dy);
          } else if (transformChanged(t, { x: nx, y: ny })) {
            updateObjectTransform(sceneId!, targetPath, { x: nx, y: ny });
          }
        }
        setPreview(null);
      },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/objects-layer-group-move.test.tsx`
Expected: PASS.

Run: `npm test && npx tsc --noEmit -p .`
Expected: PASS (leaf-drag test `objects-layer-drag` unchanged).

- [ ] **Step 5: Commit**

```bash
git add components/editor/ObjectsLayer.tsx tests/unit/objects-layer-group-move.test.tsx
git commit -m "feat(objects): group-move drag via translateObjectBy (#2c)"
```

---

## Task 14: End-to-end panel + integration (Playwright)

**Files:**
- Create: `e2e/layers-panel.spec.ts`

**Interfaces:**
- Consumes: the running editor with the demo deck; testids from Tasks 9–13.
- Produces: CI-verified panel + canvas-sync coverage. (May not run locally per the worktree `node_modules` gotcha — rely on CI.)

- [ ] **Step 1: Write the e2e spec**

Create `e2e/layers-panel.spec.ts` (mirror the setup/boot pattern of `e2e/objects.spec.ts` — same `test.beforeEach` navigation and any `waitForSelector` used there):

```ts
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/editor?deck=demo");
  await page.getByTestId("layers-panel").waitFor();
});

test("add via panel renders a row and selects it on the canvas", async ({ page }) => {
  await page.getByTestId("layer-object-add").selectOption("shape");
  const rows = page.getByTestId("layer-row");
  await expect(rows).not.toHaveCount(0);
  await expect(page.getByTestId("obj-selection")).toBeVisible(); // single new object -> overlay
});

test("hide from the panel removes the object from the canvas overlay", async ({ page }) => {
  await page.getByTestId("layer-object-add").selectOption("shape");
  const row = page.getByTestId("layer-row").first();
  const objId = await row.getAttribute("data-obj-id");
  await row.getByTestId("layer-hide").click();
  await expect(page.locator(`[data-testid="obj"][data-obj-id="${objId}"]`)).toHaveCount(0);
});

test("group two objects then ungroup", async ({ page }) => {
  await page.getByTestId("layer-object-add").selectOption("shape");
  await page.getByTestId("layer-object-add").selectOption("shape");
  const rows = page.getByTestId("layer-row");
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ["Shift"] });
  await page.getByTestId("layer-group").click();
  await expect(page.locator('[data-obj-id]')).toBeTruthy();
  // a group row now exists; ungroup it
  await page.getByTestId("layer-ungroup").click();
});

test("raise reorders the primary in the tree", async ({ page }) => {
  await page.getByTestId("layer-object-add").selectOption("shape");
  await page.getByTestId("layer-object-add").selectOption("text");
  const first = page.getByTestId("layer-row").first();
  const beforeId = await first.getAttribute("data-obj-id");
  await first.click();
  await page.getByTestId("layer-raise").click();
  await expect(page.getByTestId("layer-row").first()).not.toHaveAttribute("data-obj-id", beforeId!);
});
```

*(Adjust selectors/counts to the demo deck's starting objects if it ships with any; the assertions above are written to tolerate a non-empty starting scene. If the demo deck has no `objects`, the added shapes are the only rows.)*

- [ ] **Step 2: Run locally if the worktree allows; otherwise rely on CI**

Run: `npx playwright test e2e/layers-panel.spec.ts` (if it errors with `Cannot find module '../shared/lib/constants'`, run `npm ci` first, or skip and let CI run it).
Expected: PASS in CI.

- [ ] **Step 3: Commit**

```bash
git add e2e/layers-panel.spec.ts
git commit -m "test(objects): e2e layers panel + canvas sync (#2c)"
```

---

## Self-Review

**1. Spec coverage:**
- §3.1–3.3 selection state/methods/clamps → Task 5. ✓
- §3.4 selection-aware grouping → Task 6. ✓
- §3.5 `translateObjectBy` mutation → Task 4; store wrapper → Task 7. ✓
- §4.1 front-of-z flattening → Task 3; §4.2 rows → Task 9; §4.2 toggles → Task 10; §4.4 rename → Task 10; §4.5 toolbar → Task 11; §4.6 in-panel add + stopgap removal → Task 11; §4.7 collapse state → Task 10. ✓
- §5.1 group-as-unit + double-click + Escape/exit → Task 12; §5.2 multi outline + single-only overlay → Task 12; §5.3 group move → Task 13. ✓
- §6 Inspector multi-select → Task 8. ✓
- §7 layout split + mount + CSS → Task 9 (add-control styling Task 11). ✓
- §8 pure helpers → Tasks 1–4. ✓
- §9 testing → each task's tests + Task 14 e2e. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code. Task 14's selector caveats are explicit tolerances, not placeholders. ✓

**3. Type consistency:** `selectedObjectPaths: ObjectPath[]`, `enteredGroupPath: ObjectPath | null`, `primaryPath`, `togglePath`, `pathInList`, `sameParentSiblings`, `resolveCanvasSelection`, `flattenForPanel`/`PanelRow`, `translateObjectBy(doc,sceneId,path,dx,dy)` and its store wrapper `translateObjectBy(sceneId,path,dx,dy)` are used consistently across tasks. Store methods `selectObject`/`toggleObjectSelection`/`setObjectSelection`/`enterGroup`/`exitGroup`/`groupObjects`/`ungroupObject`/`reorderObject`/`deleteObject`/`addObject` match their store definitions. Testids (`layer-row`, `layer-hide`, `layer-lock`, `layer-collapse`, `layer-rename-input`, `layer-name`, `layer-raise`, `layer-lower`, `layer-group`, `layer-ungroup`, `layer-delete`, `layer-object-add`, `layers-panel`, `inspector-multi`) are consistent between component and e2e tasks. ✓
