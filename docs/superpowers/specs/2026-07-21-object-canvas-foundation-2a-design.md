# Object Canvas Foundation (#2a) — Design Spec

- **Date:** 2026-07-21
- **Status:** Design spec (approved for planning)
- **Sub-project:** #2a of the "first-class object model" effort (slice 1 of 3 within sub-project #2)
- **Depends on:** #1 (object data model — `Scene.objects`, mutations, object registry), landed in PR #15.
- **Companion docs:**
  [`2026-07-21-object-layer-model-design.md`](2026-07-21-object-layer-model-design.md) (#1 data model),
  [`2026-06-29-morgana-end-state-design.md`](../../2026-06-29-morgana-end-state-design.md) (north star §4).

---

## 0. Context

Sub-project #1 added the persistent object data model (`Scene.objects?: SceneObject[]` — a nested
tree of text/image/shape/group with normalized bbox+rotation transforms), plus validation, pure
mutations, an object descriptor registry, and store wiring. **Nothing renders or edits objects in the
editor yet** — verified: `components/editor/DeckCanvas.tsx` reads nothing from `scene.objects`, and
`engine/authoring/seek.ts` operates only on `Beat.timeline` actions.

Sub-project **#2** is the editor UI for objects, sliced into three:

| Slice | Delivers |
| --- | --- |
| **#2a** *(this spec)* | Canvas object **foundation**: overlay render, click-to-select, Inspector editing, add/delete, drag-to-move. |
| **#2b** | Resize + rotate handles; a shared pointer-drag hook; rotation-aware geometry. |
| **#2c** | Layers & grouping panel: z-reorder, group/ungroup (multi-select), rename, hide/lock, add-object surface. |

Engine/playback rendering of objects remains **#3**. #2a draws an **authoring-time overlay**,
independent of the engine — the editor's edit view, not the playback render (decided in brainstorm).

## 1. Scope

### 1.1 In scope (#2a)

The smallest usable object-authoring loop: see objects on the canvas, add them, select them, edit
their properties via the Inspector, delete them, and drag them to reposition.

### 1.2 Explicitly deferred

- **→ #2b:** resize (8-handle) + rotate on the selection box; a shared `usePointerDrag` hook;
  rotation-aware drag geometry. #2a renders an object's `rot` but provides no handle to change it.
- **→ #2c:** the layers/grouping panel; multi-select; group-as-selection-unit (click-group /
  double-click-to-enter); rename; hide/lock UI; per-row z-order controls. #2a selects **individual
  leaf objects** and honors existing `hidden`/`locked` flags but exposes no UI to set them.
- **→ #3:** the real engine/playback render of objects. #2a's overlay is authoring-only.

## 2. Guiding decisions (locked in brainstorm)

| Decision | Choice |
| --- | --- |
| Object render in editor | An **authoring-time overlay** (`ObjectsLayer`), independent of the engine seek renderer. |
| Selection model | **Mutually exclusive** `selectedObjectPath` XOR `selectedAction`; both feed the one Inspector; both clear on beat change. |
| Drag commit model | **Transient preview during drag, one batched commit on pointer-up** via a new `updateObjectTransform` (one undo entry per drag). |
| Which scene's objects | The **selected beat's scene** (`beats[selected].sceneId` → `doc.scenes.find(...).objects`), shown on every beat of that scene (objects are scene-level, per #1). |
| Move affordance | Drag the **selected object's body** (no separate move handle). |
| Add-object control | A compact **add-object control in the top bar** (`.ed__bar`); #2c later owns the richer surface. |

## 3. Store additions (`lib/editor/store.ts`, `lib/editor/mutations.ts` or `object-mutations.ts`)

### 3.1 Selection state

- New state field `selectedObjectPath: ObjectPath | null` (uses the existing `ObjectPath = number[]`
  from `lib/editor/object-tree.ts`).
- New method `selectObject(path: ObjectPath | null)`: sets `selectedObjectPath`, **clears
  `selectedAction`**.
- Existing `selectAction(i)`: also **clears `selectedObjectPath`** (mutual exclusion).
- Existing `select(i)` (beat change): clears **both** `selectedAction` and `selectedObjectPath`
  (mirrors today's action-clear on beat change).
- Undo/redo and delete already clamp `selectedAction`; extend the same clamping to clear
  `selectedObjectPath` when it no longer resolves (e.g. after the object or its scene changes).

### 3.2 Batched transform mutation

- New pure mutation `updateObjectTransform(doc, sceneId, path, patch: Partial<ObjectTransform>): DeckDoc`
  — merges `{ ...obj.transform, ...patch }` immutably at `path`, preserving the no-op-returns-same-
  reference convention (unknown scene/path → same `doc`). Sits beside the #1 object mutations.
- New store method `updateObjectTransform(sceneId, path, patch)` routed through `commit` → **one undo
  entry**. This is the primitive #2b's resize/rotate reuse.

### 3.3 Add/select wiring

- `addObject` (exists from #1) — the store wrapper sets `selectedObjectPath` to the newly inserted
  object's path and ensures the Inspector is shown (not Deck-settings). New objects use the registry
  default transform (centered box), so they appear selected and ready to drag.
- `deleteObject` (exists from #1) — after delete, `selectedObjectPath` is cleared.

## 4. `ObjectsLayer` overlay (`components/editor/ObjectsLayer.tsx`)

A new `"use client"` component mounted **inside the canvas `host` div** in `DeckCanvas.tsx`, as a
sibling to `ArtStage`, the `cin` text host, and `PosHandle`.

- **Source:** reads live from the store — `doc`, `selected`, `beats[selected].sceneId` — and resolves
  `doc.scenes.find(s => s.id === sceneId)?.objects ?? []`. (Objects are read live from the doc by
  scene id, not cached on `FlatBeat`.)
- **Render order:** depth-first, back-to-front (`objects[0]` backmost; a group renders its `children`
  in order at the group's slot) — matches #1's paint-order contract.
- **Coordinate math (same as `PosHandle`):** each object is an absolutely-positioned box —
  `left: ${x*100}% top: ${y*100}% width: ${w*100}% height: ${h*100}%`, `transform: rotate(${rot ?? 0}deg)`,
  `transformOrigin` per `anchor` (`center` → `50% 50%`, `top-left` → `0 0`), `opacity: opacity ?? 1`.
- **Per-kind rendering** (authoring approximation, not the engine render):
  - **text** → styled `<div>`: font size mapped from `style.size` (lg/md/sm), `text-align` from
    `style.align`, `color`, `font-weight` from `bold`, `font-style` from `italic`.
  - **image** → `<img src>` with `object-fit: ${fit ?? "contain"}`, `border-radius: 50%` if `round`.
    Empty `src` → a labeled placeholder box (consistent with how media placeholders read).
  - **shape** → a `<div>`/inline `<svg>`: `rect` (fill, stroke, `border-radius` from `radius`),
    `ellipse` (`border-radius: 50%`), `line` (an `<svg><line>` corner-to-corner per anchor).
  - **group** → no fill; a bounding frame drawn **only when the group is selected**.
- **Visibility:** an object with `hidden: true` is **not drawn** in the overlay (editor hide; does not
  affect playback, which is #3).
- **Z-index:** the objects layer sits above `PosHandle`'s `zIndex: 5` (objects ~10, selection outline
  ~20). Paint order: art → text → objects → handles.

## 5. Click-to-select + hit-testing

- Clicking an object selects the **topmost leaf object** under the cursor (last-painted wins), via
  `selectObject(path)`.
- Clicking empty canvas (the host background, not an object) deselects: `selectObject(null)`.
- `locked: true` objects are not hit-selectable (click passes through to whatever is beneath).
- Grouped children select **individually** in #2a. Group-as-selection-unit and double-click-to-enter
  are **#2c**.
- The selected object shows a **highlighted outline** (`.ed__obj--selected`). No resize/rotate handles
  in #2a (that's #2b) — selection just outlines and enables body-drag.

## 6. Drag-to-move (transient + committed)

Dragging the **selected object's body** repositions it:

- `onPointerDown` on the selected object begins a local drag: record the pointer offset within the box
  and the starting transform in **component state** (no store write).
- `onPointerMove` updates a **local preview transform** so the box tracks the cursor live; the overlay
  renders the preview for the dragged object. Uses `host.getBoundingClientRect()` per move
  (resize-safe), mapping `(clientX - rect.left)/rect.width` etc., clamped to `[0,1]`.
- `onPointerUp` commits once: `updateObjectTransform(sceneId, path, { x, y })` — **one undo entry per
  drag** — then clears local drag state.
- The existing action `PosHandle` is **left unchanged** (out of #2a scope).

## 7. Inspector branching (`components/editor/Inspector.tsx`)

Extend the Inspector (which today early-returns unless an action is selected):

- If `selectedObjectPath` is set: resolve the object via `getObjectAt(scene.objects, path)`, render
  `descriptorForObject(obj).schema` with the **same `<Field>` component**, writing back via
  `updateObject(sceneId, path, f.key, v)`. Include a **Delete** button for the object.
- Else if `selectedAction` is set: today's action path (unchanged).
- Else: empty state — "Select an object or action to edit."
- `sceneId` is derived from `beats[selected].sceneId` (already on `FlatBeat`).

## 8. Add / delete object

- **Add:** a compact control in the top bar `.ed__bar` — `+Text / +Image / +Shape` buttons (or a small
  `<select>` mirroring the timeline's add-action control, populated from `OBJECT_REGISTRY` excluding
  `group`, since groups are created via #2c's grouping). Calls `addObject(sceneId, kind)`; the new
  object appears centered, selected, and ready to drag. Adding while Deck-settings is open switches to
  the Inspector.
- **Delete:** a Delete button in the Inspector's object view, plus the `Delete`/`Backspace` key when an
  object is selected and focus isn't in a text field. Calls `deleteObject(sceneId, path)`.

## 9. Styling / integration

- New rules in `app/editor/editor.css`: `.ed__obj`, `.ed__obj--text`, `.ed__obj--image`,
  `.ed__obj--shape`, `.ed__obj--group`, `.ed__obj--selected`, and the add-object control — all using
  `--ed-*` theme tokens (no hardcoded colors). Per-object positioning stays inline `style` (computed
  from transform fractions), matching `PosHandle`.
- No new dependencies. Follows the existing global-CSS + inline-dynamic-style conventions of the editor
  tree (no CSS Modules, no Tailwind).

## 10. Testing

- **Unit (vitest):** `updateObjectTransform` pure mutation (batched merge, immutability, no-op
  same-reference); store `selectObject`/`selectAction` mutual exclusion; `select` (beat change) clears
  both; `addObject` selects the new object; `deleteObject` clears selection.
- **Component/e2e (Playwright, matching existing `e2e/*.spec.ts`):** add an object → it renders in the
  overlay; click an object → outline + Inspector shows object fields; edit a field → overlay updates;
  drag the body → exactly one position change and a single undo reverts it; delete → object removed and
  selection cleared; click empty canvas → deselects.

## 11. Consequences & follow-ons

- **#2b** adds resize/rotate handles on the selection box, extracts a shared `usePointerDrag` hook from
  #2a's move logic, and reuses `updateObjectTransform` for multi-field resize/rotate commits.
- **#2c** adds the layers panel (multi-select, grouping UI, rename, hide/lock, z-reorder) — the
  `selectedObjectPath` state and `ObjectsLayer` render from #2a are its substrate; multi-select likely
  generalizes `selectedObjectPath` to a selection set.
- **#3** replaces the authoring overlay's role during playback with the real engine render; #2a's
  overlay remains the edit-view.
