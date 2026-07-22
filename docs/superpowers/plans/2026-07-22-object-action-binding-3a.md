# Object ↔ Action Binding (3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three object-targeting timeline verbs (`obj_reveal`/`obj_move`/`obj_out`), their registry descriptors + an `objectRef` inspector field, the implicit-gating helper, dangling-`target` validation, and an object-centric "Animations" binding UI — with **no engine-render change**.

**Architecture:** Extends the existing tagged-`Action` union, the effect-descriptor registry, the pure Zustand mutations, and `validateDeckDoc` — following the `media`/`media_move`/`media_out` id-keyed precedent. All new logic is pure and unit-tested; the binding UI reuses the existing Inspector + `Field` + store action methods. Rendering of the verbs is deferred to sub-project 3b.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, Zustand editor store, Vitest (unit + jsdom component tests via @testing-library/react). Spec: [`docs/superpowers/specs/2026-07-22-object-action-binding-3a-design.md`](../specs/2026-07-22-object-action-binding-3a-design.md).

## Global Constraints

- **`DeckDoc.version` stays the literal `1`** — the new kinds + `target` field are additive union members (per `docs/superpowers/specs/deck-format-version-policy.md`). Object-less / verb-less decks must load and validate unchanged.
- **No engine-render change in 3a** — do **not** teach `seek.ts` `applyAt`/`renderBeatAt` or `CinematicSlide` to draw objects. Only `actionDuration` gains the new kinds (for timeline geometry).
- **Object ids** match `/^[a-z0-9][a-z0-9-]*$/`; a `target` resolves against **the scene that owns the beat**, including nested `group.children`.
- **Verb defaults:** `obj_reveal.in` = `"fade"`, `obj_out.out` = `"fade"`; default durations 600 / 800 / 500 ms (reveal / move / out).
- **Tests** live in `tests/unit/`, named `*.test.ts` (logic) / `*.test.tsx` (component). Local gate: `npm test` and `npx tsc --noEmit -p .`. (A fresh worktree may need `npm ci` first; never block on `next build`/Playwright locally.)
- **Commit** after each task's tests pass. TDD: failing test first.

---

## File Structure

**Create:**
- `lib/editor/object-gating.ts` — pure scene helpers: `revealedObjectIds`, `isGated`, `objectRefOptions`.
- `lib/editor/object-actions.ts` — pure `buildObjectAnimation(scene, objectId, kind)` verb builder.
- `components/editor/AnimationsPanel.tsx` — the object-centric "Animations" section.
- Tests: `tests/unit/action-duration-obj.test.ts`, `object-gating.test.ts`, `deck-doc-obj-targets.test.ts`, `registry-obj-verbs.test.ts`, `object-actions.test.ts`, `store-object-animation.test.ts`, `field-object-ref.test.tsx`, `animations-panel.test.tsx`, `layers-gated-hint.test.tsx`.

**Modify:**
- `engine/deck/types.ts` — new `ObjectMoveTarget`/`ObjectOut` types + 3 `Action` members.
- `engine/authoring/seek.ts` — `actionDuration` cases for the 3 kinds.
- `engine/deck-doc.ts` — beat-timeline `target` validation.
- `lib/editor/registry.ts` — `FieldType += "objectRef"`; 3 descriptors.
- `lib/editor/mutations.ts` — `insertActionAt(doc, flatIdx, index, action)`.
- `lib/editor/store.ts` — `addObjectAnimation(flatIdx, objectId, kind)`.
- `components/editor/Field.tsx` — render `objectRef` as a select.
- `components/editor/Inspector.tsx` — inject live object options into `objectRef` fields; mount `AnimationsPanel`.
- `components/editor/LayersPanel.tsx` (or `ObjectsLayer.tsx`) — a "gated" badge on gated objects.

---

### Task 1: Action types + durations

**Files:**
- Modify: `engine/deck/types.ts` (add types near `ObjectTransform` ~line 189; add union members in the `Action` union ~line 162, before `reveal_again`)
- Modify: `engine/authoring/seek.ts:29-42` (`actionDuration`)
- Test: `tests/unit/action-duration-obj.test.ts`

**Interfaces:**
- Produces: `interface ObjectMoveTarget { x?: number; y?: number; w?: number; h?: number; rot?: number }`; `type ObjectOut = "fade"`; `Action` members `{ kind:"obj_reveal"; target:string; in?:MediaIn; durationMs?:number }`, `{ kind:"obj_move"; target:string; to:ObjectMoveTarget; durationMs?:number }`, `{ kind:"obj_out"; target:string; out?:ObjectOut; durationMs?:number }`. `actionDuration` returns seconds for each.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/action-duration-obj.test.ts
import { expect, test } from "vitest";
import { actionDuration, isSeekable } from "@/engine/authoring/seek";
import type { Action } from "@/engine/deck/types";

test("obj verbs have default durations in seconds", () => {
  expect(actionDuration({ kind: "obj_reveal", target: "o" } as Action)).toBeCloseTo(0.6);
  expect(actionDuration({ kind: "obj_move", target: "o", to: {} } as Action)).toBeCloseTo(0.8);
  expect(actionDuration({ kind: "obj_out", target: "o" } as Action)).toBeCloseTo(0.5);
});

test("obj verbs honor an explicit durationMs", () => {
  expect(actionDuration({ kind: "obj_move", target: "o", to: {}, durationMs: 1200 } as Action)).toBeCloseTo(1.2);
});

test("obj verbs are seekable (pure tweens)", () => {
  expect(isSeekable({ kind: "obj_reveal", target: "o" } as Action)).toBe(true);
  expect(isSeekable({ kind: "obj_move", target: "o", to: {} } as Action)).toBe(true);
  expect(isSeekable({ kind: "obj_out", target: "o" } as Action)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/action-duration-obj.test.ts`
Expected: FAIL — TypeScript/`Action` has no `obj_reveal` member and `actionDuration` returns 0 for unknown kinds.

- [ ] **Step 3: Add the types to `engine/deck/types.ts`**

Add after the `ObjectTransform` interface (~line 189):

```ts
/** Partial object transform for obj_move: unspecified axes are left unchanged.
 *  x,y,w,h are 0–1 fractions of the stage; rot is degrees clockwise. */
export interface ObjectMoveTarget { x?: number; y?: number; w?: number; h?: number; rot?: number }

/** How an object exits (obj_out). Single member for now; extensible. */
export type ObjectOut = "fade";
```

Add to the `Action` union (just before `| { kind: "reveal_again" }` at ~line 162):

```ts
  // Object animation verbs (sub-project #3a). Each targets a Scene.objects node by its
  // scene-unique `id`. reveal = entrance, move = emphasis (move/scale/rotate), out = exit.
  // An object referenced by an obj_reveal anywhere in the scene starts hidden until that
  // reveal fires; an object no obj_reveal targets is visible from scene start.
  | { kind: "obj_reveal"; target: string; in?: MediaIn; durationMs?: number }
  | { kind: "obj_move"; target: string; to: ObjectMoveTarget; durationMs?: number }
  | { kind: "obj_out"; target: string; out?: ObjectOut; durationMs?: number }
```

- [ ] **Step 4: Add the duration cases to `engine/authoring/seek.ts`**

In `actionDuration`'s switch (before `default:` at line 40):

```ts
    case "obj_reveal": return (a.durationMs ?? 600) / 1000;
    case "obj_move": return (a.durationMs ?? 800) / 1000;
    case "obj_out": return (a.durationMs ?? 500) / 1000;
```

(`isSeekable` needs no change — it already returns `true` for any kind other than `note_emitter`/`note_circle`/`cue`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/action-duration-obj.test.ts` → Expected: PASS. Then `npx tsc --noEmit -p .` → Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add engine/deck/types.ts engine/authoring/seek.ts tests/unit/action-duration-obj.test.ts
git commit -m "feat(objects): obj_reveal/obj_move/obj_out action types + durations (#3a)"
```

---

### Task 2: Gating + objectRef-option helpers

**Files:**
- Create: `lib/editor/object-gating.ts`
- Test: `tests/unit/object-gating.test.ts`

**Interfaces:**
- Consumes: `Scene`, `Action` from `@/engine/deck/types`.
- Produces:
  - `revealedObjectIds(scene: Scene): Set<string>` — ids targeted by any `obj_reveal` in any beat.
  - `isGated(scene: Scene, objectId: string): boolean`.
  - `objectRefOptions(scene: Scene | undefined): { value: string; label: string }[]` — every object (incl. nested), `label = name ?? id`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/object-gating.test.ts
import { expect, test } from "vitest";
import { revealedObjectIds, isGated, objectRefOptions } from "@/lib/editor/object-gating";
import type { Scene } from "@/engine/deck/types";

const scene = (): Scene => ({
  id: "s1",
  objects: [
    { id: "logo", name: "Logo", kind: "image", src: "", transform: { x: 0, y: 0, w: 0.2, h: 0.2 } },
    { id: "grp", kind: "group", transform: { x: 0, y: 0, w: 1, h: 1 }, children: [
      { id: "cap", kind: "text", text: "hi", transform: { x: 0, y: 0, w: 0.3, h: 0.1 } },
    ] },
  ],
  beats: [
    { id: "b1", timeline: [{ kind: "obj_reveal", target: "cap" }] },
    { id: "b2", timeline: [{ kind: "obj_move", target: "logo", to: { x: 0.5 } }] },
  ],
});

test("revealedObjectIds collects obj_reveal targets across all beats", () => {
  expect(revealedObjectIds(scene())).toEqual(new Set(["cap"]));
});

test("isGated is true only for objects an obj_reveal targets", () => {
  const s = scene();
  expect(isGated(s, "cap")).toBe(true);   // revealed (nested child)
  expect(isGated(s, "logo")).toBe(false); // only moved, never revealed → visible from t=0
  expect(isGated(s, "grp")).toBe(false);
});

test("objectRefOptions lists every object incl. nested, label = name ?? id", () => {
  expect(objectRefOptions(scene())).toEqual([
    { value: "logo", label: "Logo" },
    { value: "grp", label: "grp" },
    { value: "cap", label: "cap" },
  ]);
});

test("objectRefOptions on an object-less scene is empty", () => {
  expect(objectRefOptions({ id: "s", beats: [] })).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/object-gating.test.ts`
Expected: FAIL — `Cannot find module '@/lib/editor/object-gating'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/editor/object-gating.ts
import type { Scene, SceneObject } from "@/engine/deck/types";

/** Ids of objects revealed by an obj_reveal in any beat of the scene. */
export function revealedObjectIds(scene: Scene): Set<string> {
  const ids = new Set<string>();
  for (const beat of scene.beats) {
    for (const a of beat.timeline) {
      if (a.kind === "obj_reveal" && typeof a.target === "string" && a.target) ids.add(a.target);
    }
  }
  return ids;
}

/** True iff the object starts hidden (some obj_reveal targets it). */
export function isGated(scene: Scene, objectId: string): boolean {
  return revealedObjectIds(scene).has(objectId);
}

/** {value,label} options for an objectRef field: every object incl. nested children. */
export function objectRefOptions(scene: Scene | undefined): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const walk = (list: SceneObject[]) => list.forEach((o) => {
    out.push({ value: o.id, label: o.name ?? o.id });
    if (o.kind === "group") walk(o.children);
  });
  if (scene?.objects) walk(scene.objects);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/object-gating.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/editor/object-gating.ts tests/unit/object-gating.test.ts
git commit -m "feat(objects): revealedObjectIds/isGated/objectRefOptions helpers (#3a)"
```

---

### Task 3: Dangling-`target` validation

**Files:**
- Modify: `engine/deck-doc.ts` (add a `validateSceneActionTargets` helper; call it from `validateDeckDoc`'s scene loop, ~line 69-73)
- Test: `tests/unit/deck-doc-obj-targets.test.ts`

**Interfaces:**
- Consumes: `validateDeckDoc(obj: unknown): { ok: boolean; errors: string[] }` (existing).
- Produces: extended `validateDeckDoc` that inspects `scene.beats[].timeline[]` for `obj_*` targets.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/deck-doc-obj-targets.test.ts
import { expect, test } from "vitest";
import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";

const base = (objects: unknown, timeline: unknown): DeckDoc => ({
  version: 1, meta: { id: "d", title: "D" },
  scenes: [{ id: "s1", objects, beats: [{ id: "b1", timeline }] }],
} as unknown as DeckDoc);

const OBJ = [{ id: "logo", kind: "image", src: "", transform: { x: 0, y: 0, w: 0.2, h: 0.2 } }];

test("accepts an obj_* action whose target exists in the scene", () => {
  expect(validateDeckDoc(base(OBJ, [{ kind: "obj_reveal", target: "logo", in: "fade" }])).ok).toBe(true);
});

test("rejects a dangling target (unknown id)", () => {
  const r = validateDeckDoc(base(OBJ, [{ kind: "obj_move", target: "ghost", to: { x: 0.5 } }]));
  expect(r.ok).toBe(false);
  expect(r.errors.join(" ")).toMatch(/ghost/);
});

test("rejects an empty target", () => {
  expect(validateDeckDoc(base(OBJ, [{ kind: "obj_out", target: "" }])).ok).toBe(false);
});

test("a target valid in another scene does not satisfy this scene", () => {
  const doc = {
    version: 1, meta: { id: "d", title: "D" }, scenes: [
      { id: "s1", objects: OBJ, beats: [{ id: "b1", timeline: [] }] },
      { id: "s2", objects: [], beats: [{ id: "b2", timeline: [{ kind: "obj_reveal", target: "logo" }] }] },
    ],
  } as unknown as DeckDoc;
  expect(validateDeckDoc(doc).ok).toBe(false);
});

test("rejects out-of-range / non-finite obj_move.to axes and negative duration", () => {
  expect(validateDeckDoc(base(OBJ, [{ kind: "obj_move", target: "logo", to: { x: 1.5 } }])).ok).toBe(false);
  expect(validateDeckDoc(base(OBJ, [{ kind: "obj_move", target: "logo", to: { w: 0 } }])).ok).toBe(false);
  expect(validateDeckDoc(base(OBJ, [{ kind: "obj_move", target: "logo", to: { rot: Infinity } }])).ok).toBe(false);
  expect(validateDeckDoc(base(OBJ, [{ kind: "obj_reveal", target: "logo", durationMs: -1 }])).ok).toBe(false);
});

test("legacy timelines without obj_* actions still validate", () => {
  expect(validateDeckDoc(base(OBJ, [{ kind: "text", value: "hi", in: "fade" }])).ok).toBe(true);
  expect(validateDeckDoc(base(undefined, [{ kind: "clear" }])).ok).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/deck-doc-obj-targets.test.ts`
Expected: FAIL — dangling/empty/range cases return `ok: true` today (timelines are not inspected).

- [ ] **Step 3: Add the validation helper to `engine/deck-doc.ts`**

**Do not import from `lib/editor/`** — `engine/` is the lower layer and must not depend on the editor. Inline a local id collector instead. Add this helper above `validateDeckDoc` (it reuses the `Scene`/`SceneObject` types; import `SceneObject` alongside the existing `Scene` import at line 1 if not already present):

```ts
const OBJ_TARGET_KINDS = new Set(["obj_reveal", "obj_move", "obj_out"]);

/** All object ids in a scene, including nested group children. */
function sceneObjectIds(objects: SceneObject[] | undefined): Set<string> {
  const ids = new Set<string>();
  const walk = (list: SceneObject[]) => list.forEach((o) => { ids.add(o.id); if (o.kind === "group") walk(o.children); });
  if (objects) walk(objects);
  return ids;
}

/** Validate obj_* action targets against the scene's object-id set, plus obj_move.to ranges. */
function validateSceneActionTargets(scene: Scene, si: number, e: string[]): void {
  const ids = sceneObjectIds(scene?.objects);
  scene?.beats?.forEach((b, bi) => {
    b?.timeline?.forEach((a: Record<string, unknown>, ai) => {
      if (typeof a?.kind !== "string" || !OBJ_TARGET_KINDS.has(a.kind)) return;
      const at = `scenes[${si}].beats[${bi}].timeline[${ai}]`;
      if (typeof a.target !== "string" || !a.target || !ids.has(a.target)) {
        e.push(`${at}: ${a.kind} target ${JSON.stringify(a.target)} is not an object in this scene`);
      }
      if (a.durationMs !== undefined && (typeof a.durationMs !== "number" || !Number.isFinite(a.durationMs) || a.durationMs < 0)) {
        e.push(`${at}.durationMs must be a finite number ≥ 0`);
      }
      if (a.kind === "obj_move") {
        const to = a.to as Record<string, unknown> | undefined;
        if (to && typeof to === "object") {
          for (const k of ["x", "y", "w", "h"] as const) {
            if (to[k] !== undefined && (typeof to[k] !== "number" || !Number.isFinite(to[k]) || (to[k] as number) < 0 || (to[k] as number) > 1)) e.push(`${at}.to.${k} must be 0–1`);
          }
          if (to.w !== undefined && (to.w as number) <= 0) e.push(`${at}.to.w must be > 0`);
          if (to.h !== undefined && (to.h as number) <= 0) e.push(`${at}.to.h must be > 0`);
          if (to.rot !== undefined && (typeof to.rot !== "number" || !Number.isFinite(to.rot))) e.push(`${at}.to.rot must be a finite number`);
        }
      }
    });
  });
}
```

- [ ] **Step 4: Call it from the scene loop**

In `validateDeckDoc`, inside `d.scenes.forEach((s, i) => { … })` (after the existing `validateSceneObjects(...)` call, ~line 72):

```ts
    validateSceneActionTargets(s, i, e);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/deck-doc-obj-targets.test.ts` → Expected: PASS. Then run the existing suite to confirm no regression: `npx vitest run tests/unit/deck-doc-objects.test.ts` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add engine/deck-doc.ts tests/unit/deck-doc-obj-targets.test.ts
git commit -m "feat(objects): dangling-target + obj_move.to validation in validateDeckDoc (#3a)"
```

---

### Task 4: Registry descriptors + `objectRef` field type

**Files:**
- Modify: `lib/editor/registry.ts` (`FieldType` line 3; add 3 entries to `REGISTRY`)
- Test: `tests/unit/registry-obj-verbs.test.ts`

**Interfaces:**
- Consumes: `descriptorFor(a)`, `REGISTRY`, `Field`, `FieldType` (existing).
- Produces: `FieldType` includes `"objectRef"`; `REGISTRY.obj_reveal/obj_move/obj_out` descriptors with `defaults()` returning the verbs (with `target: ""`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/registry-obj-verbs.test.ts
import { expect, test } from "vitest";
import { descriptorFor } from "@/lib/editor/registry";
import { getPath } from "@/lib/editor/paths";

test("each obj verb has a registry descriptor whose defaults set an empty target", () => {
  for (const kind of ["obj_reveal", "obj_move", "obj_out"] as const) {
    const d = descriptorFor({ kind });
    expect(d.kind).toBe(kind);
    expect(d.seekable).toBe(true);
    const def = d.defaults() as Record<string, unknown>;
    expect(def.kind).toBe(kind);
    expect(def.target).toBe("");
  }
});

test("obj_reveal defaults to a fade entrance and obj_move to an empty to", () => {
  expect((descriptorFor({ kind: "obj_reveal" }).defaults() as Record<string, unknown>).in).toBe("fade");
  expect((descriptorFor({ kind: "obj_move" }).defaults() as Record<string, unknown>).to).toEqual({});
});

test("every schema field key resolves via getPath on the default action", () => {
  for (const kind of ["obj_reveal", "obj_move", "obj_out"] as const) {
    const d = descriptorFor({ kind });
    const def = d.defaults();
    for (const f of d.schema) {
      expect(() => getPath(def, f.key)).not.toThrow();
    }
  }
});

test("the target field is typed objectRef", () => {
  expect(descriptorFor({ kind: "obj_reveal" }).schema.find((f) => f.key === "target")?.type).toBe("objectRef");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/registry-obj-verbs.test.ts`
Expected: FAIL — `descriptorFor({kind:"obj_reveal"})` falls to `GENERIC` (empty schema, no `target`).

- [ ] **Step 3: Update `FieldType` and add descriptors**

`lib/editor/registry.ts` line 3:

```ts
export type FieldType = "text" | "textarea" | "number" | "select" | "range" | "checkbox" | "objectRef";
```

Add these three entries to the `REGISTRY` object (after `media_move`, before the closing `};`):

```ts
  obj_reveal: { kind: "obj_reveal", label: "Reveal object", icon: "ti-eye", seekable: true, schema: [
    { key: "target", label: "Object", type: "objectRef" },
    { key: "in", label: "Entrance", type: "select", options: MEDIA_INS.map((v) => ({ value: v, label: v })) },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ], defaults: () => ({ kind: "obj_reveal", target: "", in: "fade" }) },
  obj_move: { kind: "obj_move", label: "Move object", icon: "ti-arrows-move", seekable: true, schema: [
    { key: "target", label: "Object", type: "objectRef" },
    { key: "to.x", label: "To X", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "to.y", label: "To Y", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "to.w", label: "To W", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "to.h", label: "To H", type: "number", min: 0, max: 1, step: 0.01 },
    { key: "to.rot", label: "To rotation°", type: "number", step: 1 },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ], defaults: () => ({ kind: "obj_move", target: "", to: {} }) },
  obj_out: { kind: "obj_out", label: "Remove object", icon: "ti-square-rounded-x", seekable: true, schema: [
    { key: "target", label: "Object", type: "objectRef" },
    { key: "durationMs", label: "Duration ms", type: "number", min: 0, step: 50 },
  ], defaults: () => ({ kind: "obj_out", target: "" }) },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/registry-obj-verbs.test.ts` → Expected: PASS. Then `npx tsc --noEmit -p .` → Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/editor/registry.ts tests/unit/registry-obj-verbs.test.ts
git commit -m "feat(objects): obj verb registry descriptors + objectRef field type (#3a)"
```

---

### Task 5: Pure verb builder + `insertActionAt` mutation

**Files:**
- Create: `lib/editor/object-actions.ts`
- Modify: `lib/editor/mutations.ts` (add `insertActionAt` beside `insertActionAfter` ~line 95)
- Test: `tests/unit/object-actions.test.ts`

**Interfaces:**
- Consumes: `descriptorFor` from `@/lib/editor/registry`; `findObjectPath`, `getObjectAt` from `@/lib/editor/object-tree`; `mapBeat` (existing, module-local in mutations.ts).
- Produces:
  - `buildObjectAnimation(scene: Scene, objectId: string, kind: "obj_reveal"|"obj_move"|"obj_out"): Action` — descriptor default with `target` set; for `obj_move`, `to` seeded from the object's current `{x,y}`.
  - `insertActionAt(doc: DeckDoc, flatIdx: number, index: number, action: Action): DeckDoc`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/object-actions.test.ts
import { expect, test } from "vitest";
import { buildObjectAnimation, insertActionAt } from "@/lib/editor/object-actions";
import type { DeckDoc } from "@/engine/deck-doc";
import type { Scene } from "@/engine/deck/types";

const scene = (): Scene => ({
  id: "s1",
  objects: [{ id: "logo", kind: "image", src: "", transform: { x: 0.3, y: 0.4, w: 0.2, h: 0.2 } }],
  beats: [{ id: "b1", timeline: [{ kind: "clear" }] }],
});

test("buildObjectAnimation sets target for each verb", () => {
  const s = scene();
  expect(buildObjectAnimation(s, "logo", "obj_reveal")).toMatchObject({ kind: "obj_reveal", target: "logo", in: "fade" });
  expect(buildObjectAnimation(s, "logo", "obj_out")).toMatchObject({ kind: "obj_out", target: "logo" });
});

test("buildObjectAnimation seeds obj_move.to from the object's current position", () => {
  const a = buildObjectAnimation(scene(), "logo", "obj_move") as { to: Record<string, number> };
  expect(a.to).toEqual({ x: 0.3, y: 0.4 });
});

test("insertActionAt inserts at the given index", () => {
  const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [scene()] };
  const action = buildObjectAnimation(doc.scenes[0], "logo", "obj_reveal");
  const next = insertActionAt(doc, 0, 1, action);
  expect(next.scenes[0].beats[0].timeline.map((a) => a.kind)).toEqual(["clear", "obj_reveal"]);
  expect(doc.scenes[0].beats[0].timeline).toHaveLength(1); // input untouched
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/object-actions.test.ts`
Expected: FAIL — `Cannot find module '@/lib/editor/object-actions'`.

- [ ] **Step 3: Add `insertActionAt` to `lib/editor/mutations.ts`**

Directly after `insertActionAfter` (~line 101):

```ts
/** Insert a pre-built action at `index` in the flat beat's timeline. */
export function insertActionAt(doc: DeckDoc, flatIdx: number, index: number, action: Action): DeckDoc {
  return mapBeat(doc, flatIdx, (b) => {
    const at = Math.max(0, Math.min(index, b.timeline.length));
    return { ...b, timeline: [...b.timeline.slice(0, at), action, ...b.timeline.slice(at)] };
  });
}
```

- [ ] **Step 4: Write `lib/editor/object-actions.ts`**

```ts
// lib/editor/object-actions.ts
import type { Action, Scene } from "@/engine/deck/types";
import { descriptorFor } from "@/lib/editor/registry";
import { findObjectPath, getObjectAt } from "@/lib/editor/object-tree";

export type ObjectVerbKind = "obj_reveal" | "obj_move" | "obj_out";

/** Build an obj_* verb targeting `objectId`; obj_move.to is seeded from the object's position. */
export function buildObjectAnimation(scene: Scene, objectId: string, kind: ObjectVerbKind): Action {
  const action = { ...descriptorFor({ kind }).defaults(), target: objectId } as Action & { target: string; to?: Record<string, number> };
  if (kind === "obj_move") {
    const path = findObjectPath(scene.objects ?? [], objectId);
    const obj = path ? getObjectAt(scene.objects ?? [], path) : undefined;
    if (obj) action.to = { x: obj.transform.x, y: obj.transform.y };
  }
  return action;
}

export { insertActionAt } from "@/lib/editor/mutations";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/object-actions.test.ts` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/editor/object-actions.ts lib/editor/mutations.ts tests/unit/object-actions.test.ts
git commit -m "feat(objects): buildObjectAnimation + insertActionAt mutation (#3a)"
```

---

### Task 6: Store `addObjectAnimation` method

**Files:**
- Modify: `lib/editor/store.ts` (type in the store interface ~line 41-48; implementation near `addAction` ~line 131)
- Test: `tests/unit/store-object-animation.test.ts`

**Interfaces:**
- Consumes: `buildObjectAnimation`, `insertActionAt` from `@/lib/editor/object-actions`; `beatLocation` (imported in store); `commit` helper (existing, module-local).
- Produces: store method `addObjectAnimation: (flatIdx: number, objectId: string, kind: ObjectVerbKind) => void` — appends the verb to the flat beat's timeline and selects it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/store-object-animation.test.ts
import { beforeEach, expect, test } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [{ id: "logo", kind: "image", src: "", transform: { x: 0.3, y: 0.4, w: 0.2, h: 0.2 } }],
    beats: [{ id: "b1", timeline: [{ kind: "clear" }] }] },
] });

beforeEach(() => useEditor.getState().load(doc()));

test("addObjectAnimation appends a targeted verb to the current beat and selects it", () => {
  useEditor.getState().addObjectAnimation(0, "logo", "obj_reveal");
  const tl = useEditor.getState().doc!.scenes[0].beats[0].timeline;
  expect(tl).toHaveLength(2);
  expect(tl[1]).toMatchObject({ kind: "obj_reveal", target: "logo" });
  expect(useEditor.getState().selectedAction).toBe(1);
});

test("addObjectAnimation for obj_move seeds to from the object position", () => {
  useEditor.getState().addObjectAnimation(0, "logo", "obj_move");
  const tl = useEditor.getState().doc!.scenes[0].beats[0].timeline;
  expect(tl[1]).toMatchObject({ kind: "obj_move", target: "logo", to: { x: 0.3, y: 0.4 } });
});

test("the append is undoable", () => {
  useEditor.getState().addObjectAnimation(0, "logo", "obj_out");
  useEditor.getState().undo();
  expect(useEditor.getState().doc!.scenes[0].beats[0].timeline).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/store-object-animation.test.ts`
Expected: FAIL — `addObjectAnimation is not a function`.

- [ ] **Step 3: Add the method to the store**

Import at the top of `lib/editor/store.ts` (near the other `object-*` imports):

```ts
import { buildObjectAnimation, insertActionAt, type ObjectVerbKind } from "./object-actions";
```

Add to the store's TS interface (near `addAction`, ~line 41):

```ts
  addObjectAnimation: (flatIdx: number, objectId: string, kind: ObjectVerbKind) => void;
```

Add the implementation (right after the `addAction` method, ~line 140):

```ts
  addObjectAnimation: (flatIdx, objectId, kind) => set((s) => {
    const loc = beatLocation(s.doc, flatIdx);
    if (!loc) return {};
    const scene = s.doc.scenes[loc.sceneIdx];
    const action = buildObjectAnimation(scene, objectId, kind);
    const index = scene.beats[loc.beatIdx].timeline.length;
    const part = commit(s, (doc) => insertActionAt(doc, flatIdx, index, action));
    return { ...part, selectedAction: index, selectedObjectPaths: [], enteredGroupPath: null };
  }),
```

> **Note (store shape, post-#2c):** the store uses a **selection set** — `selectedObjectPaths: ObjectPath[]` (not a singular `selectedObjectPath`) plus `enteredGroupPath`. Action-selecting methods clear both (`selectedObjectPaths: [], enteredGroupPath: null`), matching the existing `addAction`/`selectAction` returns. `selectObject(path)` still exists as a shim that sets `selectedObjectPaths: [path]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/store-object-animation.test.ts` → Expected: PASS. Then `npx tsc --noEmit -p .` → Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/editor/store.ts tests/unit/store-object-animation.test.ts
git commit -m "feat(objects): store addObjectAnimation append+select (#3a)"
```

---

### Task 7: `Field` renders `objectRef`; Inspector injects live options

**Files:**
- Modify: `components/editor/Field.tsx:25` (share the `select` branch for `objectRef`)
- Modify: `components/editor/Inspector.tsx` (augment `objectRef` field specs with scene options in the action-field map)
- Test: `tests/unit/field-object-ref.test.tsx`

**Interfaces:**
- Consumes: `objectRefOptions` from `@/lib/editor/object-gating`; existing `Field`, `getPath`, `updateAction`.
- Produces: an `objectRef` field renders a `<select>` of the scene's objects and writes the chosen id to the action's `target`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/field-object-ref.test.tsx
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Inspector } from "@/components/editor/Inspector";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1",
    objects: [
      { id: "logo", name: "Logo", kind: "image", src: "", transform: { x: 0, y: 0, w: 0.2, h: 0.2 } },
      { id: "cap", kind: "text", text: "hi", transform: { x: 0, y: 0, w: 0.3, h: 0.1 } },
    ],
    beats: [{ id: "b1", timeline: [{ kind: "obj_reveal", target: "logo", in: "fade" }] }] },
] });

beforeEach(() => useEditor.getState().load(doc()));
afterEach(cleanup);

test("objectRef field lists scene objects and writes the chosen id to target", () => {
  useEditor.getState().selectAction(0);
  render(<Inspector />);
  const select = screen.getByTestId("inspector").querySelector("select[data-testid='field-target']") as HTMLSelectElement;
  expect(Array.from(select.options).map((o) => o.value)).toEqual(["logo", "cap"]);
  expect(select.value).toBe("logo");
  fireEvent.change(select, { target: { value: "cap" } });
  expect(useEditor.getState().doc!.scenes[0].beats[0].timeline[0]).toMatchObject({ target: "cap" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/field-object-ref.test.tsx`
Expected: FAIL — no `select[data-testid='field-target']` (objectRef falls through to a text input; options not injected).

- [ ] **Step 3: Render `objectRef` as a select in `Field.tsx`**

Change the `select` branch condition (line 25) to also match `objectRef`, and add a `data-testid`:

```tsx
      ) : spec.type === "select" || spec.type === "objectRef" ? (
        <select data-testid={`field-${spec.key}`} style={base} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {spec.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
```

- [ ] **Step 4: Inject scene options in `Inspector.tsx`**

Add the import:

```ts
import { objectRefOptions } from "@/lib/editor/object-gating";
```

In the **action** render path, replace the field `.map(...)` (the one calling `updateAction`) with a version that augments `objectRef` specs:

```tsx
      {d.schema.map((f) => {
        const spec = f.type === "objectRef"
          ? { ...f, options: objectRefOptions(doc?.scenes.find((sc) => sc.id === sceneId)) }
          : f;
        return <Field key={f.key} spec={spec} value={getPath(action, f.key)} onChange={(v) => updateAction(selected, selectedAction!, f.key, v)} />;
      })}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/field-object-ref.test.tsx` → Expected: PASS. Confirm no regression: `npx vitest run tests/unit/inspector-objects.test.tsx` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/editor/Field.tsx components/editor/Inspector.tsx tests/unit/field-object-ref.test.tsx
git commit -m "feat(objects): objectRef field renders scene-object select (#3a)"
```

---

### Task 8: Animations panel (object-centric binding)

**Files:**
- Create: `components/editor/AnimationsPanel.tsx`
- Modify: `components/editor/Inspector.tsx` (mount `<AnimationsPanel .../>` in the object-selected branch, after the object fields)
- Test: `tests/unit/animations-panel.test.tsx`

**Interfaces:**
- Consumes: store `addObjectAnimation`, `selectAction`, `deleteAction`, `beats`, `selected`; `getObjectAt` for the selected object's id.
- Produces: `AnimationsPanel({ sceneId, objectPath }: { sceneId: string; objectPath: ObjectPath })` — Add entrance/emphasis/exit buttons + a list of current-beat obj_* actions targeting the object.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/animations-panel.test.tsx
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Inspector } from "@/components/editor/Inspector";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [{ id: "logo", kind: "image", src: "", transform: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 } }],
    beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => useEditor.getState().load(doc()));
afterEach(cleanup);

test("Add entrance appends an obj_reveal targeting the selected object", () => {
  useEditor.getState().selectObject([0]);
  render(<Inspector />);
  fireEvent.click(screen.getByTestId("add-entrance"));
  const tl = useEditor.getState().doc!.scenes[0].beats[0].timeline;
  expect(tl).toHaveLength(1);
  expect(tl[0]).toMatchObject({ kind: "obj_reveal", target: "logo" });
});

test("the panel lists only current-beat obj_* actions targeting this object", () => {
  useEditor.getState().load(doc());
  useEditor.getState().addObjectAnimation(0, "logo", "obj_reveal");
  useEditor.getState().selectObject([0]);
  render(<Inspector />);
  const rows = screen.getAllByTestId("anim-row");
  expect(rows).toHaveLength(1);
  expect(rows[0].textContent).toMatch(/reveal/i);
});

test("deleting an animation row removes the action", () => {
  useEditor.getState().load(doc());
  useEditor.getState().addObjectAnimation(0, "logo", "obj_out");
  useEditor.getState().selectObject([0]);
  render(<Inspector />);
  fireEvent.click(screen.getByTestId("anim-delete"));
  expect(useEditor.getState().doc!.scenes[0].beats[0].timeline).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/animations-panel.test.tsx`
Expected: FAIL — no `add-entrance` testid.

- [ ] **Step 3: Write `AnimationsPanel.tsx`**

```tsx
// components/editor/AnimationsPanel.tsx
"use client";
import { useEditor } from "@/lib/editor/store";
import { descriptorFor } from "@/lib/editor/registry";
import { getObjectAt, type ObjectPath } from "@/lib/editor/object-tree";
import type { ObjectVerbKind } from "@/lib/editor/object-actions";

const VERBS: { kind: ObjectVerbKind; label: string; testid: string }[] = [
  { kind: "obj_reveal", label: "Add entrance", testid: "add-entrance" },
  { kind: "obj_move", label: "Add emphasis", testid: "add-emphasis" },
  { kind: "obj_out", label: "Add exit", testid: "add-exit" },
];
const OBJ_KINDS = new Set(["obj_reveal", "obj_move", "obj_out"]);

export function AnimationsPanel({ sceneId, objectPath }: { sceneId: string; objectPath: ObjectPath }) {
  const doc = useEditor((s) => s.doc);
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const addObjectAnimation = useEditor((s) => s.addObjectAnimation);
  const selectAction = useEditor((s) => s.selectAction);
  const deleteAction = useEditor((s) => s.deleteAction);

  const objects = doc?.scenes.find((sc) => sc.id === sceneId)?.objects ?? [];
  const obj = getObjectAt(objects, objectPath);
  if (!obj) return null;
  const timeline = beats[selected]?.beat.timeline ?? [];
  const rows = timeline
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => OBJ_KINDS.has(a.kind) && (a as { target?: string }).target === obj.id);

  return (
    <div data-testid="animations-panel" style={{ marginTop: 14, borderTop: "1px solid var(--ed-line)", paddingTop: 11 }}>
      <div style={{ fontFamily: "var(--ed-disp)", fontSize: 12.5, marginBottom: 7 }}>Animations</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 9 }}>
        {VERBS.map((v) => (
          <button key={v.kind} data-testid={v.testid} className="ed__btn" style={{ fontSize: 11 }}
            onClick={() => addObjectAnimation(selected, obj.id, v.kind)}>{v.label}</button>
        ))}
      </div>
      {rows.length === 0 && <p style={{ opacity: 0.6, fontSize: 11 }}>No animations on this beat.</p>}
      {rows.map(({ a, i }) => (
        <div key={i} data-testid="anim-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <button className="ed__link" style={{ fontSize: 12 }} onClick={() => selectAction(i)}>{descriptorFor(a).label}</button>
          <button className="ed__icon" data-testid="anim-delete" title="Delete animation" onClick={() => deleteAction(selected, i)}>✕</button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Mount it in `Inspector.tsx`**

Add the import:

```ts
import { AnimationsPanel } from "./AnimationsPanel";
```

In the object-selected branch, immediately before the closing `</div>` of that return block (after the object `d.schema.map(...)`), add:

```tsx
          <AnimationsPanel sceneId={sceneId} objectPath={selectedObjectPath} />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/animations-panel.test.tsx` → Expected: PASS. Confirm no regression: `npx vitest run tests/unit/inspector-objects.test.tsx` → Expected: PASS. Then `npx tsc --noEmit -p .` → Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/editor/AnimationsPanel.tsx components/editor/Inspector.tsx tests/unit/animations-panel.test.tsx
git commit -m "feat(objects): object-centric Animations binding panel (#3a)"
```

---

### Task 9: "Gated" hint in the layers panel

**Files:**
- Modify: `components/editor/LayersPanel.tsx` (add a small badge on rows whose object is gated)
- Test: `tests/unit/layers-gated-hint.test.tsx`

**Interfaces:**
- Consumes: `isGated` from `@/lib/editor/object-gating`; the current scene from the store.
- Produces: a `data-testid="gated-badge"` element on layer rows for gated objects; no badge otherwise.

*(If `LayersPanel.tsx`'s row-rendering shape differs from the snippet below, adapt the marker placement to the existing row element — the behavior under test is "a badge appears iff `isGated` is true for that object id.")*

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/layers-gated-hint.test.tsx
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LayersPanel } from "@/components/editor/LayersPanel";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
      { id: "logo", kind: "image", src: "", transform: { x: 0, y: 0, w: 0.2, h: 0.2 } },
      { id: "cap", kind: "text", text: "hi", transform: { x: 0, y: 0, w: 0.3, h: 0.1 } },
    ],
    beats: [{ id: "b1", timeline: [{ kind: "obj_reveal", target: "cap" }] }] },
] });

beforeEach(() => useEditor.getState().load(doc()));
afterEach(cleanup);

test("a gated object (revealed by an obj_reveal) shows a gated badge; others do not", () => {
  render(<LayersPanel />);
  const badges = screen.queryAllByTestId("gated-badge");
  expect(badges).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/layers-gated-hint.test.tsx`
Expected: FAIL — no `gated-badge` rendered.

- [ ] **Step 3: Add the badge**

In `components/editor/LayersPanel.tsx`, add the import:

```ts
import { isGated } from "@/lib/editor/object-gating";
```

Add a `scene` lookup next to the existing `objects` lookup (after line 28, `const objects = …`):

```ts
  const scene = doc?.scenes.find((sc) => sc.id === sceneId);
```

Render the badge inside each row, immediately after the name `<span>`/rename `<input>` block (i.e., right before the `<span className="ed__layer-toggles">` at ~line 111):

```tsx
            {scene && isGated(scene, obj.id) && (
              <span data-testid="gated-badge" title="Hidden until revealed" style={{ fontSize: 9, opacity: 0.7, marginLeft: 4 }}>⏱</span>
            )}
```

(The row already exposes `obj` and `path` from `rows.map(({ obj, path, depth }) => …)`; `scene` carries the beats `isGated` reads.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/layers-gated-hint.test.tsx` → Expected: PASS. Then run the existing layers-panel test(s) to confirm no regression: `npx vitest run tests/unit/ -t layers` (or the specific file) → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/editor/LayersPanel.tsx tests/unit/layers-gated-hint.test.tsx
git commit -m "feat(objects): gated-until-revealed badge in layers panel (#3a)"
```

---

### Task 10: Full-suite gate + spec cross-check

**Files:** none (verification task).

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: PASS (all new + existing tests green).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Confirm no render code changed**

Run: `git diff --stat main -- engine/authoring/seek.ts engine/components/layouts/CinematicSlide.tsx`
Expected: `seek.ts` shows only the `actionDuration` additions; `CinematicSlide.tsx` unchanged. (3a ships no object rendering — that is 3b.)

- [ ] **Step 4: Commit any lint/formatting fixes if the project enforces them**

```bash
# only if `npm run lint` exists and reports fixables
git add -A && git commit -m "chore(objects): lint pass for #3a" || true
```

---

## Self-Review

**Spec coverage:**
- §3.1/3.2 new types + union members → Task 1. ✅
- §3.3 durations + seekability → Task 1. ✅
- §4 gating helper (`revealedObjectIds`/`isGated`) → Task 2 (badge consumer Task 9). ✅
- §5.1 `objectRef` FieldType → Task 4; render → Task 7. ✅
- §5.2 descriptors → Task 4. ✅
- §6 binding UI (Animations panel, add buttons, retargeting, objectRef injection) → Tasks 7–8. ✅
- §7 dangling-target + `obj_move.to` validation → Task 3. ✅
- §8 legacy coexistence → guarded by Task 3's "legacy timelines still validate" test + Task 10 Step 3 (no render change). ✅
- §9 testing (unit + component; no e2e) → every task is TDD; Task 10 is the full gate. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code. Task 9 carries an explicit adapt-to-existing-shape note (the only place the exact host markup isn't quoted, because `LayersPanel.tsx`'s row shape wasn't captured verbatim) — the test pins the behavior regardless.

**Type consistency:** `ObjectVerbKind` defined in Task 5 (`object-actions.ts`), reused in Tasks 6 & 8. `buildObjectAnimation`/`insertActionAt` signatures identical across Tasks 5–6. `addObjectAnimation(flatIdx, objectId, kind)` identical in Tasks 6 & 8. `objectRefOptions(scene)` defined Task 2, consumed Task 7. `field-<key>` testid convention consistent (Task 7 renderer → Task 7 test). `obj_reveal`/`obj_move`/`obj_out` kinds and `target: ""` defaults consistent across Tasks 1, 3, 4, 5.
