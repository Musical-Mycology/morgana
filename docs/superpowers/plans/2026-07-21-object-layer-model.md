# Object / Layer Data Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class, persistent, scene-level object model (text/image/shape/group) to Morgana's `DeckDoc` — schema, validation, pure mutations, an object descriptor registry, and store wiring — with unit-test coverage. No UI, no engine-render changes, no action verbs.

**Architecture:** Objects live in a new optional `Scene.objects?: SceneObject[]` nested tree, painted back-to-front in depth-first document order. They are addressed by `sceneId` + an `ObjectPath` (array of child indices). All edits are pure `(doc, …) => DeckDoc` mutations that reuse the existing no-op-returns-same-reference convention, wired into the Zustand store so they inherit undo/redo + autosave. Object kinds are driven by an object descriptor registry mirroring the effect-descriptor registry.

**Tech Stack:** TypeScript, Next.js, Zustand (editor store), Vitest (unit tests). No new dependencies.

## Global Constraints

- **Additive & backward-compatible:** `DeckDoc.version` stays the literal `1`. `Scene.objects` is optional; an object-less deck is valid and byte-identical through `JSON.parse`→`JSON.stringify`. No migration.
- **Load/save stay pure:** load = `JSON.parse`, save = `JSON.stringify`. No transform step.
- **Coordinate space:** transforms are normalized `0–1` on the fixed 16:9 stage (same space as `StagePoint`). `w,h > 0`.
- **Z-order = document order:** `objects[0]` is backmost; a `group` paints its `children` in order at the group's slot. Reorder = array splice.
- **Id contract:** object `id` matches `/^[a-z0-9][a-z0-9-]*$/` and is unique **within its scene**, counting nested children.
- **Immutability:** every mutation returns a new `DeckDoc` and never mutates its input; a no-op returns the **same** `doc` reference (so `commit` records no history).
- **No action verbs, no render, no UI, no dangling-ref checks** — those are sub-projects #2/#3.
- **Path alias:** imports use `@/` for the repo root (e.g. `@/engine/deck/types`).
- **Test runner:** `npx vitest run <path>` for a single file; `npm test` runs all.

---

### Task 1: Object data-model types

**Files:**
- Modify: `engine/deck/types.ts` (add object types; add `objects?` to `Scene`)
- Test: `tests/unit/scene-objects-types.test.ts`

**Interfaces:**
- Consumes: existing `TextSize`, `TextAlign` from `engine/deck/types.ts`.
- Produces: `ObjectAnchor`, `ObjectTransform`, `ObjectBase`, `ObjectShapeKind`, `Stroke`, `TextObjectStyle`, `SceneObject`, and `Scene.objects?: SceneObject[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/scene-objects-types.test.ts`:

```ts
import { expect, test } from "vitest";
import type { DeckDoc } from "@/engine/deck-doc";
import type { SceneObject } from "@/engine/deck/types";

// A deck exercising all four object kinds incl. a nested group.
const withObjects = (): DeckDoc => ({
  version: 1,
  meta: { id: "d", title: "D" },
  scenes: [
    {
      id: "s1",
      objects: [
        { id: "bg", kind: "shape", shape: "rect", fill: "#222", transform: { x: 0, y: 0, w: 1, h: 1 } },
        { id: "logo", kind: "image", src: "logo.png", fit: "contain", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
        {
          id: "grp",
          kind: "group",
          transform: { x: 0.3, y: 0.3, w: 0.4, h: 0.3 },
          children: [
            { id: "title", kind: "text", text: "Hi", style: { size: "lg", align: "center" }, transform: { x: 0.3, y: 0.3, w: 0.4, h: 0.15 } },
          ],
        },
      ],
      beats: [{ id: "b1", timeline: [] }],
    },
  ],
});

test("SceneObject tree round-trips through JSON unchanged", () => {
  const doc = withObjects();
  const round = JSON.parse(JSON.stringify(doc)) as DeckDoc;
  expect(round).toEqual(doc);
  // Depth-first document order is preserved (bg=backmost … grp=topmost).
  expect(round.scenes[0].objects!.map((o: SceneObject) => o.id)).toEqual(["bg", "logo", "grp"]);
});

test("a legacy object-less deck round-trips byte-identical", () => {
  const legacy: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s1", beats: [{ id: "b1", timeline: [] }] }] };
  expect(JSON.stringify(JSON.parse(JSON.stringify(legacy)))).toBe(JSON.stringify(legacy));
  expect("objects" in legacy.scenes[0]).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene-objects-types.test.ts`
Expected: FAIL — TypeScript error, `SceneObject` is not exported from `@/engine/deck/types` (and `Scene` has no `objects`).

- [ ] **Step 3: Add the types**

In `engine/deck/types.ts`, add this block immediately **above** the `Beat` interface (near the `StagePoint` definition, so object types sit with the stage-geometry types):

```ts
/** Rotation/scale origin for an object's transform. */
export type ObjectAnchor = "center" | "top-left";

/** An object's placement on the fixed 16:9 stage, normalized 0–1 (same space as StagePoint). */
export interface ObjectTransform {
  x: number; y: number;   // top-left, 0–1 fraction of stage
  w: number; h: number;   // size, 0–1 fraction of stage (w,h > 0)
  rot?: number;           // degrees clockwise, default 0
  anchor?: ObjectAnchor;  // rotation/scale origin, default "center"
}

/** Fields shared by every first-class object kind. */
export interface ObjectBase {
  id: string;             // unique within its Scene (including nested children)
  name?: string;          // author-facing label shown in the layers panel
  transform: ObjectTransform;
  opacity?: number;       // 0–1, default 1
  hidden?: boolean;       // author-time editor hide (does NOT affect playback); persisted
  locked?: boolean;       // author-time editor lock; persisted
}

export type ObjectShapeKind = "rect" | "ellipse" | "line";

/** Stroke for a shape object. `width` is a fraction of stage height. */
export interface Stroke { color: string; width: number }

/** Text styling for a text object — reuses the engine's existing text vocabulary. */
export interface TextObjectStyle {
  size?: TextSize;
  align?: TextAlign;
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

/** A persistent, scene-level, directly-manipulable object. Referenced by id from timeline
 *  actions in sub-project #3. Declared on `Scene.objects`, painted back-to-front in
 *  depth-first document order (index 0 = backmost). */
export type SceneObject =
  | (ObjectBase & { kind: "text"; text: string; style?: TextObjectStyle })
  | (ObjectBase & { kind: "image"; src: string; fit?: "contain" | "cover"; round?: boolean })
  | (ObjectBase & { kind: "shape"; shape: ObjectShapeKind; fill?: string; stroke?: Stroke; radius?: number })
  | (ObjectBase & { kind: "group"; children: SceneObject[] });
```

Then add the `objects` field to the existing `Scene` interface:

```ts
export interface Scene {
  id: string;
  /** Applies one visual treatment to every beat in this scene (investor deck). Omit for /story. */
  treatment?: SlideTreatment;
  /** First-class persistent objects, painted back-to-front in depth-first order.
   *  Optional & additive: object-less decks are unchanged. (Sub-project #1.) */
  objects?: SceneObject[];
  beats: Beat[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scene-objects-types.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/deck/types.ts tests/unit/scene-objects-types.test.ts
git commit -m "feat(schema): add SceneObject types + Scene.objects field"
```

---

### Task 2: Validation of `Scene.objects`

**Files:**
- Modify: `engine/deck-doc.ts` (extend `validateDeckDoc`)
- Test: `tests/unit/deck-doc-objects.test.ts`

**Interfaces:**
- Consumes: `ID_RE` (already in `deck-doc.ts`), `SceneObject` shape from Task 1.
- Produces: extended `validateDeckDoc` behavior; a module-local `validateSceneObjects` (not exported) and exported `MAX_OBJECT_DEPTH` constant.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/deck-doc-objects.test.ts`:

```ts
import { expect, test } from "vitest";
import { validateDeckDoc, MAX_OBJECT_DEPTH, type DeckDoc } from "@/engine/deck-doc";

const withObjects = (objects: unknown): DeckDoc =>
  ({ version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s1", objects, beats: [] }] } as unknown as DeckDoc);

test("accepts a scene with valid objects incl. a nested group", () => {
  const doc = withObjects([
    { id: "bg", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 1, h: 1 } },
    { id: "grp", kind: "group", transform: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, children: [
      { id: "title", kind: "text", text: "Hi", transform: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 } },
    ] },
  ]);
  expect(validateDeckDoc(doc)).toEqual({ ok: true, errors: [] });
});

test("an object-less scene is still valid", () => {
  expect(validateDeckDoc({ version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s1", beats: [] }] }).ok).toBe(true);
});

test("rejects duplicate ids within a scene, including a nested collision", () => {
  const doc = withObjects([
    { id: "dup", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 1, h: 1 } },
    { id: "grp", kind: "group", transform: { x: 0, y: 0, w: 1, h: 1 }, children: [
      { id: "dup", kind: "text", text: "x", transform: { x: 0, y: 0, w: 1, h: 1 } },
    ] },
  ]);
  expect(validateDeckDoc(doc).ok).toBe(false);
});

test("rejects bad kind, non-finite/non-positive transform, and out-of-range opacity", () => {
  expect(validateDeckDoc(withObjects([{ id: "a", kind: "blob", transform: { x: 0, y: 0, w: 1, h: 1 } }])).ok).toBe(false);
  expect(validateDeckDoc(withObjects([{ id: "a", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 0, h: 1 } }])).ok).toBe(false);
  expect(validateDeckDoc(withObjects([{ id: "a", kind: "shape", shape: "rect", transform: { x: NaN, y: 0, w: 1, h: 1 } }])).ok).toBe(false);
  expect(validateDeckDoc(withObjects([{ id: "a", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 1, h: 1 }, opacity: 2 }])).ok).toBe(false);
});

test("rejects nesting deeper than MAX_OBJECT_DEPTH", () => {
  let node: any = { id: "leaf", kind: "text", text: "x", transform: { x: 0, y: 0, w: 1, h: 1 } };
  for (let i = 0; i < MAX_OBJECT_DEPTH + 1; i++) {
    node = { id: `g${i}`, kind: "group", transform: { x: 0, y: 0, w: 1, h: 1 }, children: [node] };
  }
  expect(validateDeckDoc(withObjects([node])).ok).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/deck-doc-objects.test.ts`
Expected: FAIL — `MAX_OBJECT_DEPTH` is not exported and objects aren't validated (valid-looking bad objects pass).

- [ ] **Step 3: Extend the validator**

In `engine/deck-doc.ts`, add after the `ID_RE` constant (line 27):

```ts
export const MAX_OBJECT_DEPTH = 8;
const OBJECT_KINDS = new Set(["text", "image", "shape", "group"]);

/** Structural validation of a scene's object tree. Scene-scoped id uniqueness via `seen`. */
function validateSceneObjects(objects: unknown, label: string, seen: Set<string>, depth: number, e: string[]): void {
  if (objects === undefined) return;
  if (!Array.isArray(objects)) { e.push(`${label}.objects must be an array`); return; }
  if (depth > MAX_OBJECT_DEPTH) { e.push(`${label} nested deeper than ${MAX_OBJECT_DEPTH}`); return; }
  objects.forEach((o: Record<string, unknown>, i) => {
    const at = `${label}.objects[${i}]`;
    if (!o || typeof o !== "object") { e.push(`${at} must be an object`); return; }
    if (typeof o.id !== "string" || !ID_RE.test(o.id)) e.push(`${at}.id must match ${String(ID_RE)}`);
    else if (seen.has(o.id)) e.push(`${at}.id "${o.id}" duplicated in scene`);
    else seen.add(o.id);
    if (typeof o.kind !== "string" || !OBJECT_KINDS.has(o.kind)) e.push(`${at}.kind invalid`);
    const t = o.transform as Record<string, unknown> | undefined;
    if (!t || typeof t !== "object") e.push(`${at}.transform missing`);
    else {
      for (const k of ["x", "y", "w", "h"] as const) {
        if (typeof t[k] !== "number" || !Number.isFinite(t[k])) e.push(`${at}.transform.${k} must be a finite number`);
      }
      if (typeof t.w === "number" && t.w <= 0) e.push(`${at}.transform.w must be > 0`);
      if (typeof t.h === "number" && t.h <= 0) e.push(`${at}.transform.h must be > 0`);
    }
    if (o.opacity !== undefined && (typeof o.opacity !== "number" || o.opacity < 0 || o.opacity > 1)) e.push(`${at}.opacity must be 0–1`);
    if (o.kind === "group") validateSceneObjects(o.children, at, seen, depth + 1, e);
  });
}
```

Then, inside `validateDeckDoc`'s scene loop, add the object check. Change the existing `forEach` body:

```ts
  else d.scenes.forEach((s: Scene, i) => {
    if (!s || typeof s.id !== "string") e.push(`scenes[${i}].id required`);
    if (!Array.isArray(s?.beats)) e.push(`scenes[${i}].beats must be an array`);
    validateSceneObjects(s?.objects, `scenes[${i}]`, new Set<string>(), 1, e);
  });
```

(A **fresh** `Set` per scene → uniqueness is scene-scoped; `depth: 1` for the root list.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/deck-doc-objects.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the existing deck-doc test to confirm no regression**

Run: `npx vitest run tests/unit/deck-doc.test.ts`
Expected: PASS (unchanged).

- [ ] **Step 6: Commit**

```bash
git add engine/deck-doc.ts tests/unit/deck-doc-objects.test.ts
git commit -m "feat(schema): validate Scene.objects (kinds, transform, ids, depth)"
```

---

### Task 3: Object tree helpers + `uniqueObjectId`

**Files:**
- Create: `lib/editor/object-tree.ts`
- Test: `tests/unit/object-tree.test.ts`

**Interfaces:**
- Consumes: `SceneObject` (Task 1), `DeckDoc`.
- Produces:
  - `type ObjectPath = number[]`
  - `getObjectAt(objects: SceneObject[], path: ObjectPath): SceneObject | undefined`
  - `getObjectListAt(objects: SceneObject[], parentPath: ObjectPath): SceneObject[] | undefined`
  - `mapChildList(objects: SceneObject[], parentPath: ObjectPath, f: (list: SceneObject[]) => SceneObject[]): SceneObject[]`
  - `collectObjectIds(objects: SceneObject[] | undefined): string[]`
  - `uniqueObjectId(doc: DeckDoc, sceneId: string): string`
  - `isPrefix(prefix: ObjectPath, path: ObjectPath): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/object-tree.test.ts`:

```ts
import { expect, test } from "vitest";
import { getObjectAt, getObjectListAt, mapChildList, collectObjectIds, uniqueObjectId, isPrefix } from "@/lib/editor/object-tree";
import type { SceneObject } from "@/engine/deck/types";
import type { DeckDoc } from "@/engine/deck-doc";

const tree = (): SceneObject[] => [
  { id: "a", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 1, h: 1 } },
  { id: "g", kind: "group", transform: { x: 0, y: 0, w: 1, h: 1 }, children: [
    { id: "b", kind: "text", text: "b", transform: { x: 0, y: 0, w: 1, h: 1 } },
    { id: "c", kind: "text", text: "c", transform: { x: 0, y: 0, w: 1, h: 1 } },
  ] },
];

test("getObjectAt resolves root and nested paths", () => {
  expect(getObjectAt(tree(), [0])!.id).toBe("a");
  expect(getObjectAt(tree(), [1, 1])!.id).toBe("c");
  expect(getObjectAt(tree(), [1, 9])).toBeUndefined();
  expect(getObjectAt(tree(), [0, 0])).toBeUndefined(); // "a" is not a group
});

test("getObjectListAt returns the sibling list for a parent path", () => {
  expect(getObjectListAt(tree(), []).map((o) => o.id)).toEqual(["a", "g"]);
  expect(getObjectListAt(tree(), [1]).map((o) => o.id)).toEqual(["b", "c"]);
});

test("mapChildList transforms a list immutably without touching the input", () => {
  const input = tree();
  const out = mapChildList(input, [1], (list) => list.slice().reverse());
  expect((out[1] as any).children.map((o: SceneObject) => o.id)).toEqual(["c", "b"]);
  expect((input[1] as any).children.map((o: SceneObject) => o.id)).toEqual(["b", "c"]); // unchanged
});

test("collectObjectIds gathers ids depth-first", () => {
  expect(collectObjectIds(tree())).toEqual(["a", "g", "b", "c"]);
  expect(collectObjectIds(undefined)).toEqual([]);
});

test("uniqueObjectId returns the smallest free o-N in the scene", () => {
  const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "s1", objects: [{ id: "o-1", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 1, h: 1 } }], beats: [] },
  ] };
  expect(uniqueObjectId(doc, "s1")).toBe("o-2");
  expect(uniqueObjectId(doc, "missing")).toBe("o-1");
});

test("isPrefix detects ancestor paths", () => {
  expect(isPrefix([1], [1, 0])).toBe(true);
  expect(isPrefix([1], [1])).toBe(true);
  expect(isPrefix([1, 0], [1])).toBe(false);
  expect(isPrefix([0], [1, 0])).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/object-tree.test.ts`
Expected: FAIL — module `@/lib/editor/object-tree` not found.

- [ ] **Step 3: Implement the helpers**

Create `lib/editor/object-tree.ts`:

```ts
import type { DeckDoc } from "@/engine/deck-doc";
import type { SceneObject } from "@/engine/deck/types";

/** A path from a scene's root `objects` array, descending through group `children`.
 *  `[2]` = third root object; `[2,0]` = first child of that group. */
export type ObjectPath = number[];

/** Resolve the object at `path`, or undefined if any segment is missing / not a group. */
export function getObjectAt(objects: SceneObject[], path: ObjectPath): SceneObject | undefined {
  if (path.length === 0) return undefined;
  const [head, ...rest] = path;
  const node = objects[head];
  if (!node) return undefined;
  if (rest.length === 0) return node;
  if (node.kind !== "group") return undefined;
  return getObjectAt(node.children, rest);
}

/** The sibling list at `parentPath` (`[]` = root), or undefined if the parent isn't a group. */
export function getObjectListAt(objects: SceneObject[], parentPath: ObjectPath): SceneObject[] | undefined {
  if (parentPath.length === 0) return objects;
  const node = getObjectAt(objects, parentPath);
  return node && node.kind === "group" ? node.children : undefined;
}

/** Immutably transform the sibling list at `parentPath`. Returns a new tree; input untouched. */
export function mapChildList(objects: SceneObject[], parentPath: ObjectPath, f: (list: SceneObject[]) => SceneObject[]): SceneObject[] {
  if (parentPath.length === 0) return f(objects);
  const [head, ...rest] = parentPath;
  return objects.map((o, i) => {
    if (i !== head || o.kind !== "group") return o;
    return { ...o, children: mapChildList(o.children, rest, f) };
  });
}

/** All ids in the tree, depth-first (parent before its children). */
export function collectObjectIds(objects: SceneObject[] | undefined): string[] {
  const ids: string[] = [];
  const walk = (list: SceneObject[]) => list.forEach((o) => { ids.push(o.id); if (o.kind === "group") walk(o.children); });
  if (objects) walk(objects);
  return ids;
}

/** Smallest free `o-N` id within the named scene (mirrors uniqueBeatId's namespace scan). */
export function uniqueObjectId(doc: DeckDoc, sceneId: string): string {
  const scene = doc.scenes.find((s) => s.id === sceneId);
  const used = new Set(collectObjectIds(scene?.objects));
  for (let n = 1; ; n++) { const id = `o-${n}`; if (!used.has(id)) return id; }
}

/** True if `prefix` is an ancestor of (or equal to) `path`. Guards against moving a group into itself. */
export function isPrefix(prefix: ObjectPath, path: ObjectPath): boolean {
  if (prefix.length > path.length) return false;
  return prefix.every((v, i) => v === path[i]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/object-tree.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/editor/object-tree.ts tests/unit/object-tree.test.ts
git commit -m "feat(objects): tree navigation helpers + uniqueObjectId"
```

---

### Task 4: Object descriptor registry

**Files:**
- Create: `lib/editor/object-registry.ts`
- Test: `tests/unit/object-registry.test.ts`

**Interfaces:**
- Consumes: `Field` type from `lib/editor/registry.ts`; `getPath` from `lib/editor/paths.ts`; `SceneObject` (Task 1); `validateDeckDoc` (Task 2).
- Produces:
  - `interface ObjectDescriptor { kind: SceneObject["kind"]; label: string; icon: string; schema: Field[]; defaults(): SceneObject; }`
  - `OBJECT_REGISTRY: Record<SceneObject["kind"], ObjectDescriptor>`
  - `descriptorForObject(o: Pick<SceneObject, "kind">): ObjectDescriptor`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/object-registry.test.ts`:

```ts
import { expect, test } from "vitest";
import { OBJECT_REGISTRY, descriptorForObject } from "@/lib/editor/object-registry";
import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";
import { getPath } from "@/lib/editor/paths";

const KINDS = ["text", "image", "shape", "group"] as const;

test("every kind has a descriptor whose defaults() validates inside a scene", () => {
  for (const kind of KINDS) {
    const obj = descriptorForObject({ kind }).defaults();
    expect(obj.kind).toBe(kind);
    const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s1", objects: [obj], beats: [] }] };
    expect(validateDeckDoc(doc)).toEqual({ ok: true, errors: [] });
  }
});

test("transform schema keys resolve to finite numbers on each default", () => {
  for (const kind of KINDS) {
    const obj = descriptorForObject({ kind }).defaults();
    for (const key of ["transform.x", "transform.y", "transform.w", "transform.h"]) {
      expect(Number.isFinite(getPath(obj, key) as number)).toBe(true);
    }
  }
});

test("kind-specific defaults carry their required fields", () => {
  expect((descriptorForObject({ kind: "text" }).defaults() as any).text).toBeTypeOf("string");
  expect((descriptorForObject({ kind: "image" }).defaults() as any).src).toBeTypeOf("string");
  expect((descriptorForObject({ kind: "shape" }).defaults() as any).shape).toBeTypeOf("string");
  expect((descriptorForObject({ kind: "group" }).defaults() as any).children).toEqual([]);
});

test("OBJECT_REGISTRY covers exactly the four kinds", () => {
  expect(Object.keys(OBJECT_REGISTRY).sort()).toEqual(["group", "image", "shape", "text"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/object-registry.test.ts`
Expected: FAIL — module `@/lib/editor/object-registry` not found.

- [ ] **Step 3: Implement the registry**

Create `lib/editor/object-registry.ts`:

```ts
import type { Field } from "./registry";
import type { SceneObject } from "@/engine/deck/types";

export interface ObjectDescriptor {
  kind: SceneObject["kind"];
  label: string;
  icon: string;
  schema: Field[];
  defaults(): SceneObject;
}

const opts = (...vs: string[]) => vs.map((v) => ({ value: v, label: v }));
/** Sensible centered starting box. */
const box = () => ({ x: 0.35, y: 0.4, w: 0.3, h: 0.2, rot: 0, anchor: "center" as const });

const TRANSFORM_FIELDS: Field[] = [
  { key: "transform.x", label: "X", type: "number", min: 0, max: 1, step: 0.01 },
  { key: "transform.y", label: "Y", type: "number", min: 0, max: 1, step: 0.01 },
  { key: "transform.w", label: "Width", type: "number", min: 0.01, max: 1, step: 0.01 },
  { key: "transform.h", label: "Height", type: "number", min: 0.01, max: 1, step: 0.01 },
  { key: "transform.rot", label: "Rotation°", type: "number", step: 1 },
  { key: "opacity", label: "Opacity", type: "range", min: 0, max: 1, step: 0.05 },
];

export const OBJECT_REGISTRY: Record<SceneObject["kind"], ObjectDescriptor> = {
  text: {
    kind: "text", label: "Text", icon: "ti-text-caption",
    schema: [
      { key: "text", label: "Text", type: "textarea" },
      { key: "style.size", label: "Size", type: "select", options: opts("lg", "md", "sm") },
      { key: "style.align", label: "Align", type: "select", options: opts("left", "center", "right") },
      { key: "style.color", label: "Color", type: "text" },
      { key: "style.bold", label: "Bold", type: "checkbox" },
      { key: "style.italic", label: "Italic", type: "checkbox" },
      ...TRANSFORM_FIELDS,
    ],
    defaults: () => ({ id: "o-1", kind: "text", text: "Text", style: { size: "md", align: "center" }, transform: box() }),
  },
  image: {
    kind: "image", label: "Image", icon: "ti-photo",
    schema: [
      { key: "src", label: "Source", type: "text" },
      { key: "fit", label: "Fit", type: "select", options: opts("contain", "cover") },
      { key: "round", label: "Round", type: "checkbox" },
      ...TRANSFORM_FIELDS,
    ],
    defaults: () => ({ id: "o-1", kind: "image", src: "", fit: "contain", transform: box() }),
  },
  shape: {
    kind: "shape", label: "Shape", icon: "ti-square",
    schema: [
      { key: "shape", label: "Shape", type: "select", options: opts("rect", "ellipse", "line") },
      { key: "fill", label: "Fill", type: "text" },
      { key: "stroke.color", label: "Stroke color", type: "text" },
      { key: "stroke.width", label: "Stroke width", type: "number", min: 0, max: 0.1, step: 0.001 },
      { key: "radius", label: "Corner radius", type: "number", min: 0, max: 0.5, step: 0.01 },
      ...TRANSFORM_FIELDS,
    ],
    defaults: () => ({ id: "o-1", kind: "shape", shape: "rect", fill: "#4444aa", transform: box() }),
  },
  group: {
    kind: "group", label: "Group", icon: "ti-box-multiple",
    schema: [...TRANSFORM_FIELDS],
    defaults: () => ({ id: "o-1", kind: "group", children: [], transform: box() }),
  },
};

/** Look up an object kind's descriptor. Total over the four kinds. */
export function descriptorForObject(o: Pick<SceneObject, "kind">): ObjectDescriptor {
  return OBJECT_REGISTRY[o.kind];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/object-registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/editor/object-registry.ts tests/unit/object-registry.test.ts
git commit -m "feat(objects): object descriptor registry (text/image/shape/group)"
```

---

### Task 5: Object mutations — add / update / delete / reorder

**Files:**
- Create: `lib/editor/object-mutations.ts`
- Test: `tests/unit/object-mutations.test.ts`

**Interfaces:**
- Consumes: `DeckDoc`; `SceneObject` (Task 1); `ObjectPath`, `getObjectAt`, `getObjectListAt`, `mapChildList` (Task 3); `setPath` from `lib/editor/paths.ts`.
- Produces (all pure `… => DeckDoc`, no-op returns the **same** doc reference):
  - `addObject(doc: DeckDoc, sceneId: string, object: SceneObject, parentPath?: ObjectPath, index?: number): DeckDoc`
  - `updateObject(doc: DeckDoc, sceneId: string, path: ObjectPath, fieldKey: string, value: unknown): DeckDoc`
  - `deleteObject(doc: DeckDoc, sceneId: string, path: ObjectPath): DeckDoc`
  - `reorderObject(doc: DeckDoc, sceneId: string, path: ObjectPath, dir: -1 | 1): DeckDoc`
  - Internal helper `mapSceneObjects(doc, sceneId, f)` (not exported).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/object-mutations.test.ts`:

```ts
import { expect, test } from "vitest";
import { addObject, updateObject, deleteObject, reorderObject } from "@/lib/editor/object-mutations";
import type { DeckDoc } from "@/engine/deck-doc";
import type { SceneObject } from "@/engine/deck/types";

const obj = (id: string): SceneObject => ({ id, kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 1, h: 1 } });
const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [obj("a"), obj("b")], beats: [] },
  { id: "s2", beats: [] },
] });

test("addObject appends to the scene's root list (top of z) by default", () => {
  const d = addObject(base(), "s1", obj("c"));
  expect(d.scenes[0].objects!.map((o) => o.id)).toEqual(["a", "b", "c"]);
});

test("addObject can insert into a group at an index", () => {
  let d = addObject(base(), "s1", { id: "g", kind: "group", transform: { x: 0, y: 0, w: 1, h: 1 }, children: [] });
  d = addObject(d, "s1", obj("child"), [2], 0); // [2] = the new group
  expect((d.scenes[0].objects![2] as any).children.map((o: SceneObject) => o.id)).toEqual(["child"]);
});

test("addObject on an unknown scene is a no-op (same reference)", () => {
  const b = base();
  expect(addObject(b, "nope", obj("c"))).toBe(b);
});

test("updateObject sets a nested field via dot path", () => {
  const d = updateObject(base(), "s1", [1], "transform.x", 0.25);
  expect(d.scenes[0].objects![1].transform.x).toBe(0.25);
  expect(base().scenes[0].objects![1].transform.x).toBe(0); // input untouched
});

test("updateObject on a missing path is a no-op", () => {
  const b = base();
  expect(updateObject(b, "s1", [9], "transform.x", 0.5)).toBe(b);
});

test("deleteObject removes the targeted node", () => {
  const d = deleteObject(base(), "s1", [0]);
  expect(d.scenes[0].objects!.map((o) => o.id)).toEqual(["b"]);
});

test("reorderObject swaps within the sibling list; boundary is a no-op", () => {
  const up = reorderObject(base(), "s1", [0], 1);
  expect(up.scenes[0].objects!.map((o) => o.id)).toEqual(["b", "a"]);
  const b = base();
  expect(reorderObject(b, "s1", [0], -1)).toBe(b); // already backmost
  expect(reorderObject(b, "s1", [1], 1)).toBe(b);  // already topmost
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/object-mutations.test.ts`
Expected: FAIL — module `@/lib/editor/object-mutations` not found.

- [ ] **Step 3: Implement the mutations**

Create `lib/editor/object-mutations.ts`:

```ts
import type { DeckDoc } from "@/engine/deck-doc";
import type { Scene, SceneObject } from "@/engine/deck/types";
import { setPath } from "./paths";
import { getObjectAt, getObjectListAt, mapChildList, type ObjectPath } from "./object-tree";

/** Apply `f` to the objects tree of the named scene. If `f` returns the same array
 *  reference (a no-op), the whole doc is returned unchanged. Unknown scene → no-op. */
function mapSceneObjects(doc: DeckDoc, sceneId: string, f: (objects: SceneObject[]) => SceneObject[]): DeckDoc {
  const idx = doc.scenes.findIndex((s) => s.id === sceneId);
  if (idx < 0) return doc;
  const scene = doc.scenes[idx];
  const objects = scene.objects ?? [];
  const next = f(objects);
  if (next === objects) return doc;
  const nextScene: Scene = { ...scene, objects: next };
  return { ...doc, scenes: doc.scenes.map((s, i) => (i === idx ? nextScene : s)) };
}

/** Insert `object` into the sibling list at `parentPath` (default root), at `index`
 *  (default: end of the list = top of z). Unknown parent → no-op. */
export function addObject(doc: DeckDoc, sceneId: string, object: SceneObject, parentPath: ObjectPath = [], index?: number): DeckDoc {
  return mapSceneObjects(doc, sceneId, (objects) => {
    if (getObjectListAt(objects, parentPath) === undefined) return objects; // bad parent
    return mapChildList(objects, parentPath, (list) => {
      const at = index == null ? list.length : Math.max(0, Math.min(index, list.length));
      return [...list.slice(0, at), object, ...list.slice(at)];
    });
  });
}

/** Set a dotted field (`transform.x`, `style.size`, …) on the object at `path`. Missing path → no-op. */
export function updateObject(doc: DeckDoc, sceneId: string, path: ObjectPath, fieldKey: string, value: unknown): DeckDoc {
  return mapSceneObjects(doc, sceneId, (objects) => {
    if (!getObjectAt(objects, path)) return objects;
    const parent = path.slice(0, -1);
    const idx = path[path.length - 1];
    return mapChildList(objects, parent, (list) =>
      list.map((o, i) => (i === idx ? setPath(o, fieldKey, value) : o)));
  });
}

/** Remove the object (and, for a group, its subtree) at `path`. Missing path → no-op. */
export function deleteObject(doc: DeckDoc, sceneId: string, path: ObjectPath): DeckDoc {
  return mapSceneObjects(doc, sceneId, (objects) => {
    if (!getObjectAt(objects, path)) return objects;
    const parent = path.slice(0, -1);
    const idx = path[path.length - 1];
    return mapChildList(objects, parent, (list) => list.filter((_, i) => i !== idx));
  });
}

/** Swap the object at `path` with its neighbour in the sibling list. Boundary → no-op. */
export function reorderObject(doc: DeckDoc, sceneId: string, path: ObjectPath, dir: -1 | 1): DeckDoc {
  const parent = path.slice(0, -1);
  const idx = path[path.length - 1];
  const target = idx + dir;
  return mapSceneObjects(doc, sceneId, (objects) => {
    const list = getObjectListAt(objects, parent);
    if (!list || target < 0 || target >= list.length) return objects;
    return mapChildList(objects, parent, (l) => {
      const next = l.slice();
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/object-mutations.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/editor/object-mutations.ts tests/unit/object-mutations.test.ts
git commit -m "feat(objects): add/update/delete/reorder mutations"
```

---

### Task 6: Object mutations — group / ungroup / reparent

**Files:**
- Modify: `lib/editor/object-mutations.ts`
- Test: `tests/unit/object-group-mutations.test.ts`

**Interfaces:**
- Consumes: everything from Task 5; `isPrefix` (Task 3); `ObjectTransform` (Task 1).
- Produces (appended to `object-mutations.ts`):
  - `groupObjects(doc: DeckDoc, sceneId: string, paths: ObjectPath[], groupId: string): DeckDoc`
  - `ungroupObject(doc: DeckDoc, sceneId: string, path: ObjectPath): DeckDoc`
  - `reparentObject(doc: DeckDoc, sceneId: string, from: ObjectPath, toParent: ObjectPath, toIndex: number): DeckDoc`
  - Internal helper `unionTransform(children: SceneObject[]): ObjectTransform`.

**Design notes (locked in the spec):** In #1 a group's `transform` is a **descriptive bounding box** (the union of its children's boxes); it does **not** re-base child coordinates — children keep absolute stage coords. `groupObjects` requires all selected paths to share one parent. `reparentObject` refuses to move a group into its own subtree.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/object-group-mutations.test.ts`:

```ts
import { expect, test } from "vitest";
import { groupObjects, ungroupObject, reparentObject } from "@/lib/editor/object-mutations";
import type { DeckDoc } from "@/engine/deck-doc";
import type { SceneObject } from "@/engine/deck/types";

const at = (id: string, x: number, y: number, w = 0.2, h = 0.2): SceneObject =>
  ({ id, kind: "shape", shape: "rect", transform: { x, y, w, h } });
const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [at("a", 0.1, 0.1), at("b", 0.5, 0.5), at("c", 0.8, 0.0)], beats: [] },
] });

test("groupObjects wraps same-parent siblings into a new group at the topmost slot", () => {
  const d = groupObjects(base(), "s1", [[0], [2]], "grp");
  const ids = d.scenes[0].objects!.map((o) => o.id);
  expect(ids).toEqual(["grp", "b"]);              // group takes index 0 (topmost selected was [0])
  const grp = d.scenes[0].objects![0] as any;
  expect(grp.kind).toBe("group");
  expect(grp.children.map((o: SceneObject) => o.id)).toEqual(["a", "c"]); // original order preserved
  // union bbox spans a(0.1,0.1,0.2,0.2) + c(0.8,0.0,0.2,0.2) → x0.1 y0.0 w0.9 h0.3
  expect(grp.transform.x).toBeCloseTo(0.1); expect(grp.transform.y).toBeCloseTo(0.0);
  expect(grp.transform.w).toBeCloseTo(0.9); expect(grp.transform.h).toBeCloseTo(0.3);
});

test("groupObjects with paths under different parents is a no-op", () => {
  let d = groupObjects(base(), "s1", [[0], [1]], "g1");   // group a,b first
  const b = d;
  // now try to group a root object [1] with a nested one [0,0] → different parents
  expect(groupObjects(b, "s1", [[1], [0, 0]], "g2")).toBe(b);
});

test("ungroupObject splices a group's children back into the parent at its slot", () => {
  const grouped = groupObjects(base(), "s1", [[0], [1]], "grp"); // → [grp(a,b), c]
  const d = ungroupObject(grouped, "s1", [0]);
  expect(d.scenes[0].objects!.map((o) => o.id)).toEqual(["a", "b", "c"]);
});

test("ungroupObject on a non-group is a no-op", () => {
  const b = base();
  expect(ungroupObject(b, "s1", [0])).toBe(b);
});

test("reparentObject moves a node into a group", () => {
  const grouped = groupObjects(base(), "s1", [[0]], "grp"); // → [grp(a), b, c]
  const d = reparentObject(grouped, "s1", [1], [0], 0);     // move b into grp at index 0
  const grp = d.scenes[0].objects![0] as any;
  expect(grp.children.map((o: SceneObject) => o.id)).toEqual(["b", "a"]);
  expect(d.scenes[0].objects!.map((o) => o.id)).toEqual(["grp", "c"]);
});

test("reparentObject refuses to move a group into its own subtree", () => {
  const grouped = groupObjects(base(), "s1", [[0]], "grp"); // grp at [0], its child a at [0,0]
  const b = grouped;
  expect(reparentObject(b, "s1", [0], [0, 0], 0)).toBe(b);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/object-group-mutations.test.ts`
Expected: FAIL — `groupObjects`/`ungroupObject`/`reparentObject` are not exported.

- [ ] **Step 3: Implement group/ungroup/reparent**

Append to `lib/editor/object-mutations.ts`. First extend the imports at the top:

```ts
import type { ObjectTransform, Scene, SceneObject } from "@/engine/deck/types";
import { getObjectAt, getObjectListAt, mapChildList, isPrefix, type ObjectPath } from "./object-tree";
```

(Replace the two existing import lines from Task 5 with these — they add `ObjectTransform` and `isPrefix`.)

Then append:

```ts
/** Bounding box (union) of the children's boxes — a group's descriptive transform in #1.
 *  Rotation is ignored (uses each child's x/y/w/h). Empty → full stage. */
function unionTransform(children: SceneObject[]): ObjectTransform {
  if (children.length === 0) return { x: 0, y: 0, w: 1, h: 1, rot: 0, anchor: "center" };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of children) {
    const t = c.transform;
    x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y);
    x1 = Math.max(x1, t.x + t.w); y1 = Math.max(y1, t.y + t.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, rot: 0, anchor: "center" };
}

/** Wrap the selected same-parent siblings into a new group at the topmost selected slot.
 *  Children keep their original order and absolute coords. Requires ≥1 path, all sharing
 *  one parent; otherwise a no-op. */
export function groupObjects(doc: DeckDoc, sceneId: string, paths: ObjectPath[], groupId: string): DeckDoc {
  if (paths.length === 0) return doc;
  const parent = paths[0].slice(0, -1);
  const sameParent = paths.every((p) => p.length === paths[0].length && isPrefix(parent, p) && p.slice(0, -1).every((v, i) => v === parent[i]));
  if (!sameParent) return doc;
  const idxs = paths.map((p) => p[p.length - 1]).sort((a, b) => a - b);
  const insertAt = idxs[0];
  return mapSceneObjects(doc, sceneId, (objects) => {
    const list = getObjectListAt(objects, parent);
    if (!list || idxs.some((i) => i < 0 || i >= list.length)) return objects;
    const picked = idxs.map((i) => list[i]);
    const group: SceneObject = { id: groupId, kind: "group", transform: unionTransform(picked), children: picked };
    return mapChildList(objects, parent, (l) => {
      const remaining = l.filter((_, i) => !idxs.includes(i));
      const at = Math.min(insertAt, remaining.length);
      return [...remaining.slice(0, at), group, ...remaining.slice(at)];
    });
  });
}

/** Splice a group's children into its parent at the group's slot, dropping the group. Non-group → no-op. */
export function ungroupObject(doc: DeckDoc, sceneId: string, path: ObjectPath): DeckDoc {
  const node = doc.scenes.find((s) => s.id === sceneId)?.objects;
  const target = node ? getObjectAt(node, path) : undefined;
  if (!target || target.kind !== "group") return doc;
  const parent = path.slice(0, -1);
  const idx = path[path.length - 1];
  const kids = target.children;
  return mapSceneObjects(doc, sceneId, (objects) =>
    mapChildList(objects, parent, (l) => [...l.slice(0, idx), ...kids, ...l.slice(idx + 1)]));
}

/** Move the node at `from` into the list at `toParent`, at `toIndex`. Refuses to move a group
 *  into its own subtree; unknown source/target → no-op. */
export function reparentObject(doc: DeckDoc, sceneId: string, from: ObjectPath, toParent: ObjectPath, toIndex: number): DeckDoc {
  if (isPrefix(from, toParent)) return doc; // can't move a node into itself/its descendants
  const objects = doc.scenes.find((s) => s.id === sceneId)?.objects;
  if (!objects) return doc;
  const node = getObjectAt(objects, from);
  if (!node || getObjectListAt(objects, toParent) === undefined) return doc;

  const fromParent = from.slice(0, -1);
  const fromIdx = from[from.length - 1];
  const sameList = fromParent.length === toParent.length && fromParent.every((v, i) => v === toParent[i]);

  return mapSceneObjects(doc, sceneId, (objs) => {
    // 1) remove from source
    let next = mapChildList(objs, fromParent, (l) => l.filter((_, i) => i !== fromIdx));
    // 2) adjust the target index if the removal shifted it (same list, target after source)
    const adjIndex = sameList && toIndex > fromIdx ? toIndex - 1 : toIndex;
    // 3) insert into target
    next = mapChildList(next, toParent, (l) => {
      const at = Math.max(0, Math.min(adjIndex, l.length));
      return [...l.slice(0, at), node, ...l.slice(at)];
    });
    return next;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/object-group-mutations.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the Task 5 mutations test to confirm no regression**

Run: `npx vitest run tests/unit/object-mutations.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/editor/object-mutations.ts tests/unit/object-group-mutations.test.ts
git commit -m "feat(objects): group/ungroup/reparent mutations"
```

---

### Task 7: Store wiring + undo/redo integration

**Files:**
- Modify: `lib/editor/store.ts`
- Test: `tests/unit/store-objects.test.ts`

**Interfaces:**
- Consumes: the pure mutations (Tasks 5–6); `uniqueObjectId` (Task 3); `descriptorForObject` (Task 4); the existing `commit` helper and `ObjectPath`.
- Produces new `EditorState` methods (each routes through `commit`, so it inherits undo/redo + the `revision` bump that drives autosave):
  - `addObject(sceneId: string, kind: SceneObject["kind"], parentPath?: ObjectPath, index?: number): void`
  - `updateObject(sceneId: string, path: ObjectPath, fieldKey: string, value: unknown): void`
  - `deleteObject(sceneId: string, path: ObjectPath): void`
  - `reorderObject(sceneId: string, path: ObjectPath, dir: -1 | 1): void`
  - `groupObjects(sceneId: string, paths: ObjectPath[]): void`
  - `ungroupObject(sceneId: string, path: ObjectPath): void`
  - `reparentObject(sceneId: string, from: ObjectPath, toParent: ObjectPath, toIndex: number): void`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/store-objects.test.ts`:

```ts
import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(base()); });

test("addObject inserts a registry-default object with a unique id and records history", () => {
  const s = useEditor.getState();
  const rev0 = s.revision;
  s.addObject("s1", "text");
  const st = useEditor.getState();
  const objs = st.doc!.scenes[0].objects!;
  expect(objs).toHaveLength(1);
  expect(objs[0].kind).toBe("text");
  expect(objs[0].id).toBe("o-1");
  expect(st.revision).toBe(rev0 + 1);
  expect(st.past).toHaveLength(1);
});

test("a second addObject gets the next unique id", () => {
  useEditor.getState().addObject("s1", "text");
  useEditor.getState().addObject("s1", "shape");
  expect(useEditor.getState().doc!.scenes[0].objects!.map((o) => o.id)).toEqual(["o-1", "o-2"]);
});

test("undo restores the pre-object document", () => {
  useEditor.getState().addObject("s1", "text");
  useEditor.getState().undo();
  expect(useEditor.getState().doc!.scenes[0].objects ?? []).toHaveLength(0);
});

test("groupObjects wraps two objects and records one history entry", () => {
  const s = useEditor.getState();
  s.addObject("s1", "text");
  s.addObject("s1", "shape");
  const revBefore = useEditor.getState().revision;
  useEditor.getState().groupObjects("s1", [[0], [1]]);
  const objs = useEditor.getState().doc!.scenes[0].objects!;
  expect(objs).toHaveLength(1);
  expect(objs[0].kind).toBe("group");
  expect(objs[0].id).toBe("o-3"); // o-1, o-2 taken
  expect(useEditor.getState().revision).toBe(revBefore + 1);
});

test("updateObject edits a field and bumps revision", () => {
  useEditor.getState().addObject("s1", "shape");
  useEditor.getState().updateObject("s1", [0], "transform.x", 0.42);
  expect(useEditor.getState().doc!.scenes[0].objects![0].transform.x).toBe(0.42);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/store-objects.test.ts`
Expected: FAIL — `addObject`/`groupObjects`/etc. are not functions on the store.

- [ ] **Step 3: Wire the store**

In `lib/editor/store.ts`:

(a) Extend the imports. Replace the existing mutations import line (line 5) so it also pulls the object mutations, and add the tree/registry imports and the `SceneObject`/`ObjectPath` types:

```ts
import type { DeckDoc } from "@/engine/deck-doc";
import type { SceneObject } from "@/engine/deck/types";
import { flattenBeats, beatLocation, type FlatBeat } from "./flatten-beats";
import { setPath } from "./paths";
import { insertBeatAfter, duplicateBeatAt, deleteBeatAt, moveBeatBy, appendScene, deleteSceneAt, insertActionAfter, duplicateActionAt, deleteActionAt, moveActionBy, convertActionKind } from "./mutations";
import { addObject as mAddObject, updateObject as mUpdateObject, deleteObject as mDeleteObject, reorderObject as mReorderObject, groupObjects as mGroupObjects, ungroupObject as mUngroupObject, reparentObject as mReparentObject } from "./object-mutations";
import { uniqueObjectId, type ObjectPath } from "./object-tree";
import { descriptorForObject } from "./object-registry";
```

(b) Add the method signatures to the `EditorState` interface, right after `convertAction`:

```ts
  addObject: (sceneId: string, kind: SceneObject["kind"], parentPath?: ObjectPath, index?: number) => void;
  updateObject: (sceneId: string, path: ObjectPath, fieldKey: string, value: unknown) => void;
  deleteObject: (sceneId: string, path: ObjectPath) => void;
  reorderObject: (sceneId: string, path: ObjectPath, dir: -1 | 1) => void;
  groupObjects: (sceneId: string, paths: ObjectPath[]) => void;
  ungroupObject: (sceneId: string, path: ObjectPath) => void;
  reparentObject: (sceneId: string, from: ObjectPath, toParent: ObjectPath, toIndex: number) => void;
```

(c) Add the implementations to the store object, right after the `convertAction` implementation (before the closing `}));`):

```ts
  addObject: (sceneId, kind, parentPath, index) => set((s) => {
    if (!s.doc) return {};
    const object: SceneObject = { ...descriptorForObject({ kind }).defaults(), id: uniqueObjectId(s.doc, sceneId) };
    return commit(s, (doc) => mAddObject(doc, sceneId, object, parentPath, index));
  }),
  updateObject: (sceneId, path, fieldKey, value) => set((s) => commit(s, (doc) => mUpdateObject(doc, sceneId, path, fieldKey, value))),
  deleteObject: (sceneId, path) => set((s) => commit(s, (doc) => mDeleteObject(doc, sceneId, path))),
  reorderObject: (sceneId, path, dir) => set((s) => commit(s, (doc) => mReorderObject(doc, sceneId, path, dir))),
  groupObjects: (sceneId, paths) => set((s) => {
    if (!s.doc) return {};
    return commit(s, (doc) => mGroupObjects(doc, sceneId, paths, uniqueObjectId(doc, sceneId)));
  }),
  ungroupObject: (sceneId, path) => set((s) => commit(s, (doc) => mUngroupObject(doc, sceneId, path))),
  reparentObject: (sceneId, from, toParent, toIndex) => set((s) => commit(s, (doc) => mReparentObject(doc, sceneId, from, toParent, toIndex))),
```

Note: `descriptorForObject({ kind }).defaults()` returns an object with a placeholder `id: "o-1"`; the spread overrides it with the scene-unique id. For `addObject("s1","group")` the default `children: []` is preserved.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/store-objects.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the existing store/history tests to confirm no regression**

Run: `npx vitest run tests/unit/store.test.ts tests/unit/store-history.test.ts`
Expected: PASS (unchanged).

- [ ] **Step 6: Commit**

```bash
git add lib/editor/store.ts tests/unit/store-objects.test.ts
git commit -m "feat(objects): wire object mutations into the editor store (undo/autosave)"
```

---

### Task 8: Deck-format version-bump policy doc

**Files:**
- Create: `docs/superpowers/specs/deck-format-version-policy.md`

**Interfaces:** none (documentation deliverable required by the spec §8 / north-star §14a/Q7).

- [ ] **Step 1: Write the policy doc**

Create `docs/superpowers/specs/deck-format-version-policy.md`:

```markdown
# DeckDoc Format — Version-Bump Policy

- **Status:** Living policy · **Established:** 2026-07-21 (with the object/layer model)

`DeckDoc.version` is the format contract between a deck file and the Morgana engine/editor.
This policy defines when it changes, so schema growth stays predictable and backward-compatible.

## The rule

- **Additive optional fields never bump `version`.** New optional fields on `DeckDoc`, `Scene`,
  `Beat`, `Action`, or `SceneObject` (defaulting to "absent = prior behavior") ship under the
  current `version`. Existing decks stay valid and unchanged; an older Morgana opening a newer
  deck loads it and ignores fields it doesn't understand (graceful degradation).
- **Breaking changes bump `version` and ship a migration.** A breaking change is any of:
  removing or renaming an existing field; changing a field's type or units; changing the meaning
  of an existing value; or making a previously optional field required. These bump `version` by 1,
  and `validateDeckDoc` is updated to accept the new version alongside a migration that upgrades
  older decks on load.

## Consequences

- Load stays pure `JSON.parse`; save stays pure `JSON.stringify`. Migrations, when they exist, run
  as an explicit upgrade step on the parsed object — never a save-time rewrite of untouched decks.
- `Scene.objects` (the object/layer model, 2026-07-21) is the first exercise of this policy: a
  purely additive optional field shipped under `version: 1` with **no** migration.
- This policy is the "format-version freeze + bump policy" prerequisite the end-state design's
  §14a / Q7 names as the trigger for extracting the engine into a package.
```

- [ ] **Step 2: Verify the file renders / no broken structure**

Run: `test -f docs/superpowers/specs/deck-format-version-policy.md && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/deck-format-version-policy.md
git commit -m "docs: DeckDoc format version-bump policy (additive vs breaking)"
```

---

### Final verification

- [ ] **Run the whole unit suite**

Run: `npm test`
Expected: PASS — all tests green, including the six new files (`scene-objects-types`, `deck-doc-objects`, `object-tree`, `object-registry`, `object-mutations`, `object-group-mutations`, `store-objects`) and no regressions.

- [ ] **Typecheck / build**

Run: `npm run build`
Expected: succeeds (no TypeScript errors from the new types/imports).

---

## Notes for the executor

- **No UI, no engine changes.** If a task tempts you to touch `components/`, `engine/authoring/`, or
  `engine/components/`, stop — that's sub-project #2/#3. This plan only adds data-model files under
  `engine/deck/`, `lib/editor/`, and `engine/deck-doc.ts`.
- **No action verbs.** Do not add any `target` field to `Action` or any new `Action` kind. The
  object↔action binding is sub-project #3.
- **Follow the no-op convention.** A mutation that changes nothing must return the **same** `doc`
  reference so `commit` records no history entry — the existing action/beat mutations are the model.
```
