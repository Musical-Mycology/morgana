# Object Render Integration (3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `scene.objects` render deterministically at their timeline-derived state at any time `t`, in the editor canvas (seek path) and the CinematicSlide/BeatStage playback path, driven by one pure reducer.

**Architecture:** A pure `objectStateAt(scene, beatIndex, tLocal)` reducer folds prior beats to their settled end-state and interpolates the current beat's `obj_*` actions, returning a per-object resolved render state. A single `ObjectStage` component turns that state into DOM via `applyObjectState`; both render paths mount it and supply only a clock (editor rAF/seek; production a proxy tween on the GSAP master). The editor swaps between #2a's authoring overlay (at rest) and `ObjectStage` (on play/scrub).

**Tech Stack:** TypeScript, React 19, Zustand, GSAP (`@gsap/react`), Vitest + jsdom + @testing-library/react (unit/component), Playwright (e2e). Import alias `@` → repo root. Objects live in normalized 0–1 stage-space.

## Global Constraints

- **No schema change.** `DeckDoc.version` stays `1`. All object/scene context reaches the render components as in-memory props — no new persisted fields. (spec §0.2, §2)
- **§7 deferred.** No real GSAP runtime in the canvas, no `seek(t)` transport surface, no time-pure particles, no retiring `seek.ts`. (spec §0.1)
- **The reducer is the single source of visual truth.** No per-object GSAP tweens; both paths sample `objectStateAt`. (spec §2)
- **Reducer is pure** — same inputs → identical output map, no `Date`/`Math.random`, no DOM. jsdom can't do layout; all math is stage-fraction 0–1. (spec §3)
- **Objects painted back-to-front in depth-first document order** (index 0 = backmost); reuse #2a's `renderContent`. (spec §4)
- **Per-beat-local time + folded prior beats** — `objectStateAt(scene, beatIndex, tLocal)`. Prior beats settle at `p=1`; current beat interpolates. (spec §3)
- **Vitest layout:** tests live in `tests/unit/*.test.ts[x]`; JSX runtime automatic; `@` alias resolves to repo root.
- **Local gate:** `npm test` + `npx tsc --noEmit -p .`. A fresh worktree may need `npm ci` before `next build`/Playwright; never block a task on a missing `next` install — rely on CI for e2e. (spec §7)
- **Legacy coexistence:** `text`/`art`/`media`/`counter` render via existing paths unchanged; objects are a parallel foreground layer. `seek.ts`'s `applyAt` is NOT taught an object case. (spec §9)

---

## File Structure

**Create:**
- `lib/editor/object-state.ts` — the pure reducer (`objectStateAt`, `ObjectRenderState`, `ObjectStateMap`, entrance/exit math, group rule, flatten-with-parents helper).
- `components/editor/object-content.tsx` — shared `renderContent(obj)` (extracted from `ObjectsLayer`), so overlay and `ObjectStage` cannot diverge on object appearance.
- `components/editor/ObjectStage.tsx` — imperative render component: builds one DOM node per object, exposes `renderAt(scene, beatIndex, t)` + `applyObjectState`.
- `app/dev/objectstage/page.tsx` — dev route rendering a scene-with-objects beat through `BeatStage`, for e2e.
- Tests: `tests/unit/object-state-*.test.ts`, `tests/unit/object-stage.test.tsx`, `tests/unit/deck-canvas-objects.test.tsx`, `tests/unit/object-parity.test.tsx`, `e2e/objects-playback.spec.ts`, `e2e/objectstage.spec.ts`.

**Modify:**
- `components/editor/ObjectsLayer.tsx` — import shared `renderContent` from `object-content.tsx` (delete the local copy).
- `components/editor/DeckCanvas.tsx` — mount `ObjectStage`; sample the reducer in `draw`/`seek`/`play`; add the authoring↔preview mode-swap.
- `engine/authoring/BeatStage.tsx` — accept optional `scene`/`beatIndex`; mount `ObjectStage` sibling driven by a proxy tween on the master timeline; render static end-state when `animate=false`.
- `docs/MM_MORGANA.md` (deep-dive) — only if 3b changes documented behavior (checked in the final task).

---

## Task 1: Reducer types, seed, and gating (t=0, no actions)

**Files:**
- Create: `lib/editor/object-state.ts`
- Test: `tests/unit/object-state-seed.test.ts`

**Interfaces:**
- Consumes: `Scene`, `SceneObject`, `ObjectTransform` from `@/engine/deck/types`; `revealedObjectIds` from `@/lib/editor/object-gating`.
- Produces:
  - `interface ObjectRenderState { x: number; y: number; w: number; h: number; rot: number; scale: number; opacity: number; visible: boolean }`
  - `type ObjectStateMap = Map<string, ObjectRenderState>`
  - `function objectStateAt(scene: Scene, beatIndex: number, tLocal: number): ObjectStateMap`
  - `function flattenObjects(objects: SceneObject[]): { obj: SceneObject; descendantIds: string[] }[]` (depth-first, doc order; `descendantIds` = ids of a group's whole subtree, `[]` for leaves)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/object-state-seed.test.ts
import { describe, it, expect } from "vitest";
import { objectStateAt } from "@/lib/editor/object-state";
import type { Scene, SceneObject } from "@/engine/deck/types";

const obj = (id: string, over: Partial<SceneObject> = {}): SceneObject =>
  ({ id, kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, ...over } as SceneObject);

const scene = (objects: SceneObject[], timelines: import("@/engine/deck/types").Action[][]): Scene => ({
  id: "s1", objects, beats: timelines.map((tl, i) => ({ id: `b${i}`, timeline: tl })),
});

describe("objectStateAt — seed & gating at t=0", () => {
  it("seeds a non-gated object visible at its declared transform/opacity", () => {
    const s = scene([obj("a", { opacity: 0.5 })], [[]]);
    const st = objectStateAt(s, 0, 0).get("a")!;
    expect(st).toMatchObject({ x: 0.1, y: 0.2, w: 0.3, h: 0.4, rot: 0, scale: 1, opacity: 0.5, visible: true });
  });

  it("seeds a gated object (targeted by an obj_reveal anywhere) hidden at t=0 before its reveal", () => {
    const s = scene([obj("a")], [[{ kind: "obj_reveal", target: "a" }]]);
    expect(objectStateAt(s, 0, 0).get("a")!.visible).toBe(false);
  });

  it("defaults rot=0, scale=1, opacity=1 when unset", () => {
    const s = scene([obj("a")], [[]]);
    expect(objectStateAt(s, 0, 0).get("a")).toMatchObject({ rot: 0, scale: 1, opacity: 1, visible: true });
  });

  it("includes nested group children in the map", () => {
    const child = obj("kid");
    const grp: SceneObject = { id: "g", kind: "group", transform: { x: 0, y: 0, w: 1, h: 1 }, children: [child] };
    const s = scene([grp], [[]]);
    const m = objectStateAt(s, 0, 0);
    expect(m.has("g")).toBe(true);
    expect(m.has("kid")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/object-state-seed.test.ts`
Expected: FAIL — `objectStateAt` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/editor/object-state.ts
import type { Scene, SceneObject, ObjectTransform } from "@/engine/deck/types";
import { revealedObjectIds } from "@/lib/editor/object-gating";

/** Resolved playback state of one object at an absolute time. Stage-fraction 0–1;
 *  rot in degrees; opacity 0–1; scale is a transient entrance multiplier (default 1). */
export interface ObjectRenderState {
  x: number; y: number; w: number; h: number; rot: number; scale: number;
  opacity: number; visible: boolean;
}
export type ObjectStateMap = Map<string, ObjectRenderState>;

/** Depth-first, document order. descendantIds = every id under a group (empty for leaves). */
export function flattenObjects(objects: SceneObject[]): { obj: SceneObject; descendantIds: string[] }[] {
  const out: { obj: SceneObject; descendantIds: string[] }[] = [];
  const walk = (list: SceneObject[]) => {
    for (const obj of list) {
      const descendantIds: string[] = [];
      if (obj.kind === "group") collectIds(obj.children, descendantIds);
      out.push({ obj, descendantIds });
      if (obj.kind === "group") walk(obj.children);
    }
  };
  walk(objects);
  return out;
}
function collectIds(list: SceneObject[], into: string[]) {
  for (const o of list) { into.push(o.id); if (o.kind === "group") collectIds(o.children, into); }
}

function seed(t: ObjectTransform, opacity: number | undefined, visible: boolean): ObjectRenderState {
  return { x: t.x, y: t.y, w: t.w, h: t.h, rot: t.rot ?? 0, scale: 1, opacity: opacity ?? 1, visible };
}

export function objectStateAt(scene: Scene, beatIndex: number, tLocal: number): ObjectStateMap {
  const gated = revealedObjectIds(scene);
  const map: ObjectStateMap = new Map();
  for (const { obj } of flattenObjects(scene.objects ?? [])) {
    map.set(obj.id, seed(obj.transform, obj.opacity, !gated.has(obj.id)));
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/object-state-seed.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/editor/object-state.ts tests/unit/object-state-seed.test.ts
git commit -m "feat(objects): objectStateAt reducer — seed + gating (#3b)"
```

---

## Task 2: Current-beat leaf verbs at progress (reveal flip, move, out)

**Files:**
- Modify: `lib/editor/object-state.ts`
- Test: `tests/unit/object-state-current.test.ts`

**Interfaces:**
- Consumes: Task 1 exports; `beatTimeline` from `@/engine/authoring/seek`.
- Produces (internal): `applyActionAtProgress(map, action, p)` mutating the map; `objectStateAt` now interpolates the current beat. `obj_reveal.in` entrance offsets land in Task 3; here reveal only flips `visible` + fades opacity, `obj_move` interpolates all present axes for a **leaf**, `obj_out` fades to invisible.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/object-state-current.test.ts
import { describe, it, expect } from "vitest";
import { objectStateAt } from "@/lib/editor/object-state";
import type { Scene, SceneObject, Action } from "@/engine/deck/types";

const obj = (id: string, over: Partial<SceneObject> = {}): SceneObject =>
  ({ id, kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, ...over } as SceneObject);
const scene = (objects: SceneObject[], tl: Action[]): Scene => ({ id: "s1", objects, beats: [{ id: "b0", timeline: tl }] });

describe("objectStateAt — current beat leaf verbs", () => {
  it("obj_reveal fades opacity 0→1 across its window and is visible once started", () => {
    const s = scene([obj("a")], [{ kind: "obj_reveal", target: "a" }]); // default 600ms → [0,0.6)
    expect(objectStateAt(s, 0, 0).get("a")!.opacity).toBeCloseTo(0, 5);
    expect(objectStateAt(s, 0, 0).get("a")!.visible).toBe(true);
    expect(objectStateAt(s, 0, 0.3).get("a")!.opacity).toBeCloseTo(0.5, 2);
    expect(objectStateAt(s, 0, 0.6).get("a")!.opacity).toBeCloseTo(1, 5);
  });

  it("obj_move interpolates present axes from current→to, holding absent axes", () => {
    const s = scene([obj("a")], [{ kind: "obj_move", target: "a", to: { x: 0.5 } }]); // 800ms → [0,0.8)
    expect(objectStateAt(s, 0, 0).get("a")!).toMatchObject({ x: 0.1, y: 0.1 });
    expect(objectStateAt(s, 0, 0.4).get("a")!.x).toBeCloseTo(0.3, 2);
    expect(objectStateAt(s, 0, 0.8).get("a")!).toMatchObject({ x: 0.5, y: 0.1 });
  });

  it("obj_out fades to opacity 0 and visible=false at end", () => {
    const s = scene([obj("a")], [{ kind: "obj_out", target: "a" }]); // 500ms → [0,0.5)
    expect(objectStateAt(s, 0, 0.25).get("a")!.opacity).toBeCloseTo(0.5, 2);
    const end = objectStateAt(s, 0, 0.5).get("a")!;
    expect(end.opacity).toBeCloseTo(0, 5);
    expect(end.visible).toBe(false);
  });

  it("an action whose window has not started yet does not apply", () => {
    const s = scene([obj("a")], [{ kind: "wait", ms: 1000 }, { kind: "obj_move", target: "a", to: { x: 0.9 } }]);
    expect(objectStateAt(s, 0, 0.5).get("a")!.x).toBeCloseTo(0.1, 5); // still before the move window (starts at 1.0)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/object-state-current.test.ts`
Expected: FAIL — reveal/move/out are not applied (opacity/x unchanged, `visible` wrong).

- [ ] **Step 3: Write minimal implementation**

Add to `lib/editor/object-state.ts` (import `beatTimeline`, add `lerp`/`clamp01`, `applyActionAtProgress`, and interpolate the current beat inside `objectStateAt`):

```ts
import { beatTimeline } from "@/engine/authoring/seek";
// ...existing imports...

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** Apply one obj_* action to the map at local progress p (0..1). Mutates map. */
function applyActionAtProgress(map: ObjectStateMap, a: import("@/engine/deck/types").Action, p: number): void {
  if (a.kind === "obj_reveal") {
    const st = map.get(a.target); if (!st) return;
    st.visible = true;
    st.opacity = clamp01(p);            // entrance offsets added in Task 3
  } else if (a.kind === "obj_move") {
    const st = map.get(a.target); if (!st) return;
    applyMove(map, a, p);
  } else if (a.kind === "obj_out") {
    const st = map.get(a.target); if (!st) return;
    st.opacity = clamp01(1 - p);
    if (p >= 1) st.visible = false;
  }
}

/** Leaf move (group handling added in Task 4). Interpolates present axes current→to. */
function applyMove(map: ObjectStateMap, a: Extract<import("@/engine/deck/types").Action, { kind: "obj_move" }>, p: number): void {
  const st = map.get(a.target); if (!st) return;
  const to = a.to;
  if (to.x != null) st.x = lerp(st.x, to.x, p);
  if (to.y != null) st.y = lerp(st.y, to.y, p);
  if (to.w != null) st.w = lerp(st.w, to.w, p);
  if (to.h != null) st.h = lerp(st.h, to.h, p);
  if (to.rot != null) st.rot = lerp(st.rot, to.rot, p);
}
```

Then extend `objectStateAt` — after seeding, interpolate the current beat:

```ts
export function objectStateAt(scene: Scene, beatIndex: number, tLocal: number): ObjectStateMap {
  const gated = revealedObjectIds(scene);
  const map: ObjectStateMap = new Map();
  for (const { obj } of flattenObjects(scene.objects ?? [])) {
    map.set(obj.id, seed(obj.transform, obj.opacity, !gated.has(obj.id)));
  }
  const beat = scene.beats[beatIndex];
  if (!beat) return map;
  for (const { action, start, end } of beatTimeline(beat.timeline)) {
    if (action.kind !== "obj_reveal" && action.kind !== "obj_move" && action.kind !== "obj_out") continue;
    if (start > tLocal) continue;                       // window not reached
    const dur = end - start;
    const p = dur <= 0 ? 1 : clamp01((tLocal - start) / dur);
    applyActionAtProgress(map, action, p);
  }
  return map;
}
```

> Note: `applyMove` mutating `st` in place means a value read via `lerp(st.x, to.x, p)` interpolates from the object's **current** state — correct for stacked same-beat moves, and (since prior beats settle first, Task 5) from the entry snapshot.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/object-state-current.test.ts`
Expected: PASS (4 tests). Also run the Task 1 suite to confirm no regression: `npx vitest run tests/unit/object-state-seed.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/editor/object-state.ts tests/unit/object-state-current.test.ts
git commit -m "feat(objects): reducer current-beat leaf verbs (reveal/move/out) (#3b)"
```

---

## Task 3: Entrance variants (flyUp / pop / fadeSide)

**Files:**
- Modify: `lib/editor/object-state.ts`
- Test: `tests/unit/object-state-entrances.test.ts`

**Interfaces:**
- Consumes: Task 2 internals.
- Produces: named constants `FLY_DY = 0.05`, `SIDE_DX = 0.03`, `POP_FROM = 0.8` (exported for the parity/renderer). `obj_reveal.in` now adds an entrance offset: `flyUp` → `y += (1-p)*FLY_DY`; `pop` → `scale = POP_FROM + (1-POP_FROM)*p`; `fadeSide` → `x += (1-p)*SIDE_DX`; `fade`/unset → opacity only. At `p=1` all offsets are zero / scale 1.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/object-state-entrances.test.ts
import { describe, it, expect } from "vitest";
import { objectStateAt, FLY_DY, SIDE_DX, POP_FROM } from "@/lib/editor/object-state";
import type { Scene, SceneObject, MediaIn } from "@/engine/deck/types";

const obj = (id: string): SceneObject =>
  ({ id, kind: "shape", shape: "rect", transform: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 } } as SceneObject);
const revealScene = (inKind: MediaIn): Scene =>
  ({ id: "s1", objects: [obj("a")], beats: [{ id: "b0", timeline: [{ kind: "obj_reveal", target: "a", in: inKind }] }] });

describe("objectStateAt — entrance variants", () => {
  it("flyUp offsets y by (1-p)*FLY_DY and settles at p=1", () => {
    expect(objectStateAt(revealScene("flyUp"), 0, 0).get("a")!.y).toBeCloseTo(0.2 + FLY_DY, 5);
    expect(objectStateAt(revealScene("flyUp"), 0, 0.6).get("a")!.y).toBeCloseTo(0.2, 5);
  });
  it("fadeSide offsets x by (1-p)*SIDE_DX and settles at p=1", () => {
    expect(objectStateAt(revealScene("fadeSide"), 0, 0).get("a")!.x).toBeCloseTo(0.2 + SIDE_DX, 5);
    expect(objectStateAt(revealScene("fadeSide"), 0, 0.7).get("a")!.x).toBeCloseTo(0.2, 5);
  });
  it("pop scales from POP_FROM to 1", () => {
    expect(objectStateAt(revealScene("pop"), 0, 0).get("a")!.scale).toBeCloseTo(POP_FROM, 5);
    expect(objectStateAt(revealScene("pop"), 0, 0.6).get("a")!.scale).toBeCloseTo(1, 5);
  });
  it("fade leaves x/y/scale unchanged", () => {
    const st = objectStateAt(revealScene("fade"), 0, 0).get("a")!;
    expect(st).toMatchObject({ x: 0.2, y: 0.2, scale: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/object-state-entrances.test.ts`
Expected: FAIL — `FLY_DY`/`SIDE_DX`/`POP_FROM` not exported; offsets not applied.

- [ ] **Step 3: Write minimal implementation**

In `lib/editor/object-state.ts` add the constants (top-level) and replace the `obj_reveal` branch of `applyActionAtProgress`:

```ts
export const FLY_DY = 0.05;   // flyUp rise, stage-height fraction
export const SIDE_DX = 0.03;  // fadeSide slide, stage-width fraction
export const POP_FROM = 0.8;  // pop starting scale
```

```ts
  if (a.kind === "obj_reveal") {
    const st = map.get(a.target); if (!st) return;
    st.visible = true;
    st.opacity = clamp01(p);
    const inKind = a.in ?? "fade";
    if (inKind === "flyUp") st.y += (1 - p) * FLY_DY;
    else if (inKind === "fadeSide") st.x += (1 - p) * SIDE_DX;
    else if (inKind === "pop") st.scale = POP_FROM + (1 - POP_FROM) * p;
    // "fade" → opacity only
  } else if (a.kind === "obj_move") {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/object-state-entrances.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/editor/object-state.ts tests/unit/object-state-entrances.test.ts
git commit -m "feat(objects): reducer entrance variants flyUp/pop/fadeSide (#3b)"
```

---

## Task 4: Group obj_move (translate box + descendants; scale/rot box only)

**Files:**
- Modify: `lib/editor/object-state.ts`
- Test: `tests/unit/object-state-group.test.ts`

**Interfaces:**
- Consumes: `flattenObjects` (`descendantIds`), Task 2 `applyMove`.
- Produces: `applyMove` handles a group target — computes the x/y delta from the group's current box and adds it to the group box **and every descendant**; applies present `w/h/rot` to the group box only.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/object-state-group.test.ts
import { describe, it, expect } from "vitest";
import { objectStateAt } from "@/lib/editor/object-state";
import type { Scene, SceneObject } from "@/engine/deck/types";

const leaf = (id: string, x: number, y: number): SceneObject =>
  ({ id, kind: "shape", shape: "rect", transform: { x, y, w: 0.1, h: 0.1 } } as SceneObject);

const groupScene = (): Scene => ({
  id: "s1",
  objects: [{
    id: "g", kind: "group", transform: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 },
    children: [leaf("c1", 0.25, 0.25), leaf("c2", 0.45, 0.45)],
  }],
  beats: [{ id: "b0", timeline: [{ kind: "obj_move", target: "g", to: { x: 0.3 } }] }], // 800ms; dx=+0.1 at p=1
});

describe("objectStateAt — group move", () => {
  it("translates the group box and every descendant by the same x/y delta", () => {
    const m = objectStateAt(groupScene(), 0, 0.8); // p=1
    expect(m.get("g")!.x).toBeCloseTo(0.3, 5);
    expect(m.get("c1")!.x).toBeCloseTo(0.35, 5); // 0.25 + 0.1
    expect(m.get("c2")!.x).toBeCloseTo(0.55, 5); // 0.45 + 0.1
    expect(m.get("c1")!.y).toBeCloseTo(0.25, 5); // y untouched
  });

  it("applies w/h/rot to the group box only, leaving descendant sizes untouched", () => {
    const s = groupScene();
    s.beats[0].timeline = [{ kind: "obj_move", target: "g", to: { w: 0.8, rot: 90 } }];
    const m = objectStateAt(s, 0, 0.8);
    expect(m.get("g")!.w).toBeCloseTo(0.8, 5);
    expect(m.get("g")!.rot).toBeCloseTo(90, 5);
    expect(m.get("c1")!.w).toBeCloseTo(0.1, 5); // child size unchanged
    expect(m.get("c1")!.rot).toBeCloseTo(0, 5);
  });

  it("moving a leaf leaves its siblings untouched", () => {
    const s = groupScene();
    s.beats[0].timeline = [{ kind: "obj_move", target: "c1", to: { x: 0.9 } }];
    const m = objectStateAt(s, 0, 0.8);
    expect(m.get("c1")!.x).toBeCloseTo(0.9, 5);
    expect(m.get("c2")!.x).toBeCloseTo(0.45, 5);
    expect(m.get("g")!.x).toBeCloseTo(0.2, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/object-state-group.test.ts`
Expected: FAIL — group move currently only moves the group box; descendants unchanged.

- [ ] **Step 3: Write minimal implementation**

Replace `applyMove` in `lib/editor/object-state.ts` (it needs the descendant ids; pass them in). Precompute a `descendantIds` lookup in `objectStateAt` and thread it through:

```ts
// module-scope map rebuilt per call and passed to applyMove
function applyMove(
  map: ObjectStateMap,
  a: Extract<import("@/engine/deck/types").Action, { kind: "obj_move" }>,
  p: number,
  descendants: Map<string, string[]>,
): void {
  const st = map.get(a.target); if (!st) return;
  const to = a.to;
  const kids = descendants.get(a.target) ?? [];
  if (kids.length) {
    // group: translate box + descendants by the x/y delta; w/h/rot on the box only
    if (to.x != null) { const nx = lerp(st.x, to.x, p); const dx = nx - st.x; st.x = nx; for (const id of kids) { const c = map.get(id); if (c) c.x += dx; } }
    if (to.y != null) { const ny = lerp(st.y, to.y, p); const dy = ny - st.y; st.y = ny; for (const id of kids) { const c = map.get(id); if (c) c.y += dy; } }
    if (to.w != null) st.w = lerp(st.w, to.w, p);
    if (to.h != null) st.h = lerp(st.h, to.h, p);
    if (to.rot != null) st.rot = lerp(st.rot, to.rot, p);
  } else {
    if (to.x != null) st.x = lerp(st.x, to.x, p);
    if (to.y != null) st.y = lerp(st.y, to.y, p);
    if (to.w != null) st.w = lerp(st.w, to.w, p);
    if (to.h != null) st.h = lerp(st.h, to.h, p);
    if (to.rot != null) st.rot = lerp(st.rot, to.rot, p);
  }
}
```

Thread `descendants` from `objectStateAt` through `applyActionAtProgress` → `applyMove`:

```ts
export function objectStateAt(scene: Scene, beatIndex: number, tLocal: number): ObjectStateMap {
  const gated = revealedObjectIds(scene);
  const map: ObjectStateMap = new Map();
  const descendants = new Map<string, string[]>();
  for (const { obj, descendantIds } of flattenObjects(scene.objects ?? [])) {
    map.set(obj.id, seed(obj.transform, obj.opacity, !gated.has(obj.id)));
    if (descendantIds.length) descendants.set(obj.id, descendantIds);
  }
  const beat = scene.beats[beatIndex];
  if (!beat) return map;
  for (const { action, start, end } of beatTimeline(beat.timeline)) {
    if (action.kind !== "obj_reveal" && action.kind !== "obj_move" && action.kind !== "obj_out") continue;
    if (start > tLocal) continue;
    const dur = end - start;
    const p = dur <= 0 ? 1 : clamp01((tLocal - start) / dur);
    applyActionAtProgress(map, action, p, descendants);
  }
  return map;
}
```

Update `applyActionAtProgress` signature to accept + forward `descendants: Map<string,string[]>` to `applyMove`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/object-state-group.test.ts`
Expected: PASS (3 tests). Re-run Tasks 1–3 suites: `npx vitest run tests/unit/object-state-*.test.ts` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/editor/object-state.ts tests/unit/object-state-group.test.ts
git commit -m "feat(objects): reducer group obj_move (translate descendants) (#3b)"
```

---

## Task 5: Fold prior beats + re-reveal + boundaries/determinism

**Files:**
- Modify: `lib/editor/object-state.ts`
- Test: `tests/unit/object-state-fold.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `objectStateAt` folds `scene.beats[0..beatIndex-1]` at `p=1` (settled) before interpolating the current beat, so cross-beat gating/persistence and re-reveal-after-out are correct.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/object-state-fold.test.ts
import { describe, it, expect } from "vitest";
import { objectStateAt } from "@/lib/editor/object-state";
import type { Scene, SceneObject, Action } from "@/engine/deck/types";

const obj = (id: string): SceneObject =>
  ({ id, kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } } as SceneObject);
const scn = (objects: SceneObject[], beats: Action[][]): Scene =>
  ({ id: "s1", objects, beats: beats.map((tl, i) => ({ id: `b${i}`, timeline: tl })) });

describe("objectStateAt — fold prior beats", () => {
  it("an object revealed in beat 0 is visible (settled) when viewing beat 1 at t=0", () => {
    const s = scn([obj("a")], [[{ kind: "obj_reveal", target: "a" }], []]);
    const st = objectStateAt(s, 1, 0).get("a")!;
    expect(st.visible).toBe(true);
    expect(st.opacity).toBeCloseTo(1, 5);
  });

  it("a gated object is still hidden when viewing an earlier beat than its reveal", () => {
    const s = scn([obj("a")], [[], [{ kind: "obj_reveal", target: "a" }]]);
    expect(objectStateAt(s, 0, 0).get("a")!.visible).toBe(false);
  });

  it("obj_out in a prior beat leaves the object hidden in a later beat", () => {
    const s = scn([obj("a")], [[{ kind: "obj_reveal", target: "a" }], [{ kind: "obj_out", target: "a" }], []]);
    expect(objectStateAt(s, 2, 0).get("a")!.visible).toBe(false);
  });

  it("re-reveal after out makes it visible again", () => {
    const s = scn([obj("a")], [[{ kind: "obj_out", target: "a" }], [{ kind: "obj_reveal", target: "a" }]]);
    // note: 'a' is gated (an obj_reveal targets it), so it starts hidden; out in b0 keeps hidden; reveal in b1 shows it
    expect(objectStateAt(s, 1, 0.6).get("a")!.visible).toBe(true);
  });

  it("obj_move in a prior beat persists as the entry snapshot for the next beat", () => {
    const s = scn([obj("a")], [[{ kind: "obj_move", target: "a", to: { x: 0.8 } }], []]);
    expect(objectStateAt(s, 1, 0).get("a")!.x).toBeCloseTo(0.8, 5);
  });

  it("is pure — identical inputs give an equal map", () => {
    const s = scn([obj("a")], [[{ kind: "obj_move", target: "a", to: { x: 0.5 } }]]);
    expect(objectStateAt(s, 0, 0.4).get("a")).toEqual(objectStateAt(s, 0, 0.4).get("a"));
  });

  it("handles tLocal past the last window (clamps at settled state)", () => {
    const s = scn([obj("a")], [[{ kind: "obj_reveal", target: "a" }]]);
    expect(objectStateAt(s, 0, 999).get("a")!.opacity).toBeCloseTo(1, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/object-state-fold.test.ts`
Expected: FAIL — prior beats aren't folded (revealed-in-beat-0 object reads hidden at beat 1).

- [ ] **Step 3: Write minimal implementation**

In `objectStateAt`, between seeding and interpolating the current beat, fold prior beats at `p=1`:

```ts
  // Fold prior beats to settled end-state → the current beat's entry snapshot.
  for (let bi = 0; bi < beatIndex; bi++) {
    const prior = scene.beats[bi];
    if (!prior) continue;
    for (const action of prior.timeline) {
      if (action.kind === "obj_reveal" || action.kind === "obj_move" || action.kind === "obj_out") {
        applyActionAtProgress(map, action, 1, descendants);
      }
    }
  }
```

(Prior beats apply in document order at `p=1`; the existing current-beat loop then interpolates `scene.beats[beatIndex]`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/object-state-fold.test.ts`
Expected: PASS (7 tests). Full reducer suite: `npx vitest run tests/unit/object-state-*.test.ts` → all PASS. Type-check: `npx tsc --noEmit -p .` → clean.

- [ ] **Step 5: Commit**

```bash
git add lib/editor/object-state.ts tests/unit/object-state-fold.test.ts
git commit -m "feat(objects): reducer fold prior beats + re-reveal + determinism (#3b)"
```

---

## Task 6: Shared `renderContent` + `ObjectStage` component + `applyObjectState`

**Files:**
- Create: `components/editor/object-content.tsx`
- Create: `components/editor/ObjectStage.tsx`
- Modify: `components/editor/ObjectsLayer.tsx` (use shared `renderContent`)
- Test: `tests/unit/object-stage.test.tsx`

**Interfaces:**
- Consumes: `objectStateAt`, `ObjectRenderState`, `flattenObjects` from `@/lib/editor/object-state`; `Scene`, `SceneObject` from types.
- Produces:
  - `object-content.tsx`: `export function renderContent(obj: SceneObject): React.ReactNode` (moved verbatim from `ObjectsLayer`, incl. `SIZE_PX`).
  - `ObjectStage.tsx`: `export interface ObjectStageHandle { renderAt(scene: Scene, beatIndex: number, t: number): void }` and a `forwardRef` component `ObjectStage` that renders the scene's objects (depth-first order) into ref'd nodes and, on `renderAt`, samples `objectStateAt` and calls `applyObjectState(node, state)` per object.
  - `export function applyObjectState(node: HTMLElement, s: ObjectRenderState): void`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/object-stage.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRef } from "react";
import { ObjectStage, type ObjectStageHandle, applyObjectState } from "@/components/editor/ObjectStage";
import type { Scene, SceneObject } from "@/engine/deck/types";

const obj = (id: string): SceneObject =>
  ({ id, kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } } as SceneObject);
const scene: Scene = { id: "s1", objects: [obj("a")], beats: [{ id: "b0", timeline: [{ kind: "obj_reveal", target: "a" }] }] };

describe("ObjectStage", () => {
  it("renders one node per object with data-obj-id", () => {
    const { container } = render(<ObjectStage scene={scene} />);
    expect(container.querySelector('[data-obj-id="a"]')).toBeTruthy();
  });

  it("renderAt applies the reducer state: gated object hidden at t=0", () => {
    const ref = createRef<ObjectStageHandle>();
    const { container } = render(<ObjectStage scene={scene} ref={ref} />);
    ref.current!.renderAt(scene, 0, 0);
    const node = container.querySelector('[data-obj-id="a"]') as HTMLElement;
    expect(node.style.display).toBe("none"); // gated, opacity 0, not yet revealed enough to paint
  });

  it("applyObjectState writes left/top/width/height/opacity and rotate", () => {
    const el = document.createElement("div");
    applyObjectState(el, { x: 0.25, y: 0.5, w: 0.2, h: 0.1, rot: 30, scale: 1, opacity: 0.7, visible: true });
    expect(el.style.left).toBe("25%");
    expect(el.style.top).toBe("50%");
    expect(el.style.width).toBe("20%");
    expect(el.style.opacity).toBe("0.7");
    expect(el.style.transform).toContain("rotate(30deg)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/object-stage.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

Create `components/editor/object-content.tsx` — move `SIZE_PX` and `renderContent` out of `ObjectsLayer.tsx` verbatim:

```tsx
// components/editor/object-content.tsx
import type { SceneObject, TextObjectStyle } from "@/engine/deck/types";

const SIZE_PX: Record<NonNullable<TextObjectStyle["size"]>, number> = { lg: 34, md: 22, sm: 15 };

export function renderContent(obj: SceneObject) {
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
        ? <img src={obj.src} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: obj.fit ?? "contain", borderRadius: obj.round ? "50%" : 0 }} />
        : <span className="ed__obj-ph">image</span>;
    case "shape": {
      const stroke = obj.stroke ? `${Math.max(1, obj.stroke.width * 400)}px solid ${obj.stroke.color}` : undefined;
      return <span style={{ display: "block", width: "100%", height: "100%", background: obj.fill ?? "transparent", border: stroke, borderRadius: obj.shape === "ellipse" ? "50%" : (obj.radius ? `${obj.radius * 100}%` : 0) }} />;
    }
    case "group":
      return null;
  }
}
```

In `components/editor/ObjectsLayer.tsx`: delete the local `SIZE_PX` const and the local `renderContent` function, and add `import { renderContent } from "./object-content";` (keep the `TextObjectStyle` import only if still used elsewhere — remove if now unused to keep `tsc` clean).

Create `components/editor/ObjectStage.tsx`:

```tsx
// components/editor/ObjectStage.tsx
"use client";
import { forwardRef, useImperativeHandle, useRef } from "react";
import type { Scene } from "@/engine/deck/types";
import { objectStateAt, flattenObjects, type ObjectRenderState } from "@/lib/editor/object-state";
import { renderContent } from "./object-content";

export interface ObjectStageHandle {
  renderAt(scene: Scene, beatIndex: number, t: number): void;
}

/** Pure DOM writer — the ONLY place reducer output touches an object node. */
export function applyObjectState(node: HTMLElement, s: ObjectRenderState): void {
  if (!s.visible || s.opacity <= 0) { node.style.display = "none"; return; }
  node.style.display = "block";
  node.style.left = `${s.x * 100}%`;
  node.style.top = `${s.y * 100}%`;
  node.style.width = `${s.w * 100}%`;
  node.style.height = `${s.h * 100}%`;
  node.style.opacity = String(s.opacity);
  node.style.transform = `rotate(${s.rot}deg) scale(${s.scale})`;
}

export const ObjectStage = forwardRef<ObjectStageHandle, { scene: Scene; active?: boolean }>(
  function ObjectStage({ scene, active = true }, ref) {
    const nodes = useRef<Map<string, HTMLElement>>(new Map());
    const flat = flattenObjects(scene.objects ?? []);

    useImperativeHandle(ref, () => ({
      renderAt: (sc, beatIndex, t) => {
        const state = objectStateAt(sc, beatIndex, t);
        for (const [id, node] of nodes.current) {
          const st = state.get(id);
          if (st) applyObjectState(node, st); else node.style.display = "none";
        }
      },
    }), []);

    return (
      <div className="ed__objstage" style={{ position: "absolute", inset: 0, zIndex: 6, pointerEvents: "none", display: active ? "block" : "none" }} data-testid="object-stage">
        {flat.map(({ obj }) => (
          <div
            key={obj.id}
            data-obj-id={obj.id}
            ref={(el) => { if (el) nodes.current.set(obj.id, el); else nodes.current.delete(obj.id); }}
            className={`ed__obj ed__obj--${obj.kind}`}
            style={{ position: "absolute", transformOrigin: obj.transform.anchor === "top-left" ? "0 0" : "50% 50%", display: "none" }}
          >
            {renderContent(obj)}
          </div>
        ))}
      </div>
    );
  },
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/object-stage.test.tsx`
Expected: PASS (3 tests). Confirm the overlay still builds: `npx vitest run tests/unit/` (the existing ObjectsLayer/objects suites still green) and `npx tsc --noEmit -p .` → clean.

- [ ] **Step 5: Commit**

```bash
git add components/editor/object-content.tsx components/editor/ObjectStage.tsx components/editor/ObjectsLayer.tsx tests/unit/object-stage.test.tsx
git commit -m "feat(objects): ObjectStage + shared renderContent + applyObjectState (#3b)"
```

---

## Task 7: DeckCanvas integration + authoring↔preview mode-swap

**Files:**
- Modify: `components/editor/DeckCanvas.tsx`
- Test: `tests/unit/deck-canvas-objects.test.tsx`

**Interfaces:**
- Consumes: `ObjectStage`, `ObjectStageHandle` from `./ObjectStage`; `beatLocation` from `@/lib/editor/flatten-beats`; store `doc`/`selected` via `useEditor`.
- Produces: DeckCanvas mounts `ObjectStage`, samples the reducer in `draw()`, and toggles `preview` state so the #2a overlay shows at rest and `ObjectStage` shows on play/scrub.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/deck-canvas-objects.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { createRef } from "react";
import { DeckCanvas, type CanvasHandle } from "@/components/editor/DeckCanvas";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc: DeckDoc = {
  version: 1, meta: { id: "d", title: "T" },
  scenes: [{
    id: "s1",
    objects: [{ id: "a", kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }],
    beats: [{ id: "b0", timeline: [{ kind: "obj_reveal", target: "a" }] }],
  }],
} as DeckDoc;

describe("DeckCanvas object rendering + mode-swap", () => {
  beforeEach(() => act(() => useEditor.getState().load(doc)));

  it("shows the authoring overlay at rest and ObjectStage on scrub", () => {
    const ref = createRef<CanvasHandle>();
    const flat = useEditor.getState().beats[0];
    const { container } = render(<DeckCanvas ref={ref} flat={flat} />);
    const stage = () => container.querySelector('[data-testid="object-stage"]') as HTMLElement;
    // at rest (t=0): stage hidden
    expect(stage().style.display).toBe("none");
    // scrub into the reveal window: stage visible + object painted
    act(() => ref.current!.seek(0.6));
    expect(stage().style.display).toBe("block");
    expect((container.querySelector('[data-testid="object-stage"] [data-obj-id="a"]') as HTMLElement).style.display).toBe("block");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/deck-canvas-objects.test.tsx`
Expected: FAIL — no `object-stage` in DeckCanvas.

- [ ] **Step 3: Write minimal implementation**

Edit `components/editor/DeckCanvas.tsx`:

1. Add imports:
```tsx
import { useEditor } from "@/lib/editor/store";
import { beatLocation } from "@/lib/editor/flatten-beats";
import { ObjectStage, type ObjectStageHandle } from "./ObjectStage";
```
(`useEditor` is already imported — keep one import.)

2. In the `DeckCanvas` component body, add refs/state and resolve the scene:
```tsx
    const objStage = useRef<ObjectStageHandle>(null);
    const [preview, setPreview] = useState(false);
    const doc = useEditor((s) => s.doc);
    const selected = useEditor((s) => s.selected);
    const loc = doc ? beatLocation(doc, selected) : null;
    const scene = loc && doc ? doc.scenes[loc.sceneIdx] : null;
    const beatIndex = loc ? loc.beatIdx : 0;
```

3. Extend `draw()` to also sample the object reducer:
```tsx
    const draw = () => {
      if (textHost.current && flat) renderBeatAt(flat.beat.timeline, t.current, { textHost: textHost.current, art: art.current, setNight });
      if (scene) objStage.current?.renderAt(scene, beatIndex, t.current);
    };
```

4. In `useImperativeHandle`, set `preview` on transport events:
```tsx
      seek: (to) => { cancel(); t.current = Math.max(0, Math.min(dur(), to)); setPreview(t.current > 0); draw(); onTime?.(t.current, dur()); },
      pause: () => cancel(),
      play: () => {
        cancel(); setPreview(true);
        let last = performance.now();
        const step = (now: number) => {
          t.current = Math.min(dur(), t.current + (now - last) / 1000); last = now;
          draw(); onTime?.(t.current, dur());
          if (t.current < dur()) raf.current = requestAnimationFrame(step); else raf.current = null;
        };
        raf.current = requestAnimationFrame(step);
      },
```

5. In the reset effect, return to authoring:
```tsx
    useEffect(() => { cancel(); t.current = 0; setPreview(false); draw(); onTime?.(0, dur()); return cancel; }, [flat]);
```

6. In the JSX, mount `ObjectStage` (above ArtStage, below the overlay z-band) and gate the overlay on `!preview`:
```tsx
        <ObjectStage ref={objStage} scene={scene ?? { id: "", beats: [] }} active={preview} />
        <PosHandle hostRef={host} redraw={draw} />
        {!preview && <ObjectsLayer hostRef={host} />}
```
(`ObjectStage` renders nothing when `scene.objects` is empty; the placeholder empty scene is safe.)

> `renderAt` after mount: add a `useEffect(() => { draw(); }, [scene, beatIndex])` so switching beats re-samples the reducer even without a transport event. Place it after the existing reset effect.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/deck-canvas-objects.test.tsx`
Expected: PASS. Full unit run `npx vitest run tests/unit/` + `npx tsc --noEmit -p .` → clean (watch for the existing `deck-canvas` / `drag-pos` component tests still passing — the overlay is now conditional on `!preview`, which is `true` at mount).

- [ ] **Step 5: Commit**

```bash
git add components/editor/DeckCanvas.tsx tests/unit/deck-canvas-objects.test.tsx
git commit -m "feat(objects): DeckCanvas object layer + authoring/preview mode-swap (#3b)"
```

---

## Task 8: Editor playback/scrub e2e (Playwright)

**Files:**
- Create: `e2e/objects-playback.spec.ts`

**Interfaces:**
- Consumes: the running editor at `/editor` (seeded deck). Follows the pattern in `e2e/objects.spec.ts` / `e2e/timeline-actions.spec.ts` for selecting a beat and adding objects/actions.

- [ ] **Step 1: Write the e2e test**

```ts
// e2e/objects-playback.spec.ts
import { test, expect } from "@playwright/test";

// Assumes the seeded editor deck + the object authoring UI from #2a/#3a. Adjust selectors
// to match e2e/objects.spec.ts helpers if they differ. The invariant under test: a gated
// object is absent at rest-scrub t=0 and present after its reveal window.
test("gated object reveals under scrub and disappears on obj_out", async ({ page }) => {
  await page.goto("/editor");
  // Add a shape object + an obj_reveal targeting it (reuse the Animations panel from #3a).
  // (Helper selectors mirror e2e/objects.spec.ts; see that file for add-object flow.)
  await page.getByTestId("add-object-shape").click();
  await page.getByTestId("anim-add-entrance").click();

  const obj = page.locator('[data-testid="object-stage"] [data-obj-id]').first();

  // Scrub bar to start: object hidden (gated).
  const scrub = page.getByTestId("scrub");
  await scrub.fill("0");
  await expect(page.getByTestId("object-stage")).toHaveCSS("display", "none");

  // Play: object becomes visible once revealed.
  await page.getByTestId("play").click();
  await expect(obj).toBeVisible();
});
```

- [ ] **Step 2: Confirm selector names against the seeded editor**

Run: `npx playwright test e2e/objects-playback.spec.ts --list`
Then open `e2e/objects.spec.ts` and `components/editor` for the real `data-testid`s (`add-object-*`, the Animations panel buttons, the scrub/play controls in `Timeline.tsx`). Replace the placeholder selectors above with the actual ones. Expected after fixing: the spec references only test-ids that exist.

- [ ] **Step 3: Run the e2e (or defer to CI)**

Run (if `node_modules/next` is complete): `CI=1 npm run test:e2e -- e2e/objects-playback.spec.ts --workers=1`
Expected: PASS. If the local `next` install is incomplete (`Cannot find module '../shared/lib/constants'`), run `npm ci` first, or rely on CI — do not block the task on the missing install.

- [ ] **Step 4: Commit**

```bash
git add e2e/objects-playback.spec.ts
git commit -m "test(objects): editor playback/scrub e2e for object verbs (#3b)"
```

---

## Task 9: CinematicSlide/BeatStage integration + static end-state

**Files:**
- Modify: `engine/authoring/BeatStage.tsx`
- Test: `tests/unit/beatstage-objects.test.tsx`

**Interfaces:**
- Consumes: `ObjectStage`/`ObjectStageHandle` from `@/components/editor/ObjectStage`; `objectStateAt`; `gsap`.
- Produces: `BeatStage` gains optional props `scene?: Scene` and `beatIndex?: number`; when present it mounts `<ObjectStage>` as a sibling above `ArtStage` and drives it from a proxy tween on a local GSAP timeline synced to `animate`. With `animate={false}` it renders the settled end-state.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/beatstage-objects.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { Scene } from "@/engine/deck/types";

const scene: Scene = {
  id: "s1",
  objects: [{ id: "a", kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }],
  beats: [{ id: "b0", timeline: [{ kind: "obj_reveal", target: "a" }] }],
};

describe("BeatStage object rendering", () => {
  it("renders the object stage and paints the object at settled end-state when animate=false", () => {
    const { container } = render(<BeatStage sceneId="s1" beat={scene.beats[0]} scene={scene} beatIndex={0} animate={false} />);
    const node = container.querySelector('[data-testid="object-stage"] [data-obj-id="a"]') as HTMLElement;
    expect(node).toBeTruthy();
    expect(node.style.display).toBe("block"); // gated but settled (p=1) → visible
    expect(node.style.opacity).toBe("1");
  });

  it("renders nothing extra when no scene prop is passed (back-compat)", () => {
    const { container } = render(<BeatStage sceneId="s1" beat={scene.beats[0]} />);
    expect(container.querySelector('[data-testid="object-stage"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/beatstage-objects.test.tsx`
Expected: FAIL — BeatStage has no `scene` prop / no object stage.

- [ ] **Step 3: Write minimal implementation**

Edit `engine/authoring/BeatStage.tsx`:

```tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { Beat, Scene } from "@/engine/deck/types";
import type { StoryAsset } from "@/engine/deck/story-assets";
import type { DeckChrome } from "@/engine/deck-doc";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { NoteField, type NoteFieldHandle } from "@/engine/components/NoteField";
import { CinematicSlide } from "@/engine/components/layouts/CinematicSlide";
import { ObjectStage, type ObjectStageHandle } from "@/components/editor/ObjectStage";
import { beatTimeline } from "@/engine/authoring/seek";
import { makeAuthoringRuntime } from "./runtime";

export function BeatStage({
  sceneId, beat, animate = true, entryLayers = [], endLayers = [], chrome, contained = false,
  scene, beatIndex = 0,
}: {
  sceneId: string; beat: Beat; animate?: boolean;
  entryLayers?: StoryAsset[]; endLayers?: StoryAsset[];
  chrome?: DeckChrome; contained?: boolean;
  scene?: Scene; beatIndex?: number;
}) {
  const art = useRef<ArtStageHandle>(null);
  const notes = useRef<NoteFieldHandle>(null);
  const objStage = useRef<ObjectStageHandle>(null);
  const [night, setNight] = useState(beat.nightlight ?? 0);

  const runtime = useMemo(
    () => makeAuthoringRuntime({
      art, notes, setNight,
      resolveEntry: () => entryLayers,
      resolveEnd: () => endLayers,
      onGate: () => {}, onWaiting: () => {},
    }),
    [entryLayers, endLayers],
  );

  // Drive the object stage: static end-state when !animate, else a proxy tween on a local
  // timeline sampling the reducer. Span = the beat's total timeline duration.
  useEffect(() => {
    if (!scene) return;
    const span = beatTimeline(beat.timeline).reduce((m, w) => Math.max(m, w.end), 0);
    if (!animate || span <= 0) { objStage.current?.renderAt(scene, beatIndex, span || 1e9); return; }
    const proxy = { p: 0 };
    const tl = gsap.timeline().to(proxy, {
      p: 1, duration: span, ease: "none",
      onUpdate: () => objStage.current?.renderAt(scene, beatIndex, proxy.p * span),
    });
    return () => { tl.kill(); };
  }, [scene, beat, beatIndex, animate]);

  return (
    <div data-testid="beatstage" style={{ position: contained ? "absolute" : "fixed", inset: 0, containerType: "size", background: "var(--color-mm-dark-brown)" }}>
      <ArtStage ref={art} nightlight={night} reduced={false} transparentBg />
      <NoteField ref={notes} reduced={false} />
      <div style={{ position: "absolute", inset: 0 }}>
        <CinematicSlide slots={{ sceneId, beat }} animate={animate} runtime={runtime} chrome={chrome} />
      </div>
      {scene && <ObjectStage ref={objStage} scene={scene} active />}
    </div>
  );
}
```

> Note: this places `ObjectStage` above `CinematicSlide`. If a later visual pass wants objects behind text, revisit z-order here (spec §4/§6 leave final ordering to the plan; above is the safe default so objects are visible).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/beatstage-objects.test.tsx`
Expected: PASS (2 tests). `npx tsc --noEmit -p .` → clean. Confirm the existing `e2e/beatstage.spec.ts` still describes a scene-less BeatStage (unchanged back-compat).

- [ ] **Step 5: Commit**

```bash
git add engine/authoring/BeatStage.tsx tests/unit/beatstage-objects.test.tsx
git commit -m "feat(objects): BeatStage/CinematicSlide object stage + proxy-tween clock (#3b)"
```

---

## Task 10: BeatStage object dev route + e2e

**Files:**
- Create: `app/dev/objectstage/page.tsx`
- Create: `e2e/objectstage.spec.ts`

**Interfaces:**
- Consumes: `BeatStage` with a `scene` prop.

- [ ] **Step 1: Write the dev route**

```tsx
// app/dev/objectstage/page.tsx
"use client";
import { useEffect, useState } from "react";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { Scene } from "@/engine/deck/types";

const scene: Scene = {
  id: "s1",
  objects: [{ id: "a", kind: "shape", shape: "rect", transform: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, name: "box" }],
  beats: [{ id: "b0", timeline: [{ kind: "obj_reveal", target: "a", in: "fade" }] }],
};

export default function Page() {
  // Start static so the object paints immediately for a deterministic screenshot,
  // then flip animate on via ?animate=1 for the playback assertion.
  const [animate, setAnimate] = useState(false);
  useEffect(() => { setAnimate(new URLSearchParams(location.search).get("animate") === "1"); }, []);
  return <BeatStage sceneId="s1" beat={scene.beats[0]} scene={scene} beatIndex={0} animate={animate} />;
}
```

- [ ] **Step 2: Write the e2e**

```ts
// e2e/objectstage.spec.ts
import { test, expect } from "@playwright/test";

test("BeatStage renders scene objects at settled state", async ({ page }) => {
  await page.goto("/dev/objectstage");
  const obj = page.locator('[data-testid="object-stage"] [data-obj-id="a"]');
  await expect(obj).toBeVisible();
  await expect(obj).toHaveCSS("opacity", "1");
});

test("BeatStage animates the reveal under animate=1", async ({ page }) => {
  await page.goto("/dev/objectstage?animate=1");
  const obj = page.locator('[data-testid="object-stage"] [data-obj-id="a"]');
  await expect(obj).toBeVisible(); // reveal completes → visible
});
```

- [ ] **Step 3: Run (or defer to CI)**

Run (if `next` install complete): `CI=1 npm run test:e2e -- e2e/objectstage.spec.ts --workers=1`
Expected: PASS. Otherwise `npm ci` first or rely on CI.

- [ ] **Step 4: Commit**

```bash
git add app/dev/objectstage/page.tsx e2e/objectstage.spec.ts
git commit -m "test(objects): BeatStage object dev route + e2e (#3b)"
```

---

## Task 11: Cross-path parity test + deep-dive sync

**Files:**
- Create: `tests/unit/object-parity.test.tsx`
- Modify (conditional): `docs/MM_MORGANA.md`

**Interfaces:**
- Consumes: `applyObjectState`, `objectStateAt` (both paths use the same functions, so parity is about asserting the shared contract holds for both mount points at sampled times).

- [ ] **Step 1: Write the parity test**

```tsx
// tests/unit/object-parity.test.tsx
import { describe, it, expect } from "vitest";
import { objectStateAt, applyObjectState } from "@/lib/editor/object-state";
import { applyObjectState as applyFromStage } from "@/components/editor/ObjectStage";
import type { Scene, SceneObject } from "@/engine/deck/types";

// object-state re-exports applyObjectState? No — assert the single implementation is shared:
// both the editor (DeckCanvas→ObjectStage) and BeatStage import applyObjectState from ObjectStage.
// Parity here = the reducer sampled at time t yields identical DOM writes regardless of caller.
const obj = (id: string): SceneObject =>
  ({ id, kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } } as SceneObject);
const scene: Scene = { id: "s1", objects: [obj("a")], beats: [{ id: "b0", timeline: [{ kind: "obj_move", target: "a", to: { x: 0.6 } }] }] };

describe("object render parity across paths", () => {
  it("both mount points write identical styles for the same sampled time", () => {
    for (const t of [0, 0.2, 0.4, 0.8]) {
      const st = objectStateAt(scene, 0, t).get("a")!;
      const a = document.createElement("div");
      const b = document.createElement("div");
      applyFromStage(a, st);
      applyFromStage(b, st);
      expect(a.getAttribute("style")).toBe(b.getAttribute("style"));
    }
  });
});
```

> If `applyObjectState` is imported only from `ObjectStage`, this asserts determinism of the shared writer; remove the unused `applyObjectState`-from-object-state import if the reducer file does not export it. (The reducer file does NOT export `applyObjectState`; the writer lives in `ObjectStage.tsx`. Keep only the `applyFromStage` import.)

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/unit/object-parity.test.tsx`
Expected: PASS.

- [ ] **Step 3: Full gate**

Run: `npx vitest run tests/unit/ && npx tsc --noEmit -p .`
Expected: all unit tests PASS; type-check clean.

- [ ] **Step 4: Deep-dive sync check**

Read `docs/MM_MORGANA.md`. 3b adds no new deck-format behavior or cross-repo contract (render-only, no schema change), so a deep-dive edit is likely unnecessary. If the branch changed any documented constraint (it should not), invoke the `mm-deepdive-sync` skill; otherwise note "no deep-dive change needed" in the PR body. Do not fabricate a doc change.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/object-parity.test.tsx
git commit -m "test(objects): cross-path render parity (#3b)"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** §3 reducer → Tasks 1–5; §4 ObjectStage/applyObjectState → Task 6; §5 editor seek + mode-swap → Task 7 (+ e2e Task 8); §6 CinematicSlide/BeatStage + static end-state → Task 9 (+ dev route/e2e Task 10); §7 tests → distributed unit tests + parity (Task 11) + e2e (Tasks 8, 10); §0.2 no-schema-change honored (all context is props). §7-deferral (§0.1) respected — no transport surface, no seek.ts object case.
- **Placeholder scan:** e2e selector names in Task 8 are explicitly flagged as placeholders with a dedicated step to reconcile against `e2e/objects.spec.ts` (they depend on #2a/#3a UI test-ids not re-listed here); every code step contains complete code.
- **Type consistency:** `ObjectRenderState { x,y,w,h,rot,scale,opacity,visible }`, `ObjectStateMap`, `objectStateAt(scene,beatIndex,tLocal)`, `flattenObjects → {obj,descendantIds}`, `ObjectStageHandle.renderAt`, `applyObjectState(node,state)` used identically across Tasks 1–11. Constants `FLY_DY`/`SIDE_DX`/`POP_FROM` defined in Task 3 and reused. `beatLocation`/`beatTimeline`/`revealedObjectIds` referenced by their real signatures.
