# Object Canvas Foundation (#2a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make objects visible, selectable, editable, and movable in the Morgana editor — an authoring-time canvas overlay plus Inspector editing, add/delete, and drag-to-move — built on the `Scene.objects` data model from sub-project #1.

**Architecture:** A new `ObjectsLayer` overlay is mounted inside the canvas host div; it flattens the scene's object tree to a paint-ordered list of absolutely-positioned boxes (reusing the `PosHandle` percentage math). Object selection is a new `selectedObjectPath` in the Zustand store, mutually exclusive with `selectedAction`; the schema-driven `Inspector` branches on it. Drag-to-move previews locally and commits once on pointer-up via a new batched `updateObjectTransform` mutation.

**Tech Stack:** TypeScript, Next.js, React, Zustand, Vitest + jsdom + `@testing-library/react` (unit/component), Playwright (e2e). No new dependencies.

## Global Constraints

- **Depends on #1 (PR #15, already on this branch):** `SceneObject`, `ObjectTransform`, `Scene.objects` (`engine/deck/types.ts`); object mutations + `updateObject`/`addObject`/`deleteObject` and registry (`lib/editor/object-mutations.ts`, `object-registry.ts`, `object-tree.ts`); store already wired for those.
- **Selection is mutually exclusive:** `selectedObjectPath` XOR `selectedAction`. Selecting one clears the other. Beat change (`select`) and `load`/`undo`/`redo` clear both.
- **Drag commits once:** during a drag, preview via local component state (no store writes); commit exactly one `updateObjectTransform` on pointer-up → one undo entry. A pure click (no movement) must not create a history entry.
- **Coordinate space:** normalized 0–1 on the 16:9 stage, mapped via `host.getBoundingClientRect()` exactly as `PosHandle` does (`(clientX-rect.left)/rect.width`, clamped `[0,1]`).
- **Authoring overlay only:** `ObjectsLayer` renders an editor representation; it is NOT the engine playback render (that's #3). Do not touch `engine/authoring/seek.ts` or `engine/components/`.
- **Scope fence:** NO resize/rotate handles (#2b), NO layers panel / multi-select / grouping UI / rename / hide-lock UI (#2c). #2a selects **individual leaf objects**, honors existing `hidden`/`locked` flags, and provides no UI to set them.
- **Object kinds addable in #2a:** text, image, shape (NOT group — groups are created in #2c).
- **Styling:** global `editor.css` + `--ed-*` tokens; per-object positioning stays inline `style`. No CSS Modules, no Tailwind.
- **Testing:** vitest (`.test.ts`/`.test.tsx`) is the local TDD gate and MUST pass (`npx vitest run <file>`). Playwright e2e specs are authored as deliverables and follow `e2e/drag-pos.spec.ts`; run them if the local production build works, but **do not block a task on this worktree's known-incomplete `next` install** (`npm run build` page-data crash) — note it and rely on CI (`.github/workflows/ci.yml` runs e2e on a fresh `npm ci`).
- **Path alias:** `@/` = repo root.

---

### Task 1: `updateObjectTransform` — batched transform mutation

**Files:**
- Modify: `lib/editor/object-mutations.ts` (add pure `updateObjectTransform`)
- Modify: `lib/editor/store.ts` (add store method + interface signature)
- Test: `tests/unit/object-transform-mutation.test.ts`, `tests/unit/store-object-transform.test.ts`

**Interfaces:**
- Consumes: `mapSceneObjects` (internal in object-mutations.ts), `getObjectAt`, `mapChildList`, `ObjectPath` (object-tree.ts); `ObjectTransform` (types.ts); the store's `commit`.
- Produces:
  - `updateObjectTransform(doc: DeckDoc, sceneId: string, path: ObjectPath, patch: Partial<ObjectTransform>): DeckDoc`
  - store method `updateObjectTransform(sceneId: string, path: ObjectPath, patch: Partial<ObjectTransform>): void`

- [ ] **Step 1: Write the failing test (pure mutation)**

Create `tests/unit/object-transform-mutation.test.ts`:

```ts
import { expect, test } from "vitest";
import { updateObjectTransform } from "@/lib/editor/object-mutations";
import type { DeckDoc } from "@/engine/deck-doc";
import type { SceneObject } from "@/engine/deck/types";

const obj = (id: string): SceneObject => ({ id, kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });
const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [obj("a"), obj("b")], beats: [] },
] });

test("merges a partial transform patch immutably", () => {
  const d = updateObjectTransform(base(), "s1", [1], { x: 0.5, w: 0.4 });
  expect(d.scenes[0].objects![1].transform).toEqual({ x: 0.5, y: 0.1, w: 0.4, h: 0.2 });
  expect(base().scenes[0].objects![1].transform.x).toBe(0.1); // input untouched
});

test("no-op on unknown scene or path returns the same doc reference", () => {
  const b = base();
  expect(updateObjectTransform(b, "nope", [0], { x: 0.5 })).toBe(b);
  expect(updateObjectTransform(b, "s1", [9], { x: 0.5 })).toBe(b);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/object-transform-mutation.test.ts`
Expected: FAIL — `updateObjectTransform` is not exported.

- [ ] **Step 3: Implement the pure mutation**

Append to `lib/editor/object-mutations.ts`:

```ts
/** Merge a partial transform patch onto the object at `path` (batched multi-field edit,
 *  one commit). Unknown scene/path → same doc reference. */
export function updateObjectTransform(doc: DeckDoc, sceneId: string, path: ObjectPath, patch: Partial<ObjectTransform>): DeckDoc {
  return mapSceneObjects(doc, sceneId, (objects) => {
    if (!getObjectAt(objects, path)) return objects;
    const parent = path.slice(0, -1);
    const idx = path[path.length - 1];
    return mapChildList(objects, parent, (list) =>
      list.map((o, i) => (i === idx ? { ...o, transform: { ...o.transform, ...patch } } : o)));
  });
}
```

(`ObjectTransform` is already imported in this file from Task 6 of #1; if not present, add it to the `@/engine/deck/types` import.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/object-transform-mutation.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing store test**

Create `tests/unit/store-object-transform.test.ts`:

```ts
import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [{ id: "o-1", kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }], beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(base()); });

test("updateObjectTransform commits one undoable transform change", () => {
  const rev0 = useEditor.getState().revision;
  useEditor.getState().updateObjectTransform("s1", [0], { x: 0.6, y: 0.7 });
  const t = useEditor.getState().doc!.scenes[0].objects![0].transform;
  expect([t.x, t.y]).toEqual([0.6, 0.7]);
  expect(useEditor.getState().revision).toBe(rev0 + 1);
  useEditor.getState().undo();
  expect(useEditor.getState().doc!.scenes[0].objects![0].transform.x).toBe(0.1);
});
```

- [ ] **Step 6: Run to verify it fails, then wire the store method**

Run: `npx vitest run tests/unit/store-object-transform.test.ts` → FAIL (`updateObjectTransform` not a function).

In `lib/editor/store.ts`: (a) add to the object-mutations import alias list: `updateObjectTransform as mUpdateObjectTransform`; (b) import the type — extend the `@/engine/deck/types` import to include `ObjectTransform`; (c) add to the `EditorState` interface after `updateObject`:

```ts
  updateObjectTransform: (sceneId: string, path: ObjectPath, patch: Partial<ObjectTransform>) => void;
```

(d) add the implementation after the `updateObject` implementation:

```ts
  updateObjectTransform: (sceneId, path, patch) => set((s) => commit(s, (doc) => mUpdateObjectTransform(doc, sceneId, path, patch))),
```

- [ ] **Step 7: Run both tests + tsc**

Run: `npx vitest run tests/unit/object-transform-mutation.test.ts tests/unit/store-object-transform.test.ts && npx tsc --noEmit -p .`
Expected: PASS (3 tests), tsc clean.

- [ ] **Step 8: Commit**

```bash
git add lib/editor/object-mutations.ts lib/editor/store.ts tests/unit/object-transform-mutation.test.ts tests/unit/store-object-transform.test.ts
git commit -m "feat(objects): batched updateObjectTransform mutation + store method"
```

---

### Task 2: Object selection state + `findObjectPath`

**Files:**
- Modify: `lib/editor/object-tree.ts` (add `findObjectPath`)
- Modify: `lib/editor/store.ts` (add `selectedObjectPath` state, `selectObject`, mutual-exclusion, add/delete selection wiring)
- Test: `tests/unit/object-tree-find.test.ts`, `tests/unit/store-object-selection.test.ts`

**Interfaces:**
- Consumes: `ObjectPath`, `SceneObject`, existing store `commit`/`addObject`/`deleteObject`.
- Produces:
  - `findObjectPath(objects: SceneObject[], id: string): ObjectPath | null`
  - store state `selectedObjectPath: ObjectPath | null`; method `selectObject(path: ObjectPath | null): void`
  - `selectAction`, `select`, `load`, `undo`, `redo`, `addObject`, `deleteObject` updated to maintain mutual exclusion / selection.

- [ ] **Step 1: Write the failing test (findObjectPath)**

Create `tests/unit/object-tree-find.test.ts`:

```ts
import { expect, test } from "vitest";
import { findObjectPath } from "@/lib/editor/object-tree";
import type { SceneObject } from "@/engine/deck/types";

const tree = (): SceneObject[] => [
  { id: "a", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 1, h: 1 } },
  { id: "g", kind: "group", transform: { x: 0, y: 0, w: 1, h: 1 }, children: [
    { id: "b", kind: "text", text: "b", transform: { x: 0, y: 0, w: 1, h: 1 } },
  ] },
];

test("findObjectPath returns the depth-first path to an id, or null", () => {
  expect(findObjectPath(tree(), "a")).toEqual([0]);
  expect(findObjectPath(tree(), "g")).toEqual([1]);
  expect(findObjectPath(tree(), "b")).toEqual([1, 0]);
  expect(findObjectPath(tree(), "missing")).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npx vitest run tests/unit/object-tree-find.test.ts` → FAIL (not exported).

Append to `lib/editor/object-tree.ts`:

```ts
/** Depth-first path to the object with `id`, or null if absent. */
export function findObjectPath(objects: SceneObject[], id: string): ObjectPath | null {
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (o.id === id) return [i];
    if (o.kind === "group") {
      const sub = findObjectPath(o.children, id);
      if (sub) return [i, ...sub];
    }
  }
  return null;
}
```

- [ ] **Step 3: Run to verify it passes**

Run: `npx vitest run tests/unit/object-tree-find.test.ts`
Expected: PASS (1 test).

- [ ] **Step 4: Write the failing store-selection test**

Create `tests/unit/store-object-selection.test.ts`:

```ts
import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "b1", timeline: [{ kind: "text", value: "x", in: "fade" }] }, { id: "b2", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(base()); });

test("selectObject sets the path and clears selectedAction", () => {
  useEditor.getState().selectAction(0);
  useEditor.getState().selectObject([0]);
  expect(useEditor.getState().selectedObjectPath).toEqual([0]);
  expect(useEditor.getState().selectedAction).toBeNull();
});

test("selectAction clears selectedObjectPath (mutual exclusion)", () => {
  useEditor.getState().selectObject([0]);
  useEditor.getState().selectAction(0);
  expect(useEditor.getState().selectedAction).toBe(0);
  expect(useEditor.getState().selectedObjectPath).toBeNull();
});

test("changing the selected beat clears both selections", () => {
  useEditor.getState().selectObject([0]);
  useEditor.getState().select(1);
  expect(useEditor.getState().selectedObjectPath).toBeNull();
  expect(useEditor.getState().selectedAction).toBeNull();
});

test("addObject selects the new object; deleteObject clears the selection", () => {
  useEditor.getState().addObject("s1", "text");
  expect(useEditor.getState().selectedObjectPath).toEqual([0]);
  useEditor.getState().deleteObject("s1", [0]);
  expect(useEditor.getState().selectedObjectPath).toBeNull();
});

test("load clears object selection", () => {
  useEditor.getState().selectObject([0]);
  useEditor.getState().load(base());
  expect(useEditor.getState().selectedObjectPath).toBeNull();
});
```

- [ ] **Step 5: Run to verify it fails, then wire the store**

Run: `npx vitest run tests/unit/store-object-selection.test.ts` → FAIL.

In `lib/editor/store.ts`:

(a) Import `findObjectPath` from `./object-tree` (extend the existing object-tree import: `import { uniqueObjectId, findObjectPath, type ObjectPath } from "./object-tree";`).

(b) Add to the `EditorState` interface (near `selectAction`):

```ts
  selectedObjectPath: ObjectPath | null;
  selectObject: (path: ObjectPath | null) => void;
```

(c) Add the initial state value alongside `selectedAction: null`:

```ts
  selectedObjectPath: null,
```

(d) In `load`'s `set({...})`, add `selectedObjectPath: null` (next to `selectedAction: null`).

(e) Replace `select` and `selectAction` so they maintain mutual exclusion:

```ts
  select: (i) => {
    const last = Math.max(0, get().beats.length - 1);
    set({ selected: Math.min(last, Math.max(0, i)), selectedAction: null, selectedObjectPath: null });
  },
  selectAction: (i) => set({ selectedAction: i, selectedObjectPath: null }),
  selectObject: (path) => set({ selectedObjectPath: path, selectedAction: null }),
```

(f) In `undo` and `redo`, add `selectedObjectPath: null` to their returned state objects (next to `selectedAction: null`).

(g) Replace the `addObject` implementation so it selects the new object (via `findObjectPath`, robust to insert position):

```ts
  addObject: (sceneId, kind, parentPath, index) => set((s) => {
    if (!s.doc) return {};
    const object: SceneObject = { ...descriptorForObject({ kind }).defaults(), id: uniqueObjectId(s.doc, sceneId) };
    const part = commit(s, (doc) => mAddObject(doc, sceneId, object, parentPath, index));
    if (!part.doc) return {};
    const scene = part.doc.scenes.find((sc) => sc.id === sceneId);
    return { ...part, selectedObjectPath: scene ? findObjectPath(scene.objects ?? [], object.id) : null, selectedAction: null };
  }),
```

(h) Replace the `deleteObject` implementation so it clears object selection:

```ts
  deleteObject: (sceneId, path) => set((s) => {
    const part = commit(s, (doc) => mDeleteObject(doc, sceneId, path));
    if (!part.doc) return {};
    return { ...part, selectedObjectPath: null };
  }),
```

- [ ] **Step 6: Run selection test + existing store tests + tsc**

Run: `npx vitest run tests/unit/store-object-selection.test.ts tests/unit/store.test.ts tests/unit/store-history.test.ts tests/unit/store-objects.test.ts && npx tsc --noEmit -p .`
Expected: PASS (existing store tests unchanged), tsc clean.

- [ ] **Step 7: Commit**

```bash
git add lib/editor/object-tree.ts lib/editor/store.ts tests/unit/object-tree-find.test.ts tests/unit/store-object-selection.test.ts
git commit -m "feat(objects): selectedObjectPath state + mutual-exclusion + findObjectPath"
```

---

### Task 3: `ObjectsLayer` render (static overlay)

**Files:**
- Create: `components/editor/ObjectsLayer.tsx`
- Modify: `components/editor/DeckCanvas.tsx` (mount it)
- Modify: `app/editor/editor.css` (object styles)
- Test: `tests/unit/objects-layer.test.tsx`

**Interfaces:**
- Consumes: store `doc`, `selected`, `beats` (`FlatBeat.sceneId`), `selectedObjectPath`; `SceneObject` (types.ts).
- Produces: `ObjectsLayer` component (props `{ hostRef: React.RefObject<HTMLDivElement | null> }`), rendering a paint-ordered flat list of absolutely-positioned object boxes. Each element carries `data-testid="obj"` and `data-obj-id={id}`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/objects-layer.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { ObjectsLayer } from "@/components/editor/ObjectsLayer";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "bg", kind: "shape", shape: "rect", fill: "#222", transform: { x: 0, y: 0, w: 1, h: 1 } },
    { id: "title", kind: "text", text: "Hello", transform: { x: 0.1, y: 0.2, w: 0.4, h: 0.15 } },
    { id: "hidden1", kind: "text", text: "no", hidden: true, transform: { x: 0.1, y: 0.5, w: 0.2, h: 0.1 } },
    { id: "grp", kind: "group", transform: { x: 0.3, y: 0.3, w: 0.4, h: 0.3 }, children: [
      { id: "child", kind: "text", text: "In group", transform: { x: 0.3, y: 0.3, w: 0.3, h: 0.1 } },
    ] },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(doc()); });
afterEach(cleanup);

test("renders visible objects as positioned boxes, skipping hidden ones", () => {
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  // bg, title, child are drawn; a selected group frame is not (nothing selected); hidden1 is skipped
  const boxes = screen.getAllByTestId("obj");
  const ids = boxes.map((b) => b.getAttribute("data-obj-id"));
  expect(ids).toContain("bg");
  expect(ids).toContain("title");
  expect(ids).toContain("child");
  expect(ids).not.toContain("hidden1");
  expect(screen.getByText("Hello")).toBeTruthy();
});

test("positions a box by its normalized transform", () => {
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  const title = screen.getAllByTestId("obj").find((b) => b.getAttribute("data-obj-id") === "title")!;
  expect(title.style.left).toBe("10%");
  expect(title.style.top).toBe("20%");
  expect(title.style.width).toBe("40%");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/objects-layer.test.tsx`
Expected: FAIL — module `@/components/editor/ObjectsLayer` not found.

- [ ] **Step 3: Implement `ObjectsLayer`**

Create `components/editor/ObjectsLayer.tsx`:

```tsx
"use client";
import type { RefObject } from "react";
import { useEditor } from "@/lib/editor/store";
import type { SceneObject, TextObjectStyle } from "@/engine/deck/types";
import type { ObjectPath } from "@/lib/editor/object-tree";

const SIZE_PX: Record<NonNullable<TextObjectStyle["size"]>, number> = { lg: 34, md: 22, sm: 15 };

/** Flatten the tree to a paint-ordered list (depth-first, parent before children). */
function flatten(objects: SceneObject[], base: ObjectPath = []): { obj: SceneObject; path: ObjectPath }[] {
  const out: { obj: SceneObject; path: ObjectPath }[] = [];
  objects.forEach((obj, i) => {
    const path = [...base, i];
    out.push({ obj, path });
    if (obj.kind === "group") out.push(...flatten(obj.children, path));
  });
  return out;
}

const pathEq = (a: ObjectPath | null, b: ObjectPath) => !!a && a.length === b.length && a.every((v, i) => v === b[i]);

export function ObjectsLayer({ hostRef }: { hostRef: RefObject<HTMLDivElement | null> }) {
  void hostRef; // used for drag in a later task
  const doc = useEditor((s) => s.doc);
  const selected = useEditor((s) => s.selected);
  const beats = useEditor((s) => s.beats);
  const selectedObjectPath = useEditor((s) => s.selectedObjectPath);
  const sceneId = beats[selected]?.sceneId;
  const objects = doc?.scenes.find((sc) => sc.id === sceneId)?.objects ?? [];
  if (!objects.length) return null;

  return (
    <div className="ed__objects" style={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: "none" }}>
      {flatten(objects).map(({ obj, path }) => {
        if (obj.hidden) return null;
        if (obj.kind === "group" && !pathEq(selectedObjectPath, path)) return null; // groups draw only when selected
        const t = obj.transform;
        const selectedCls = pathEq(selectedObjectPath, path) ? " ed__obj--selected" : "";
        const style: React.CSSProperties = {
          position: "absolute", left: `${t.x * 100}%`, top: `${t.y * 100}%`, width: `${t.w * 100}%`, height: `${t.h * 100}%`,
          transform: t.rot ? `rotate(${t.rot}deg)` : undefined, transformOrigin: t.anchor === "top-left" ? "0 0" : "50% 50%",
          opacity: obj.opacity ?? 1,
        };
        return (
          <div key={obj.id} data-testid="obj" data-obj-id={obj.id} className={`ed__obj ed__obj--${obj.kind}${selectedCls}`} style={style}>
            {renderContent(obj)}
          </div>
        );
      })}
    </div>
  );
}

function renderContent(obj: SceneObject) {
  switch (obj.kind) {
    case "text":
      return (
        <span style={{
          display: "block", width: "100%", height: "100%", overflow: "hidden",
          fontSize: SIZE_PX[obj.style?.size ?? "md"], textAlign: obj.style?.align ?? "left",
          color: obj.style?.color ?? "var(--ed-fg)", fontWeight: obj.style?.bold ? 700 : 400, fontStyle: obj.style?.italic ? "italic" : "normal",
        }}>{obj.text}</span>
      );
    case "image":
      return obj.src
        ? <img src={obj.src} alt="" style={{ width: "100%", height: "100%", objectFit: obj.fit ?? "contain", borderRadius: obj.round ? "50%" : 0 }} />
        : <span className="ed__obj-ph">image</span>;
    case "shape": {
      const stroke = obj.stroke ? `${Math.max(1, obj.stroke.width * 400)}px solid ${obj.stroke.color}` : undefined;
      return <span style={{ display: "block", width: "100%", height: "100%", background: obj.fill ?? "transparent", border: stroke, borderRadius: obj.shape === "ellipse" ? "50%" : (obj.radius ? `${obj.radius * 100}%` : 0) }} />;
    }
    case "group":
      return null; // frame comes from the .ed__obj--group border
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/objects-layer.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Mount it in the canvas + add CSS**

In `components/editor/DeckCanvas.tsx`, add the import near the top:

```tsx
import { ObjectsLayer } from "./ObjectsLayer";
```

Then inside the host div, add `<ObjectsLayer hostRef={host} />` as the **last child** (after `<PosHandle … />`):

```tsx
        <PosHandle hostRef={host} redraw={draw} />
        <ObjectsLayer hostRef={host} />
      </div>
```

Append to `app/editor/editor.css`:

```css
.ed__obj { box-sizing: border-box; }
.ed__obj--group { border: 1px dashed var(--ed-accent); }
.ed__obj--selected { outline: 2px solid var(--ed-accent); outline-offset: 1px; z-index: 20; }
.ed__obj-ph { display: grid; place-items: center; width: 100%; height: 100%; font-size: 11px; color: var(--ed-fg-muted); border: 1px dashed var(--ed-line); }
```

- [ ] **Step 6: Run the full unit suite + tsc**

Run: `npm test && npx tsc --noEmit -p .`
Expected: PASS (all), tsc clean. (Confirms `DeckCanvas` still compiles with the new child.)

- [ ] **Step 7: Commit**

```bash
git add components/editor/ObjectsLayer.tsx components/editor/DeckCanvas.tsx app/editor/editor.css tests/unit/objects-layer.test.tsx
git commit -m "feat(objects): ObjectsLayer authoring overlay renders scene objects"
```

---

### Task 4: Click-to-select + deselect

**Files:**
- Modify: `components/editor/ObjectsLayer.tsx` (pointer-down → select; empty-canvas → deselect; locked pass-through)
- Test: `tests/unit/objects-layer-select.test.tsx`

**Interfaces:**
- Consumes: store `selectObject`, `selectedObjectPath` (Task 2).
- Produces: click selection behavior on `ObjectsLayer` objects; background click deselects.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/objects-layer-select.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { ObjectsLayer } from "@/components/editor/ObjectsLayer";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "a", kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    { id: "b", kind: "shape", shape: "rect", locked: true, transform: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(doc()); });
afterEach(cleanup);

function boxFor(id: string) { return screen.getAllByTestId("obj").find((b) => b.getAttribute("data-obj-id") === id)!; }

test("pointer-down on an object selects it", () => {
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  fireEvent.pointerDown(boxFor("a"));
  expect(useEditor.getState().selectedObjectPath).toEqual([0]);
});

test("a locked object does not select on pointer-down", () => {
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  fireEvent.pointerDown(boxFor("b"));
  expect(useEditor.getState().selectedObjectPath).toBeNull();
});

test("pointer-down on the deselect catcher (shown only while selected) deselects", () => {
  useEditor.getState().selectObject([0]);
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  fireEvent.pointerDown(screen.getByTestId("objects-deselect"));
  expect(useEditor.getState().selectedObjectPath).toBeNull();
});

test("no deselect catcher exists when nothing is selected", () => {
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  expect(screen.queryByTestId("objects-deselect")).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/objects-layer-select.test.tsx`
Expected: FAIL — no selection happens / `objects-deselect` not found.

- [ ] **Step 3: Implement selection**

The wrapper stays `pointer-events: none` (Task 3) so empty-canvas clicks fall through to the action `PosHandle` beneath. Object boxes opt back into pointer events; a full-canvas **deselect catcher** is rendered **only when an object is selected** (when no `PosHandle` is shown, so there is no conflict).

In `components/editor/ObjectsLayer.tsx`:

(a) Read the new store method — add near the other `useEditor` calls:

```tsx
  const selectObject = useEditor((s) => s.selectObject);
```

(b) As the **first child** inside the wrapper (before the mapped objects), add the conditional deselect catcher:

```tsx
      {selectedObjectPath && (
        <div
          data-testid="objects-deselect"
          style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}
          onPointerDown={() => selectObject(null)}
        />
      )}
```

(c) On each object box, select on pointer-down unless locked (and stop propagation so it doesn't reach the catcher). Replace the existing `style={style}` on the object `<div>` with the spread form and add the handler:

```tsx
            onPointerDown={(e) => { if (obj.locked) return; e.stopPropagation(); selectObject(path); }}
            style={{ ...style, pointerEvents: obj.locked ? "none" : "auto", cursor: "move" }}
```

(The object box sits after the catcher in DOM order, so it paints above the catcher and receives the click first; the catcher only catches clicks on empty canvas.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/objects-layer-select.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/editor/ObjectsLayer.tsx tests/unit/objects-layer-select.test.tsx
git commit -m "feat(objects): click-to-select objects + background deselect + locked pass-through"
```

---

### Task 5: Drag-to-move (transient preview + single commit)

**Files:**
- Create: `lib/editor/object-drag.ts` (pure pointer→fraction helper)
- Modify: `components/editor/ObjectsLayer.tsx` (drag the selected object's body)
- Test: `tests/unit/object-drag.test.ts` (helper), `e2e/object-drag.spec.ts` (interaction)

**Interfaces:**
- Consumes: `updateObjectTransform` store method (Task 1); `hostRef` (the canvas host rect).
- Produces:
  - `pointerFraction(rect: DOMRect, clientX: number, clientY: number): { x: number; y: number }` (clamped 0–1)
  - drag-to-move on the selected object: local preview during move, one `updateObjectTransform` commit on pointer-up.

- [ ] **Step 1: Write the failing helper test**

Create `tests/unit/object-drag.test.ts`:

```ts
import { expect, test } from "vitest";
import { pointerFraction } from "@/lib/editor/object-drag";

const rect = { left: 100, top: 50, width: 800, height: 450 } as DOMRect;

test("maps client coords to a clamped 0–1 fraction of the rect", () => {
  expect(pointerFraction(rect, 500, 275)).toEqual({ x: 0.5, y: 0.5 });
  expect(pointerFraction(rect, 100, 50)).toEqual({ x: 0, y: 0 });
  expect(pointerFraction(rect, 5000, 5000)).toEqual({ x: 1, y: 1 }); // clamped
  expect(pointerFraction(rect, -100, -100)).toEqual({ x: 0, y: 0 });   // clamped
});
```

- [ ] **Step 2: Run to verify it fails, then implement the helper**

Run: `npx vitest run tests/unit/object-drag.test.ts` → FAIL (module missing).

Create `lib/editor/object-drag.ts`:

```ts
/** Map client pixel coords to a clamped 0–1 fraction of `rect` (the 16:9 stage host). */
export function pointerFraction(rect: DOMRect, clientX: number, clientY: number): { x: number; y: number } {
  const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
  return { x, y };
}
```

- [ ] **Step 3: Run to verify it passes**

Run: `npx vitest run tests/unit/object-drag.test.ts`
Expected: PASS (1 test).

- [ ] **Step 4: Implement drag-to-move in `ObjectsLayer`**

The gesture: pointer-down on an object selects it AND begins a potential drag; pointer-move updates a **local preview** transform (no store write); pointer-up commits once via `updateObjectTransform` (a pure click with no movement leaves the transform unchanged → the mutation is a no-op → no history entry).

In `components/editor/ObjectsLayer.tsx`:

(a) Add imports + state at the top of the component:

```tsx
import { useState } from "react";
import { pointerFraction } from "@/lib/editor/object-drag";
```

Inside `ObjectsLayer`, add:

```tsx
  const updateObjectTransform = useEditor((s) => s.updateObjectTransform);
  const [drag, setDrag] = useState<{ path: ObjectPath; x: number; y: number } | null>(null);
```

(b) Replace the object box's `onPointerDown` (from Task 4) with a version that also starts the drag, and apply the live preview position when this object is being dragged. Compute an effective transform:

```tsx
        const dragging = drag && pathEq(drag.path, path);
        const eff = dragging ? { ...t, x: drag.x, y: drag.y } : t;
```

Use `eff.x`/`eff.y` for `left`/`top` in `style` (keep `w`/`h`/`rot` from `t`). Then the handler:

```tsx
            onPointerDown={(e) => {
              if (obj.locked) return;
              e.stopPropagation();
              selectObject(path);
              const rect = hostRef.current?.getBoundingClientRect();
              if (!rect || rect.width === 0) return;
              // grab offset between pointer and the object's top-left, in fractions
              const start = pointerFraction(rect, e.clientX, e.clientY);
              const off = { x: start.x - t.x, y: start.y - t.y };
              const move = (ev: PointerEvent) => {
                const r = hostRef.current?.getBoundingClientRect();
                if (!r || r.width === 0) return;
                const f = pointerFraction(r, ev.clientX, ev.clientY);
                setDrag({ path, x: Number((f.x - off.x).toFixed(3)), y: Number((f.y - off.y).toFixed(3)) });
              };
              const up = (ev: PointerEvent) => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                const r = hostRef.current?.getBoundingClientRect();
                if (r && r.width > 0) {
                  const f = pointerFraction(r, ev.clientX, ev.clientY);
                  updateObjectTransform(sceneId!, path, { x: Number((f.x - off.x).toFixed(3)), y: Number((f.y - off.y).toFixed(3)) });
                }
                setDrag(null);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
```

(Wire `eff` into the `style` object's `left`/`top`: `left: \`${eff.x * 100}%\``, `top: \`${eff.y * 100}%\``.)

- [ ] **Step 5: Run the component tests + tsc (no regression)**

Run: `npx vitest run tests/unit/objects-layer.test.tsx tests/unit/objects-layer-select.test.tsx tests/unit/object-drag.test.ts && npx tsc --noEmit -p .`
Expected: PASS, tsc clean. (jsdom returns a zero-size rect, so drag math is exercised in e2e, not here — these confirm render/select still work and types are sound.)

- [ ] **Step 6: Write the e2e drag spec**

Create `e2e/object-drag.spec.ts` (mirrors `e2e/drag-pos.spec.ts`):

```ts
import { expect, test } from "@playwright/test";

test("dragging an object body moves it and commits one undoable change", async ({ page, request }) => {
  const id = "e2e-obj-drag";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Obj" }, scenes: [
    { id: "s", objects: [{ id: "o-1", kind: "shape", shape: "rect", fill: "#c33", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }], beats: [{ id: "a", timeline: [] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Obj" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const host = page.locator(".ed__canvas-host");
  const obj = page.locator('[data-obj-id="o-1"]');
  await expect(obj).toBeVisible();

  const box = (await host.boundingBox())!;
  const ob = (await obj.boundingBox())!;
  await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 8 });
  await page.mouse.up();

  // inspector now shows the object's transform.x > 0.5 (X field is the 3rd number input after w/h ordering may vary — assert via any input reflecting > 0.5)
  const xField = page.getByTestId("inspector").locator('input[type="number"]');
  await expect.poll(async () => {
    const vals = await xField.evaluateAll((els) => els.map((e) => Number((e as HTMLInputElement).value)));
    return Math.max(...vals);
  }).toBeGreaterThan(0.5);

  // one undo returns it near its origin
  await page.getByTestId("undo").click();
  await request.delete(`/api/decks/${id}`);
});
```

- [ ] **Step 7: Run the e2e if the local build works; otherwise note CI**

Run: `npm run test:e2e -- object-drag` (or the project's e2e invocation).
Expected: PASS. **If** the local production build fails due to this worktree's incomplete `next` install (the known `Cannot find module '../shared/lib/constants'` page-data crash), do not block — record in your report that the e2e spec is authored and will run in CI, and proceed on the green vitest gate.

- [ ] **Step 8: Commit**

```bash
git add lib/editor/object-drag.ts components/editor/ObjectsLayer.tsx tests/unit/object-drag.test.ts e2e/object-drag.spec.ts
git commit -m "feat(objects): drag-to-move with transient preview + single committed transform"
```

---

### Task 6: Inspector branching (edit the selected object)

**Files:**
- Modify: `components/editor/Inspector.tsx`
- Test: `tests/unit/inspector-objects.test.tsx`

**Interfaces:**
- Consumes: store `selectedObjectPath`, `updateObject`, `deleteObject`, `beats[selected].sceneId`; `getObjectAt` (object-tree.ts); `descriptorForObject` (object-registry.ts); `Field`.
- Produces: Inspector renders object fields when an object is selected (write-back via `updateObject`), with a Delete button; otherwise the existing action path; otherwise an empty state.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/inspector-objects.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Inspector } from "@/components/editor/Inspector";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [{ id: "o-1", kind: "text", text: "Hi", transform: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 } }], beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(doc()); });
afterEach(cleanup);

test("with an object selected, the inspector shows the object's text field and writes back", () => {
  useEditor.getState().selectObject([0]);
  render(<Inspector />);
  const ta = screen.getByTestId("inspector").querySelector("textarea")!;
  expect((ta as HTMLTextAreaElement).value).toBe("Hi");
  fireEvent.change(ta, { target: { value: "Bye" } });
  expect(useEditor.getState().doc!.scenes[0].objects![0]).toMatchObject({ text: "Bye" });
});

test("the object delete button removes it and clears selection", () => {
  useEditor.getState().selectObject([0]);
  render(<Inspector />);
  fireEvent.click(screen.getByTestId("object-delete"));
  expect(useEditor.getState().doc!.scenes[0].objects ?? []).toHaveLength(0);
  expect(useEditor.getState().selectedObjectPath).toBeNull();
});

test("with nothing selected, it shows the empty state", () => {
  render(<Inspector />);
  expect(screen.getByTestId("inspector").textContent).toMatch(/select/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/inspector-objects.test.tsx`
Expected: FAIL — the Inspector has no object branch.

- [ ] **Step 3: Implement the object branch**

Rewrite `components/editor/Inspector.tsx` to branch on object selection first:

```tsx
"use client";
import { useEditor } from "@/lib/editor/store";
import { descriptorFor, REGISTRY } from "@/lib/editor/registry";
import { descriptorForObject } from "@/lib/editor/object-registry";
import { getObjectAt } from "@/lib/editor/object-tree";
import { getPath } from "@/lib/editor/paths";
import { Field } from "./Field";

const CONVERT_KIND_OPTIONS = Object.values(REGISTRY).map((d) => ({ value: d.kind, label: d.label }));

export function Inspector() {
  const doc = useEditor((s) => s.doc);
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const selectedAction = useEditor((s) => s.selectedAction);
  const selectedObjectPath = useEditor((s) => s.selectedObjectPath);
  const updateAction = useEditor((s) => s.updateAction);
  const convertAction = useEditor((s) => s.convertAction);
  const updateObject = useEditor((s) => s.updateObject);
  const deleteObject = useEditor((s) => s.deleteObject);
  const sceneId = beats[selected]?.sceneId;

  // Object selection takes precedence (mutually exclusive with action selection).
  if (selectedObjectPath && sceneId) {
    const objects = doc?.scenes.find((sc) => sc.id === sceneId)?.objects ?? [];
    const obj = getObjectAt(objects, selectedObjectPath);
    if (obj) {
      const d = descriptorForObject(obj);
      return (
        <div className="ed__inspector" data-testid="inspector">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
            <div style={{ fontFamily: "var(--ed-disp)", fontSize: 14 }}>{d.label} object</div>
            <button className="ed__icon" data-testid="object-delete" title="Delete object" onClick={() => deleteObject(sceneId, selectedObjectPath)}>✕</button>
          </div>
          {d.schema.map((f) => (
            <Field key={f.key} spec={f} value={getPath(obj, f.key)} onChange={(v) => updateObject(sceneId, selectedObjectPath, f.key, v)} />
          ))}
        </div>
      );
    }
  }

  const action = selectedAction != null ? beats[selected]?.beat.timeline[selectedAction] : undefined;
  if (!action) return <div className="ed__inspector" data-testid="inspector"><p style={{ opacity: 0.6 }}>Select an object or action to edit.</p></div>;
  const d = descriptorFor(action);
  return (
    <div className="ed__inspector" data-testid="inspector">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
        <div style={{ fontFamily: "var(--ed-disp)", fontSize: 14 }}>{d.label} action</div>
        <select
          data-testid="action-convert"
          value={action.kind}
          onChange={(e) => { if (e.target.value !== action.kind) convertAction(selected, selectedAction!, e.target.value); }}
          style={{ fontSize: 12 }}
        >
          {CONVERT_KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      {d.schema.length === 0 && <p style={{ opacity: 0.6, fontSize: 12 }}>No editable fields.</p>}
      {d.schema.map((f) => (
        <Field key={f.key} spec={f} value={getPath(action, f.key)} onChange={(v) => updateAction(selected, selectedAction!, f.key, v)} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test + the existing inspector e2e**

Run: `npx vitest run tests/unit/inspector-objects.test.tsx && npx tsc --noEmit -p .`
Expected: PASS (3 tests), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add components/editor/Inspector.tsx tests/unit/inspector-objects.test.tsx
git commit -m "feat(objects): Inspector edits the selected object via the object registry"
```

---

### Task 7: Add-object bar control + delete key + e2e

**Files:**
- Modify: `app/editor/page.tsx` (add-object control in the bar; ensure Inspector shows; Delete key)
- Modify: `app/editor/editor.css` (control style, if needed)
- Test: `e2e/objects.spec.ts`

**Interfaces:**
- Consumes: store `addObject`, `deleteObject`, `selectedObjectPath`, `beats[selected].sceneId`; `OBJECT_REGISTRY`.
- Produces: a bar `<select data-testid="object-add">` (Text/Image/Shape) that adds a centered, selected object and switches to the Inspector; `Delete`/`Backspace` removes the selected object when focus isn't in a text field.

- [ ] **Step 1: Write the e2e spec (the primary gate for this task)**

Create `e2e/objects.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("add an object → it renders, is selected, editable, and deletable", async ({ page, request }) => {
  const id = "e2e-objects";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Obj" }, scenes: [{ id: "s", beats: [{ id: "a", timeline: [] }] }] };
  await request.post("/api/decks", { data: { id, title: "Obj" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  // add a text object from the bar
  await page.getByTestId("object-add").selectOption("text");
  const obj = page.locator('[data-obj-id]').first();
  await expect(obj).toBeVisible();
  // it's selected → inspector shows an object with a text field
  await expect(page.getByTestId("inspector")).toContainText(/object/i);
  const ta = page.getByTestId("inspector").locator("textarea");
  await ta.fill("Hello world");
  await expect(page.locator('[data-obj-id]').first()).toContainText("Hello world");
  // delete via the inspector button → gone
  await page.getByTestId("object-delete").click();
  await expect(page.locator('[data-obj-id]')).toHaveCount(0);

  await request.delete(`/api/decks/${id}`);
});
```

- [ ] **Step 2: Implement the bar control + delete key**

In `app/editor/page.tsx`:

(a) Add imports:

```tsx
import { OBJECT_REGISTRY } from "@/lib/editor/object-registry";
```

(b) Read the needed store bits (near the other `useEditor` calls):

```tsx
  const addObject = useEditor((s) => s.addObject);
  const deleteObject = useEditor((s) => s.deleteObject);
  const selectedObjectPath = useEditor((s) => s.selectedObjectPath);
```

(c) Compute the current scene id from the selected beat (after `selectedFlat`):

```tsx
  const sceneId = selectedFlat?.sceneId ?? null;
```

(d) Add the add-object `<select>` to the `.ed__bar`, after the Deck-settings button (kinds text/image/shape only — group is #2c). Selecting an option adds the object and switches to the Inspector:

```tsx
        <select
          data-testid="object-add"
          value=""
          onChange={(e) => { if (e.target.value && sceneId) { addObject(sceneId, e.target.value as "text" | "image" | "shape"); setShowSettings(false); } }}
          style={{ fontSize: 12 }}
        >
          <option value="">＋ Add object…</option>
          {(["text", "image", "shape"] as const).map((k) => (
            <option key={k} value={k}>{OBJECT_REGISTRY[k].label}</option>
          ))}
        </select>
```

(e) Extend the existing keydown handler `onKey` to delete the selected object on `Delete`/`Backspace` (guarded against text-field focus, which the handler already checks at the top). Inside the existing `onKey`, after the ⌘Z block, add:

```tsx
      if ((e.key === "Delete" || e.key === "Backspace") && selectedObjectPath && sceneId) {
        e.preventDefault();
        deleteObject(sceneId, selectedObjectPath);
      }
```

Add `selectedObjectPath`, `sceneId`, `deleteObject` to that `useEffect`'s dependency array.

- [ ] **Step 3: Run unit suite + tsc (page compiles)**

Run: `npm test && npx tsc --noEmit -p .`
Expected: PASS (all vitest), tsc clean.

- [ ] **Step 4: Run the e2e if the local build works; otherwise note CI**

Run: `npm run test:e2e -- objects` (and `object-drag`).
Expected: PASS. If blocked by this worktree's incomplete `next` install, record it and rely on CI (same note as Task 5, Step 7).

- [ ] **Step 5: Commit**

```bash
git add app/editor/page.tsx app/editor/editor.css e2e/objects.spec.ts
git commit -m "feat(objects): add-object bar control + delete-key + objects e2e"
```

---

### Final verification

- [ ] **Run the whole unit suite**

Run: `npm test`
Expected: PASS — all vitest tests green, including the new `.test.ts`/`.test.tsx` files and no regressions in existing store/inspector tests.

- [ ] **Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: clean (0 errors).

- [ ] **e2e (CI or working local build)**

Run: `npm run test:e2e` if the local production build works; otherwise confirm CI runs `e2e/objects.spec.ts` + `e2e/object-drag.spec.ts` on a fresh `npm ci`. (`npm run build`'s page-data crash in this worktree is a known incomplete-`node_modules` issue, unrelated to this feature.)

---

## Notes for the executor

- **Authoring overlay only.** Do not touch `engine/authoring/seek.ts`, `engine/components/`, or the `Action` types. `ObjectsLayer` is an editor overlay; playback rendering of objects is sub-project #3.
- **No handles.** Do not add resize/rotate handles or a shared drag hook — that's #2b. #2a's only manipulation is body-drag-to-move.
- **No panel.** Do not build a layers panel, multi-select, or grouping UI — that's #2c. `group` is intentionally excluded from the add-object control.
- **One commit per drag.** The transient preview lives in component state; only pointer-up calls `updateObjectTransform`. A click that doesn't move must not create history (the mutation no-ops when the transform is unchanged).
- **Vitest is the gate; e2e may be CI-only in this worktree.** Never block a task on the known `next build` page-data crash — note it and proceed on green vitest + tsc.
```
