# Object / Layer Data Model — Design Spec

- **Date:** 2026-07-21
- **Status:** Design spec (approved for planning)
- **Author of record:** Chris Oltyan (brainstormed with Claude)
- **Sub-project:** #1 of 3 in the "first-class object model" effort
- **Companion docs:** [`2026-06-29-morgana-end-state-design.md`](../../2026-06-29-morgana-end-state-design.md)
  (north star — principles #1/#2, §4 art-layer language, §14a/Q7 format-version freeze).

---

## 0. Context — the gap this closes

Morgana today has **no first-class persistent object model**. Content exists only as timeline
`Action`s on a `Beat`, and the engine tears down and rebuilds *everything* on every beat transition
(both the live GSAP runtime in `engine/components/layouts/CinematicSlide.tsx` and the seek renderer
in `engine/authoring/seek.ts`). The only id-keyed, reference-able elements are **media tiles**
(`media` creates by `id`; `media_move`/`media_out` reference it) — but that identity is scoped to a
single beat's mounted lifetime and is not part of the `DeckDoc` schema. The only ordered multi-layer
stack is `engine/components/ArtStage.tsx` (array index = z-order), scoped to background art panels
only. A survey of `docs/` and the end-state design's feature matrix + §4/§5/§11 confirms a
PowerPoint-style object/layer model is **not specced anywhere**.

The user's goal: a better slide-editing UI that mirrors PowerPoint — add and edit **text fields,
graphics/images, and shapes** as first-class objects; support **grouping** and **z-order /
reordering of layers** — *on top of* the existing per-beat action timeline, not replacing it. Then
(later sub-projects) let created objects be assigned to animations/actions.

## 1. Scope — the three sub-projects

This is too large for one spec. It decomposes into three sub-projects with a hard dependency order:

| # | Sub-project | Delivers | Depends on |
| --- | --- | --- | --- |
| **1** | **Object/layer data model** *(this spec)* | Schema, validation, pure mutations, object descriptor registry, backward-compat. Unit-tested. **No UI, no engine-render changes, no action verbs.** | — |
| **2** | Canvas direct-manipulation + layers/grouping panel UI | Drag/resize/rotate handles, the layers panel, add-object toolbar, selection model. | #1 |
| **3** | Object ↔ action binding | Action verbs that target objects by id (reveal/move/animate/remove), engine render integration (persist a scene-graph across beats; teach the seek renderer about objects), dangling-`target` validation, and the migration story for legacy `text`/`art`/`media` actions. | #1 (informs #2) |

Sub-projects #2 and #3 get their own brainstorm → spec → plan cycles. This spec covers **#1 only**.

### 1.1 In scope (#1)

The static object *data model* and everything needed to create, edit, validate, order, group, and
persist objects as pure data — with unit-test coverage.

### 1.2 Explicitly deferred

- **→ #2 (UI):** canvas drag/resize/rotate handles, the layers/grouping panel, the add-object
  toolbar, the selection model.
- **→ #3 (binding & render):** the action verbs that target objects (`reveal` / `obj_move` /
  `obj_remove` / animate); engine render integration (persisting a scene-graph across beats;
  teaching the GSAP runtime and the seek renderer to draw objects); dangling-`target` validation;
  and the migration path for legacy `text`/`art`/`media` actions — which **coexist untouched** with
  objects for now.

## 2. Guiding decisions (locked during brainstorm)

| Decision | Choice | Rationale |
| --- | --- | --- |
| **Object scope & lifetime** | **Scene-level, persist across beats.** | Mirrors PowerPoint objects persisting across a slide's animation steps; matches the media-tile `id` precedent. Objects are declared once on the `Scene` and referenced by beat-level actions (in #3). Removal from a scene mid-playback is an action verb (#3) — the user's "fade-out" case. |
| **Object kinds** | **Text · Image · Shape · Group** (group nestable). | The PowerPoint core four; each maps onto an existing engine primitive (text lines, media tiles, art panels) so #3 has a render path. |
| **Geometry** | **Normalized bbox + rotation.** | Stays resolution-independent on the fixed 16:9 stage, consistent with today's normalized `StagePoint` convention, while adding the size + rotation PowerPoint objects need. |
| **Z-order + grouping** | **Nested tree; array order = depth-first paint order.** | Generalizes the ArtStage precedent (array index = z). Reorder = array splice; group/ungroup = move nodes in/out of a `children` array. No separate `z` field to drift; fits the immutable pure-mutation style. |
| **Default visibility** | **Visible from scene start at declared transform.** | An object with no action targeting it is simply present for the whole scene (PowerPoint object with no animation). Makes the static canvas truthful and keeps binding semantics in #3. |
| **Backward-compat / versioning** | **Additive optional `Scene.objects?`; `version` stays `1`; write a bump policy.** | Zero migration; load stays pure `JSON.parse`. Old decks are valid and unchanged; an older Morgana opening a newer deck still loads it and degrades gracefully. |
| **Editing spine** | **Object descriptor registry** mirroring the effect-descriptor registry. | Principle #2 — "the registry is the spine." One descriptor per object kind drives the existing schema-driven inspector with zero new field-rendering code, and is #2's add-object source of truth. |

## 3. Data model

### 3.1 New types

```ts
// Normalized to the fixed 16:9 stage, consistent with today's StagePoint convention.
interface ObjectTransform {
  x: number; y: number;             // top-left, 0–1 fraction of stage
  w: number; h: number;             // size,     0–1 fraction of stage (w,h > 0)
  rot?: number;                     // degrees clockwise, default 0
  anchor?: 'center' | 'top-left';   // rotation/scale origin, default 'center'
}

// Fields common to every object kind.
interface ObjectBase {
  id: string;                       // unique within its Scene (including nested children)
  name?: string;                    // author-facing label in the layers panel
  transform: ObjectTransform;
  opacity?: number;                 // 0–1, default 1
  hidden?: boolean;                 // author-time hide (editor affordance), persisted
  locked?: boolean;                 // author-time lock (editor affordance), persisted
}

type ObjectShapeKind = 'rect' | 'ellipse' | 'line';

interface Stroke { color: string; width: number }   // width in 0–1 fraction of stage height

type SceneObject =
  | (ObjectBase & { kind: 'text';  text: string; style?: TextStyle })
  | (ObjectBase & { kind: 'image'; src: string; fit?: 'contain' | 'cover'; round?: boolean })
  | (ObjectBase & { kind: 'shape'; shape: ObjectShapeKind; fill?: string; stroke?: Stroke; radius?: number })
  | (ObjectBase & { kind: 'group'; children: SceneObject[] });
```

- **`TextStyle`** reuses the existing engine text vocabulary (`TextSize`, `TextAlign`, color
  strings, and per-line emphasis flags where already modeled) rather than inventing a parallel one —
  objects share the theming seam. Exact field set is finalized against `engine/deck/types.ts` during
  planning; it MUST be a strict subset/reuse, not a new dialect.
- **`fill`** is a CSS color string (consistent with `note_emitter.color` etc.). `radius` applies to
  `rect` only (corner rounding, 0–1 fraction). For `line`, `w`/`h` describe the bounding box and the
  line runs corner-to-corner per `anchor`; only `stroke` is meaningful.
- **`hidden` / `locked`** are author-time editor affordances that **persist** in the deck JSON (like
  PowerPoint's selection-pane hide/lock). `hidden` is an *editor* hide — it does **not** affect
  playback visibility (that is action-driven, #3). Confirmed during review.

### 3.2 The one change to the existing tree

```ts
interface Scene {
  id: string;
  treatment?: SlideTreatment;
  objects?: SceneObject[];          // NEW · bottom→top · depth-first paint order · optional
  beats: Beat[];
}
```

`DeckDoc.version` stays the literal `1`. Nothing else in `DeckDoc` / `Beat` / `Action` changes.

### 3.3 Identity contract (the seam #3 builds on)

- Object `id` matches the existing id regex (`/^[a-z0-9][a-z0-9-]*$/`) and is **unique within its
  Scene**, counting nested `children`.
- Ids are the reference target for #3's action verbs (`{ kind:'reveal', target:'logo', … }`). #1
  **reserves this contract** — stable, scene-unique, addressable ids — but defines **no** action
  verbs and adds **no** `target` field to any `Action`.

## 4. Z-order → render mapping

Objects paint as a **persistent content layer**, back-to-front in **depth-first document order**:
`objects[0]` is backmost; a `group` paints its `children` in order at the group's own slot in the
parent list. This generalizes the ArtStage precedent (array index = z).

#1 specifies these **ordering semantics** as the contract only. The engine wiring — which
compositing band objects occupy relative to art / `.cin__stage` / notes, and how the object layer
survives beat transitions instead of being torn down — is **#3's render-integration work**. #1 ships
no engine changes.

## 5. Object descriptor registry

A new `lib/editor/object-registry.ts`, mirroring `lib/editor/registry.ts`:

```ts
interface ObjectDescriptor {
  kind: SceneObject['kind'];
  label: string;
  icon: string;
  schema: Field[];                  // same Field type the effect registry uses
  defaults(): SceneObject;          // what "add this object" inserts
}
```

- One descriptor per kind (`text`, `image`, `shape`, `group`). `schema` uses the **existing** `Field`
  type and dotted-path keys (e.g. `transform.x`, `style.size`, `stroke.width`) consumed by the
  existing `getPath`/`setPath` in `lib/editor/paths.ts` — so the current schema-driven `Inspector`
  edits objects with **zero new field-rendering code**.
- `defaults()` returns a valid instance (sensible centered transform, placeholder text/src) used by
  the `addObject` mutation and by #2's add-object menu.
- A `descriptorForObject(o)` lookup mirrors `descriptorFor(a)`, with a `GENERIC`-style fallback for
  forward-compatibility with unknown kinds.

This is the same widen-the-contract move as principle #2: one object definition lights up the
inspector (and later the layers panel and validators) without editing multiple call sites.

## 6. Pure mutations

New immutable `(doc, …) => DeckDoc` functions extending `lib/editor/mutations.ts`, wired into the
Zustand store (`lib/editor/store.ts`) so they inherit undo/redo + debounced autosave for free. Each
returns the **same doc reference** as a no-op sentinel when nothing changes (the existing convention
that makes `commit` a no-op). Objects are addressed by `sceneId` + object `id` path (into the nested
tree), consistent with how mutations already locate beats/actions.

| Mutation | Effect |
| --- | --- |
| `addObject(doc, sceneId, object, atPath?)` | Insert a new object at a tree position (default: top of the scene's root list). |
| `updateObject(doc, sceneId, objectPath, fieldKey, value)` | Field-level edit via `setPath` (mirrors `updateAction`). |
| `deleteObject(doc, sceneId, objectPath)` | Remove an object (and, for a group, its subtree). |
| `reorderObject(doc, sceneId, objectPath, delta)` | Z-move within its sibling list (raise/lower). |
| `groupObjects(doc, sceneId, objectPaths[])` | Wrap a selection in a new `group` at the topmost member's slot. |
| `ungroupObject(doc, sceneId, groupPath)` | Splice a group's children into its parent at the group's slot; drop the group. |
| `reparentObject(doc, sceneId, objectPath, newParentPath, index)` | Move an object into/out of a group at a given index. |

Store methods (`addObject`, `updateObject`, …) mirror the existing action-mutation methods and route
through the same `commit` helper.

## 7. Validation

Extend `validateDeckDoc` in `engine/deck-doc.ts` — today it checks only top-level structure and does
not inspect beats/actions. When `objects` is present on a scene:

- each `id` matches the id regex and is **unique within the scene** (including nested `children`);
- `kind` ∈ `{ text, image, shape, group }`;
- `transform` numbers are finite; `w > 0` and `h > 0`;
- `opacity`, when present, ∈ `[0, 1]`;
- `group.children` validate recursively;
- nesting depth ≤ a sane cap (e.g. 8) to bound recursion.

**Absent `objects` is valid** (backward-compat). Dangling-`target` reference checks are **#3's**
(there are no targets yet). This keeps `validateDeckDoc` the single load/save gate it already is
(it fronts `PUT /api/decks/[id]` and `saveDeck`).

## 8. Backward-compat & version policy

- **Additive optional field → no migration.** Load stays pure `JSON.parse`; save stays pure
  `JSON.stringify`. A legacy object-less deck is valid and byte-identical through the pipeline.
- **Graceful degradation.** An older Morgana opening a newer deck passes `validateDeckDoc` (which
  ignores `objects`) and simply doesn't render them — it does not hard-reject.
- **Deliverable — version-bump policy doc.** A short `docs/superpowers/specs/deck-format-version-policy.md`
  stating: *additive optional fields never bump `DeckDoc.version`; only breaking changes (removing/
  renaming/retyping existing fields, or changing required semantics) bump it, with a migration.* This
  discharges the north-star §14a / Q7 "format-version freeze + bump policy" ask and sets the rule for
  #2/#3 and all future schema growth.

## 9. Testing — #1's definition of done

Unit tests only (no UI, no engine-render tests — those land with #2/#3):

- **Mutations:** `addObject` / `updateObject` / `deleteObject` / `reorderObject` / `groupObjects` /
  `ungroupObject` / `reparentObject` — correctness, immutability (input doc untouched), no-op
  sentinel behavior, and integration with the store's undo/redo.
- **Validator:** valid objects (all four kinds, nested groups); rejected cases — duplicate id within
  a scene, id colliding with a nested child, bad `kind`, non-finite / non-positive `transform`,
  out-of-range `opacity`, over-deep nesting.
- **Round-trip:** `JSON.parse` → `JSON.stringify` preserves objects exactly; a legacy object-less
  deck is byte-identical through the pipeline (backward-compat guard).
- **Registry:** every `ObjectDescriptor.defaults()` produces a value that passes the validator; every
  `schema` field key resolves via `getPath` on that default.

## 10. Consequences & follow-ons

- **#2 (UI)** renders the layers panel directly from the nested `objects` tree, drives the inspector
  from the object registry, and calls the §6 mutations for drag/resize/rotate/reorder/group.
- **#3 (binding & render)** adds `target`-bearing action verbs, integrates objects into the GSAP
  runtime and seek renderer as a persistent cross-beat layer, adds dangling-`target` validation, and
  defines whether/how legacy `text`/`art`/`media` actions migrate into objects (they coexist until
  then).
- **North star:** this is a concrete instance of principle #2 (widen the registry contract) and
  discharges the §14a/Q7 format-version-policy prerequisite.
