# Object ↔ Action Binding — Data Model, Validation & Binding UI — Design Spec (3a)

- **Date:** 2026-07-22
- **Status:** Design spec (approved for planning)
- **Author of record:** Chris Oltyan (brainstormed with Claude)
- **Sub-project:** **3a** of sub-project **#3** ("object ↔ action binding + engine playback rendering") in the first-class object-model effort.
- **Companion docs:**
  - [`2026-07-21-object-layer-model-design.md`](2026-07-21-object-layer-model-design.md) — #1, the static object data model (esp. §3 identity contract, §10 follow-ons).
  - [`2026-07-21-object-canvas-foundation-2a-design.md`](2026-07-21-object-canvas-foundation-2a-design.md) — #2a, the authoring-time overlay.
  - [`../../2026-06-29-morgana-end-state-design.md`](../../2026-06-29-morgana-end-state-design.md) — north star (§7 real-runtime/seek, §8 validation, §11 descriptor spine).
  - [`deck-format-version-policy.md`](deck-format-version-policy.md) — additive-fields-don't-bump policy.

---

## 0. Context — what #3 is, and where 3a sits

#1 gave Morgana a persistent scene-level object tree (`Scene.objects?: SceneObject[]`): text/image/shape/group nodes with stable, scene-unique ids, a normalized transform, and editor `hidden`/`locked` flags. #2a/#2b/#2c gave the **editor** a direct-manipulation overlay (`components/editor/ObjectsLayer.tsx`) — select/add/delete/drag/resize/rotate + a layers/grouping panel. All are merged to `main`.

But **objects are inert in playback**. #1 reserved an identity contract — objects have scene-unique ids that "actions will reference by a `target` field" — and deferred the verbs, the render, and the validation to #3. Today `scene.objects` are drawn **only** by the #2a authoring overlay (a static, editor-only layer); they are invisible in both real render paths (the live GSAP `CinematicSlide` runtime and the lo-fi `seek.ts` renderer).

**#3 is decomposed into two build slices** (decided during brainstorm):

| Slice | Delivers | Depends on |
| --- | --- | --- |
| **3a** *(this spec)* | The `target`-by-id **action verbs** (`obj_reveal`/`obj_move`/`obj_out`), registry descriptors + an `objectRef` inspector field, the **gating semantics contract**, **dangling-`target` validation**, and the **binding UI** (object-centric "Animations" panel). Pure logic unit-tested; UI component-tested. **No engine-render change.** | #1, #2a |
| **3b** | Deterministic **object render integration**: a pure `objectStateAt(objects, timeline, t)` reducer + a **persistent object layer** rendered in *both* existing paths (the `seek.ts` editor-canvas path and the `CinematicSlide` playback path), driven by 3a's verbs. Cross-beat persistence + seek determinism. | 3a |

**"3c" (legacy migration) is not a separate slice.** Legacy `text`/`art`/`media` actions **coexist untouched** with objects (the choice #1 already locked); an opt-in converter is deferred. This is recorded here (§8) and needs no implementation in 3a/3b.

### 0.1 Deferred to 3b (explicitly out of scope for 3a)

- The `objectStateAt(t)` reducer and any engine/canvas rendering of objects or their animations.
- Making objects a persistent cross-beat layer; reconciling the #2a overlay with the play view.
- Playwright e2e for object playback/scrub (nothing renders in 3a).

### 0.2 Deferred to a later slice (north-star §7 — confirmed during brainstorm)

3b will **not** pull in §7's "real engine in the canvas / retire `seek.ts` behind a parity gate / time-pure particles" keystone. 3b achieves determinism with a **pure reducer rendered into today's two paths**, leaving §7 an independent future effort. 3a is fully upstream of that decision.

## 1. Scope

### 1.1 In scope (3a)

The **static, authorable, validatable** binding layer and its editor affordance:

1. Three new `Action` kinds targeting an object by id.
2. Effect-registry descriptors for them + a new `objectRef` field type.
3. A pure gating-semantics helper defining an object's default (pre-reveal) visibility.
4. Dangling-`target` (and `obj_move.to` range) validation in `validateDeckDoc`.
5. The binding UI: an inspector "Animations" section with add-entrance/emphasis/exit buttons + `objectRef` retargeting.

### 1.2 Out of scope

Everything in §0.1 and §0.2. 3a changes **no** rendering code; after authoring an `obj_reveal`, the object is still drawn by the #2a overlay unchanged, the new action shows in the timeline and validates, but nothing new animates under playback/scrub until 3b.

## 2. Guiding decisions (locked during brainstorm)

| Decision | Choice | Rationale |
| --- | --- | --- |
| **Verb set + naming** | `obj_reveal` · `obj_move` · `obj_out`. | Minimal entrance/emphasis/exit trio; the `obj_` prefix parallels the existing `media`/`media_move`/`media_out` triad, so the trio groups in the kind-picker and matches house precedent. |
| **Binding shape** | Each verb is a distinct `Action` `kind` carrying `target: string`. | Forced by the tagged-union pattern; mirrors the id-keyed media triad — the closest existing precedent. |
| **Gating** | **Implicit — an `obj_reveal` IS the gate.** No new persisted field. | An object with any `obj_reveal` targeting it starts hidden until revealed; otherwise visible from t=0. The action is the single source of truth; matches #1's stated default and avoids inconsistent states an explicit flag would allow. |
| **Entrance vocab** | Reuse `MediaIn` (`fade`/`flyUp`/`pop`/`fadeSide`) for `obj_reveal.in`. | Authors already know it; the engine already implements those tweens (3b reuses them). Smallest new vocabulary. |
| **Exit vocab** | `obj_out.out` = `"fade"` only (extensible). | Matches `media_out` today; a single-member union leaves the door open without over-building. |
| **`obj_move` target** | **Absolute partial transform** `to: { x?, y?, w?, h?, rot? }`. | One verb covers move/scale/rotate; unspecified axes stay put. Absolute (not deltas) is deterministic — 3b's reducer interpolates from the object's pre-move state to `to` without accumulating history. Mirrors `media_move`'s `to`. |
| **Binding UI** | Object-centric "Animations" panel + `objectRef` field. | PowerPoint-like, discoverable from the canvas; the `objectRef` field (needed anyway to retarget) makes the timeline kind-picker path valid for free. |
| **Animations panel scope** | **Current beat** only. | The timeline is per-beat and the author edits one beat at a time; scene-wide listing would misrepresent which timeline the add lands in. |
| **`ease`** | No `ease` field in 3a (fixed smooth ease in 3b). | YAGNI; `media_move` ships a fixed `power3.inOut` today. Add later if authors ask. |
| **Versioning** | Additive kinds + `target` field; `DeckDoc.version` stays `1`. | Per `deck-format-version-policy.md` — additive union members never bump. Legacy decks load byte-identical. |
| **Legacy actions** | Coexist untouched (the folded-in "3c"). | #1's decision; no migration in 3a/3b. |

## 3. Data model

### 3.1 New types (`engine/deck/types.ts`)

```ts
/** Partial object transform for obj_move: unspecified axes are left unchanged.
 *  x,y,w,h are 0–1 fractions of the stage (same space as ObjectTransform);
 *  rot is degrees clockwise. */
export interface ObjectMoveTarget { x?: number; y?: number; w?: number; h?: number; rot?: number }

/** How an object exits (obj_out). Single member for now; extensible. */
export type ObjectOut = "fade";
```

### 3.2 New `Action` union members

Added to the `Action` union in `engine/deck/types.ts`, with doc comments matching the existing house style:

```ts
// Object animation verbs (sub-project #3a). Each targets a Scene.objects node by its
// scene-unique `id`. reveal = entrance, move = emphasis (move/scale/rotate), out = exit.
// An object referenced by an obj_reveal anywhere in the scene starts HIDDEN until that
// reveal fires; an object no obj_reveal targets is visible from scene start (see §4).
| { kind: "obj_reveal"; target: string; in?: MediaIn; durationMs?: number }
| { kind: "obj_move";   target: string; to: ObjectMoveTarget; durationMs?: number }
| { kind: "obj_out";    target: string; out?: ObjectOut; durationMs?: number }
```

- `target` is an object id, matching the id regex reserved by #1 (`/^[a-z0-9][a-z0-9-]*$/`), resolved **within the same scene** as the beat that carries the action.
- `obj_reveal.in` defaults to `"fade"`; `obj_out.out` defaults to `"fade"`.
- Durations default per §5 (600 / 800 / 500 ms).

### 3.3 Duration & seekability (`engine/authoring/seek.ts`)

Extend `actionDuration` so the timeline reserves the right window for each verb (seek/track geometry stays correct even before 3b renders them):

```ts
case "obj_reveal": return (a.durationMs ?? 600) / 1000;
case "obj_move":   return (a.durationMs ?? 800) / 1000;
case "obj_out":    return (a.durationMs ?? 500) / 1000;
```

All three are **seekable** (pure tweens) — `isSeekable` already returns `true` for any kind that isn't `note_emitter`/`note_circle`/`cue`, so no change there. `renderBeatAt`/`applyAt` are **not** taught to draw objects in 3a (that is 3b); the `default: break` branch already ignores unknown kinds, so the seek renderer keeps working unchanged.

## 4. Gating semantics (the contract 3b implements)

A pure helper (new `lib/editor/object-gating.ts`, or extending `object-tree.ts`):

```ts
/** Ids of objects the scene reveals via an obj_reveal in any beat's timeline. */
export function revealedObjectIds(scene: Scene): Set<string>;

/** True iff this object starts hidden (some obj_reveal targets it). */
export function isGated(scene: Scene, objectId: string): boolean;
```

Semantics 3a fixes and 3b renders:

- Object X is **gated** iff `∃` an action `{ kind:"obj_reveal", target: X.id }` in **any** beat of the scene. A gated object is **hidden from scene start** until its first `obj_reveal` fires in playback order.
- An object no `obj_reveal` targets is **visible from t=0** at its declared transform/opacity (#1's default).
- `obj_move`/`obj_out` do **not** gate — they act on whatever the object's current state is (visible-by-default or already-revealed).

In 3a this helper drives only the **editor "gated" hint** (a small badge/indicator on gated objects in the layers panel and/or overlay). 3b consumes the same helper for its reducer. Keeping the rule in one pure, tested function guarantees the editor hint and the eventual render agree.

## 5. Registry descriptors + `objectRef` field type

### 5.1 New field type (`lib/editor/registry.ts`)

```ts
export type FieldType = "text" | "textarea" | "number" | "select" | "range" | "checkbox" | "objectRef";
```

An `objectRef` field renders as a select whose options are the **current scene's objects** — `{ value: id, label: name ?? id }` for every node (including nested `children`), gathered via `collectObjectIds`/a small name-aware walk. The Inspector supplies the current `sceneId` (already derivable from the selected beat) so the field can enumerate options; unlike other field types it is **context-dependent**, which the Inspector's field renderer must accommodate (see §6).

### 5.2 Descriptors

Three entries added to `REGISTRY`, consumed by the inspector + timeline with zero new field-rendering code beyond the `objectRef` renderer:

```ts
obj_reveal: { kind: "obj_reveal", label: "Reveal object", icon: "ti-eye", seekable: true, schema: [
  { key: "target", label: "Object", type: "objectRef" },
  { key: "in", label: "Entrance", type: "select", options: MEDIA_INS.map(v => ({ value: v, label: v })) },
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

A `target: ""` default is intentionally **invalid** (flagged by §7 validation) — the object-centric add flow (§6) fills `target` immediately, and the `objectRef` field lets a timeline-picker-created action pick one. This mirrors how `media`'s default carries a placeholder id the author then edits.

## 6. Binding UI

An **"Animations"** section rendered in the inspector when an object is selected (`selectedObjectPath != null`), alongside the existing object field editor:

- **Lists** the `obj_*` actions in the **current beat's timeline** whose `target` equals the selected object's id — each row shows the verb label + a jump/select affordance (select the action for inspector editing) and a delete affordance.
- **Add buttons** — "Add entrance" / "Add emphasis" / "Add exit" — append `descriptorFor("obj_reveal"|"obj_move"|"obj_out").defaults()` to the current beat's timeline via the existing `addAction` store path, then immediately set `target` to the selected object's id (a single mutation or an add-then-update). For `obj_move`, `to` is seeded from the object's current transform so the default move is a no-op the author then edits `(rec)`.
- **Retargeting** any existing `obj_*` action uses the `objectRef` field in the normal action inspector.

Implementation notes:

- The `objectRef` field renderer needs the scene's object list; the Inspector already knows the selected beat → `sceneId`. Add a focused branch in the field renderer (or a small `ObjectRefField` component) that reads objects from the store for that scene. This is the one field type that isn't a pure `getPath`/`setPath` over the action alone.
- Reuse existing store methods (`addAction`, `updateAction`, `deleteAction`, `selectAction`); no new mutation primitives required for the binding UI beyond possibly a convenience "add action with fields" helper.
- The "gated" hint (§4) surfaces in the layers panel / overlay for objects in `revealedObjectIds(scene)`.

## 7. Validation

Extend `validateDeckDoc` (`engine/deck-doc.ts`) — which today validates only top-level structure + object trees — to **inspect beat timelines for the first time**. Per scene, build the set of object ids (incl. nested `children`, via the same walk §4 uses), then for each beat, for each action:

- If `kind ∈ { obj_reveal, obj_move, obj_out }`:
  - `target` must be a non-empty string present in the scene's object-id set → else `"scenes[i].beats[j].timeline[k]: obj_* target \"…\" is not an object in this scene"` (dangling-target; also fires for the empty-string default).
  - For `obj_move`: `to` (when present) — each present axis of `x,y,w,h,rot` must be a finite number; `x,y,w,h ∈ [0,1]` and `w,h > 0` when present; `rot` finite.
  - `durationMs`, when present, must be a finite number ≥ 0.

Notes:

- Timelines without `obj_*` actions validate exactly as before — legacy/object-less decks are unaffected.
- This keeps `validateDeckDoc` the single load/save gate (it fronts `PUT /api/decks/[id]` and `saveDeck`). Richer action-level lints surfaced live in an editor panel remain north-star §8 / a later slice.
- Cross-beat scene-scoping: `target` resolves against the **scene that owns the beat**, so the walk iterates `scene.beats[].timeline[]` with that scene's id set — never a global set.

## 8. Legacy coexistence (folded-in "3c")

Legacy `text`/`art`/`media`/`counter` actions are **unchanged and fully supported**; they render via their existing paths and are not converted to objects. Objects + `obj_*` verbs are a **parallel, additive** authoring model. An opt-in "convert legacy media/text to object" tool is explicitly deferred (no consumer need yet). This discharges the "3c" question #3 raised without a dedicated slice.

## 9. Testing — 3a's definition of done

**Unit (vitest) — the pure core:**

- **Durations:** `actionDuration` returns 0.6 / 0.8 / 0.5 s (and honors `durationMs`) for the three kinds; `isSeekable` is `true` for all three.
- **Gating:** `revealedObjectIds` / `isGated` — object with an `obj_reveal` in beat 0 is gated; in a later beat is gated; nested-child target resolves; an object no reveal targets is not gated; a scene with no `obj_*` yields an empty set.
- **Validation:** valid `obj_*` actions across all three kinds pass; rejected — empty `target`, `target` not in the scene, `target` matching an object in a *different* scene (must fail), non-finite / out-of-range `obj_move.to` axis, `w`/`h` ≤ 0, negative `durationMs`. Legacy object-less decks still pass; a deck with objects but no verbs still passes.
- **Registry:** each new descriptor's `defaults()` produces an action whose non-`target` fields validate, and whose `target:""` is correctly flagged; every `schema` key resolves via `getPath` on the default (including `to.x` etc.).
- **Round-trip:** `JSON.parse → JSON.stringify` preserves the new actions exactly.

**Component (jsdom + @testing-library/react):**

- Selecting an object shows the Animations panel; "Add entrance/emphasis/exit" appends the correct verb to the current beat with `target` pre-filled to the selected object.
- The `objectRef` field lists the scene's objects and updates `target` on change.
- The panel lists only current-beat actions targeting the selected object; deleting a row removes the action.

**No Playwright e2e in 3a** — nothing renders yet; playback/scrub e2e lands with 3b. (Env note: a fresh worktree may need `npm ci`; `npm test` + `npx tsc --noEmit -p .` are the local gate.)

## 10. Consequences & follow-ons

- **3b** consumes §3's verbs and §4's gating helper to build the deterministic `objectStateAt(objects, timeline, t)` reducer and the persistent object layer in both render paths, and adds Playwright playback/scrub coverage.
- **North star:** the new descriptors are another instance of principle #2 (widen the registry contract). The `objectRef` field type and beat-timeline validation are reusable seams for §8's richer live lint panel and §11's descriptor-owned validators.
- **No version bump:** additive union members + an additive `target` field, per `deck-format-version-policy.md`.
