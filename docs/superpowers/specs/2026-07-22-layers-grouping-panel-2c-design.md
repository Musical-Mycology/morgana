# Layers & Grouping Panel (#2c) — Design Spec

- **Date:** 2026-07-22
- **Status:** Design spec (approved for planning)
- **Sub-project:** #2c of the "first-class object model" effort (slice 3 of 3 within sub-project #2)
- **Depends on:** #1 (object data model + grouping mutations, PR #15), #2a (canvas object foundation, PR #16), #2b (resize + rotate handles, PR #17) — **all merged to `main`; branch from `main`.**
- **Companion docs:**
  [`2026-07-21-object-layer-model-design.md`](2026-07-21-object-layer-model-design.md) (#1 data model),
  [`2026-07-21-object-canvas-foundation-2a-design.md`](2026-07-21-object-canvas-foundation-2a-design.md) (#2a),
  [`2026-06-29-morgana-end-state-design.md`](../../2026-06-29-morgana-end-state-design.md) (north star §4).

---

## 0. Context

Sub-project **#2** is the editor UI for the first-class object model, sliced into three:

| Slice | Delivers | Status |
| --- | --- | --- |
| **#2a** | Canvas object foundation: overlay render, click-to-select (single), Inspector editing, add/delete, drag-to-move. | Merged (PR #16) |
| **#2b** | Resize + rotate handles (`SelectionOverlay`); shared `usePointerDrag`; rotation-aware geometry. | Merged (PR #17) |
| **#2c** *(this spec)* | Layers & grouping panel: tree navigator, z-reorder, group/ungroup (multi-select), rename, hide/lock, in-panel add; canvas group-as-selection-unit. | This spec |

Engine/playback rendering of objects remains **#3**.

### 0.1 What already exists (the substrate #2c builds on)

- **Data model (#1, fixed):** `Scene.objects?: SceneObject[]` — a nested tree of `text`/`image`/`shape`/`group`. Each object carries `id`, optional `name`, `opacity`, `transform` (`{x,y,w,h,rot?,anchor?}`, 0–1 on the 16:9 stage), and editor flags `hidden`/`locked`. Painted back-to-front in depth-first document order (index 0 = backmost).
- **Grouping mutations (#1, pure, already store-wired):** `groupObjects(sceneId, paths, groupId)` (⚠️ requires the paths to be **same-parent siblings**, else no-op), `ungroupObject(sceneId, path)`, `reparentObject(sceneId, from, toParent, toIndex)`, `reorderObject(sceneId, path, dir)` (neighbour swap), `addObject`, `updateObject`, `updateObjectTransform`, `deleteObject`.
- **Tree helpers (#1):** `getObjectAt`, `getObjectListAt`, `mapChildList`, `collectObjectIds`, `findObjectPath`, `isPrefix`, `uniqueObjectId`, `type ObjectPath = number[]` in `lib/editor/object-tree.ts`.
- **Selection (#2a):** `selectedObjectPath: ObjectPath | null` — **single**, mutually exclusive with `selectedAction`, cleared on beat-change / undo / delete. Consumers: `ObjectsLayer` (body-drag), `SelectionOverlay` (#2b handles), `Inspector` (object branch), `app/editor/page.tsx` (Delete/Backspace key).
- **Canvas (#2a/#2b):** `ObjectsLayer` renders every non-hidden object; groups draw a bounding frame only when selected; body-drag moves the selected object via transient-preview + single `updateObjectTransform` commit; `SelectionOverlay` renders 8 resize handles + a rotate handle for the selected (non-locked, non-hidden) object.
- **Layout:** `app/editor/editor.css` — a fixed CSS grid `grid-template-columns: 200px 1fr 280px`, areas `bar / film canvas inspector / film timeline timeline`. Left `film` column = Filmstrip (beats); right `inspector` column = property editing. No free cell.
- **Add-object stopgap (#2a):** a `+ Add object…` `<select>` in the top `.ed__bar` (`app/editor/page.tsx`), explicitly flagged as a stopgap for #2c to replace.

## 1. Scope

### 1.1 In scope (#2c)

The docked **layers panel** — a structural navigator over the current scene's objects, parallel to how the Filmstrip navigates beats and the Timeline navigates actions — plus the store and canvas changes it requires:

1. **Multi-select store model** — generalize single-select to an ordered selection set with a derived primary.
2. **Layers tree UI** (`LayersPanel`) — one row per object, indented by depth, groups expand/collapse; rows show kind icon + `name`, a hide toggle, a lock toggle; inline rename.
3. **Z-order** — raise/lower the primary via toolbar buttons (`reorderObject`).
4. **Grouping** — multi-select rows/objects → group (`groupObjects`) / ungroup (`ungroupObject`) via toolbar buttons.
5. **Hide / lock** — per-row toggles wired to `updateObject`.
6. **In-panel add-object** — a trailing add control; the #2a top-bar stopgap is removed.
7. **Canvas group-as-selection-unit** — clicking a grouped object selects its top-level group; double-click enters the group (PowerPoint model); panel and canvas selection stay in sync.
8. **Group move** — dragging a selected group offsets the group and all descendants (one new pure mutation).

### 1.2 Explicitly deferred (follow-ons)

- **In-tree drag-and-drop** — drag-to-reorder and drag-to-reparent within the tree. `reparentObject` stays wired for it; v1 reaches reparenting via group/ungroup only. Buttons deliver z-order for v1.
- **Multi-object resize/rotate** — handles render for a single primary only; a multi-selection bounding box with group resize is out of scope.
- **Reparent UI beyond group/ungroup** — moving a single child out of / into an existing group without regrouping is deferred (needs the drag tree).
- **Engine/playback render of objects** — that is **#3**. The panel and canvas overlay remain authoring-time.

## 2. Guiding decisions (locked in brainstorm)

| # | Decision | Choice |
| --- | --- | --- |
| 1 | **Multi-select model** | Replace `selectedObjectPath` with `selectedObjectPaths: ObjectPath[]`; **last entry = primary** (drives Inspector + #2b handles). A derived `primaryPath()` keeps #2a/#2b consumers changing in one place. |
| 2 | **Panel docking** | **Split the left `film` column** vertically: Filmstrip (beats) on top, `LayersPanel` below. Grid unchanged; canvas stays full-width; the two structural navigators sit together on the left. |
| 3 | **Group-as-unit** | Canvas single-click selects the top-level group; **double-click enters** the group (`enteredGroupPath`); Escape / empty-click exits one level. The **panel selects the exact object at any depth** (the drill-in tool). |
| 4 | **Tree interaction (v1)** | **Buttons only** — raise/lower + group/ungroup. In-tree drag-and-drop deferred. |
| 5 | **Rename** | **Inline double-click** on the panel row → `<input>`, commit on Enter/blur. |
| 6 | **Panel order** | **Front-of-z first** (Photoshop order) — the topmost/last-painted object is the top row; index 0 (backmost) is the bottom row. |
| 7 | **Group move** | Included — dragging a selected group offsets group + all descendants via a new pure `translateObjectBy` mutation. |

## 3. Store changes (`lib/editor/store.ts`, `lib/editor/selection.ts`, `lib/editor/object-mutations.ts`)

### 3.1 Selection state

Replace the single-path field with an ordered set plus an entered-group context:

- `selectedObjectPaths: ObjectPath[]` — ordered; `[]` = nothing selected. The **last** entry is the primary.
- `enteredGroupPath: ObjectPath | null` — the group the canvas has "entered" via double-click. Panel navigation ignores it; only canvas hit-resolution and Escape/exit read it.

**New pure helper module `lib/editor/selection.ts`** (unit-tested, no store dependency):

- `primaryPath(paths: ObjectPath[]): ObjectPath | null` — last element or `null`.
- `pathsEqual(a, b): boolean`, `pathInList(list, p): boolean` — `ObjectPath` value comparison.
- `togglePath(list, p): ObjectPath[]` — add if absent, remove if present (preserves order; primary = last remaining).
- `sameParentSiblings(paths): boolean` — true when ≥2 paths share one parent and equal length (the `groupObjects` precondition; gates the Group button).
- `resolveCanvasSelection(objects, hitPath, enteredGroupPath): ObjectPath` — group-as-unit resolver (see §5.1).
- `flattenForPanel(objects, collapsed): { obj, path, depth }[]` — depth-first, then reversed for front-of-z-first display, skipping collapsed groups' children (see §4.1).

### 3.2 Selection methods

- `selectObject(path: ObjectPath | null)` — sets `[path]` (or `[]`); clears `selectedAction`. **Keeps every existing #2a call-site working** (they pass a single path or `null`).
- `toggleObjectSelection(path)` — `togglePath` into the set; clears `selectedAction`.
- `setObjectSelection(paths: ObjectPath[])` — replace wholesale; clears `selectedAction`. Used after group/ungroup.
- `enterGroup(path)` — sets `enteredGroupPath = path`.
- `exitGroup()` — pops one segment off `enteredGroupPath` (to `null` at the root); if already `null`, clears `selectedObjectPaths`.
- **Derived read for consumers:** existing code that read `selectedObjectPath` now reads `primaryPath(selectedObjectPaths)` (via a tiny selector or inline). `ObjectsLayer`, `SelectionOverlay` host, `Inspector`, and `page.tsx`'s Delete key are updated to the derived primary.

### 3.3 Clamps (extend existing)

Everywhere #2a cleared `selectedObjectPath`, now clear **both** `selectedObjectPaths` (→ `[]`) and `enteredGroupPath` (→ `null`): `select` (beat change), `selectAction`, `selectObject`/`toggle`/`set`, `undo`, `redo`, `deleteObject`, `deleteBeat`, `deleteScene`, `load`.

### 3.4 Selection-aware grouping

Today `groupObjects`/`ungroupObject` in the store don't touch selection. Make them selection-aware:

- `groupObjects(sceneId, paths)` — compute the new group id **up front** (`uniqueObjectId(doc, sceneId)`), pass it to `mGroupObjects`, and on success `setObjectSelection([findObjectPath(newObjects, groupId)])`. No-op guarded: if `sameParentSiblings(paths)` is false, do nothing (mutation is already a no-op; skip the selection change too).
- `ungroupObject(sceneId, path)` — capture the group's child count and its slot before mutating; after ungroup, select the spliced-in children (`setObjectSelection` of the `n` paths now occupying `[...parent, slot .. slot+n-1]`). Falls back to `[]` if resolution fails.

### 3.5 `translateObjectBy` mutation (new, pure)

In `lib/editor/object-mutations.ts`:

```ts
/** Offset the object at `path` — and, for a group, every descendant — by (dx, dy)
 *  in stage fractions. Used for group-as-unit drag. Unknown scene/path → same doc. */
export function translateObjectBy(doc, sceneId, path, dx, dy): DeckDoc
```

- Merges `x += dx, y += dy` onto the node's transform; if the node is a `group`, recurses into `children` applying the same offset (children hold absolute coords in #1). Values rounded to 3 dp (matching `round3`).
- Immutable, no-op-returns-same-reference (consistent with the sibling mutations).
- Store wrapper `translateObjectBy(sceneId, path, dx, dy)` routed through `commit` → **one undo entry** (one per drag).

## 4. `LayersPanel` component (`components/editor/LayersPanel.tsx`)

A new `"use client"` component mounted beneath `<Filmstrip/>` in the left column. Reads live from the store: `doc`, `selected`, `beats[selected].sceneId` → `doc.scenes.find(...).objects ?? []`. Same object source as `ObjectsLayer`.

### 4.1 Tree render (front-of-z-first)

- `flattenForPanel(objects, collapsed)` walks depth-first (parent before children), yields `{ obj, path, depth }`, **skips the children of any collapsed group**, then **reverses** the list so the topmost/last-painted object is the top row (Photoshop order). A group row is emitted immediately before its (indented) children in paint order; after reversal the group sits **above** its children — matching how nested layers read in Photoshop/Figma.
- Empty scene → a muted "No objects" placeholder above the add control (no early `null`, unlike `ObjectsLayer`, because the add control must stay reachable).

### 4.2 Row

Each row (mirrors `.ed__beat` structure with `aria-current`):

- Left pad by `depth` (e.g. `paddingLeft: 8 + depth*14`).
- **Chevron** for groups: ▸/▾ toggles collapse (panel-local state).
- **Kind icon** from `descriptorForObject(obj).icon` (or a short glyph per kind).
- **Label:** `obj.name` → fallback `` `${kind} · ${id}` ``.
- `aria-current="true"` on the **primary**; a secondary style (e.g. a subtle background) for other members of `selectedObjectPaths`.
- **Trailing toggles** (`.ed__icon`): 👁 hide (`updateObject(sceneId, path, "hidden", !hidden)`), 🔒 lock (`updateObject(sceneId, path, "locked", !locked)`). Hidden/locked rows get a dimmed / badge style so state is legible.
- `data-testid="layer-row"`, `data-obj-id={id}` for e2e.

### 4.3 Selection from the panel

- Plain click → `selectObject(path)` (exact object, any depth — bypasses group-as-unit).
- Shift/⌘-click → `toggleObjectSelection(path)`.
- The panel writes the **same** `selectedObjectPaths` the canvas reads → the two stay in sync automatically.

### 4.4 Inline rename

- Double-click the label → swap to a controlled `<input>` (panel-local `editingId` state), pre-filled with the current `name` (or empty). Enter or blur commits `updateObject(sceneId, path, "name", value.trim() || undefined)`; Escape cancels. `data-testid="layer-rename-input"`.

### 4.5 Toolbar (`.ed__icon` cluster, à la Filmstrip)

Acts on the **primary** unless noted:

- **↑ Raise** — `reorderObject(sceneId, primary, +1)`. "Raise" = visually up in the panel = higher z = later array index → `dir +1`. Disabled at the top of its sibling list.
- **↓ Lower** — `reorderObject(sceneId, primary, -1)`. Disabled at the bottom.
- **⃞ Group** — `groupObjects(sceneId, selectedObjectPaths)`. **Enabled only when `sameParentSiblings(selectedObjectPaths)`** (≥2 same-parent). 
- **⛶ Ungroup** — `ungroupObject(sceneId, primary)`. Enabled only when exactly one selected and it is a `group`.
- **✕ Delete** — `deleteObject(sceneId, primary)`.

(Raise/lower operate within the object's sibling list; crossing group boundaries is the deferred drag-reparent.)

### 4.6 Add-object control

- A trailing control mirroring `+ Scene` (Filmstrip) / `+ Add action` (Timeline): a `+ Object ▾` `<select>` or button-set over `["text","image","shape"]` (excluding `group` — groups are made via the Group button). `onChange` → `addObject(sceneId, kind)` (already selects the new object) and ensures the Inspector panel is shown. `data-testid="layer-object-add"`.
- **Remove the #2a top-bar `<select>`** (`data-testid="object-add"`) from `app/editor/page.tsx`; the panel is now the object home. (Update the #2a e2e that referenced `object-add` to the new control.)

### 4.7 Panel-local view state

- `collapsed: Set<string>` (group ids) and `editingId: string | null` are `useState` in the component — pure view state, **not** in the doc, **not** undoable.

## 5. Canvas integration (`components/editor/ObjectsLayer.tsx`, `SelectionOverlay.tsx`)

### 5.1 Group-as-selection-unit

- **`resolveCanvasSelection(objects, hitPath, enteredGroupPath)`** (pure, in `selection.ts`): given the `hitPath` of the leaf under the cursor, return the path to select:
  - Walk up `hitPath`'s ancestors. Return the **highest ancestor group whose parent is at-or-inside `enteredGroupPath`** — i.e. the shallowest group that lies *within the entered context*. When `enteredGroupPath` is `null`, that is the **top-level** ancestor (root child) containing the hit.
  - If the hit is not inside any group within the entered context, return `hitPath` itself.
  - Concretely: nothing entered + click a child of a root group → selects the root group. Entered that group + click the child → selects the child (its parent === enteredGroupPath).
- **Single-click** on an object: `selectObject(resolveCanvasSelection(objects, hitPath, enteredGroupPath))` (shift/⌘ → `toggleObjectSelection` of the resolved path).
- **Double-click** on a group (or on a child that resolves to a group): `enterGroup(resolvedGroupPath)`, then `selectObject` the child under the cursor. `onDoubleClick` on the object body.
- **Empty-canvas click**: `exitGroup()` behaviour — clears selection and steps out (the existing `objects-deselect` backdrop calls a handler that exits one level then, if already at root, deselects). Simplest: empty click → `exitGroup()` if `enteredGroupPath`, else `selectObject(null)`.
- **Escape key** (in `page.tsx`, when an object is selected and focus isn't in a field): `exitGroup()`.
- Locked objects remain non-hit-testable on the canvas (pointer passes through); they stay selectable via the **panel** so they can be unlocked.

### 5.2 Multi-select rendering

- Every object whose path is in `selectedObjectPaths` gets the `ed__obj--selected` outline.
- **`SelectionOverlay` (handles) renders only when exactly one object is selected** (the primary). With ≥2 selected, outlines only, no handles. Locked/hidden primary still suppresses handles (unchanged #2b behaviour). Update `ObjectsLayer`'s `showOverlay` condition from `selectedObjectPath` to `selectedObjectPaths.length === 1 && !locked && !hidden`.

### 5.3 Group move (`translateObjectBy`)

- When the primary is a **group**, the group's body-drag (already the frame-drag path in `ObjectsLayer`) uses a **delta** model: record the start transform; `onMove` previews by offsetting the group frame; `onCommit` calls `translateObjectBy(sceneId, path, dx, dy)` once (single undo entry) so **all descendants move with the frame**.
- Non-group primaries keep #2a's absolute `updateObjectTransform({x,y})` body-drag unchanged.
- Preview for a group drag offsets the frame only (children re-render at their committed positions on pointer-up); acceptable for v1 and avoids threading a descendant preview through the overlay.

## 6. Inspector under multi-select (`components/editor/Inspector.tsx`)

- Read the primary via `primaryPath(selectedObjectPaths)`.
- **Exactly 1 selected** → today's object-field view (unchanged; renders the primary's schema, Delete button).
- **≥2 selected** → a compact summary: `"{n} objects selected"` and a hint that grouping lives in the panel toolbar. No per-field editing (YAGNI).
- **0 selected** → existing "Select an object or action to edit." empty state.

## 7. Layout & styling (`app/editor/editor.css`, `app/editor/page.tsx`)

- **Split the left column:** the existing `.ed__film` grid area hosts a flex column split into two sections — Filmstrip (top) and Layers (bottom) — each with an `.ed__lbl` header ("Beats" / "Layers") and its own `overflow: auto`. Grid template **unchanged**. Give the sections a sensible default split (e.g. Filmstrip `flex: 1 1 55%`, Layers `flex: 1 1 45%`) with a divider border; no draggable splitter for v1.
- `page.tsx`: mount `<LayersPanel/>` beneath `<Filmstrip/>` inside the left area; remove the top-bar `+ Add object…` `<select>`.
- New CSS classes reuse existing tokens (`--ed-*`), mirroring `.ed__beat` / `.ed__icon` / `.ed__lbl`: `.ed__layers`, `.ed__layer` (row), `.ed__layer--selected` / `[aria-current]`, `.ed__layer--hidden`, `.ed__layer--locked`, `.ed__layer-toolbar`, indentation via inline `paddingLeft`. No new dependencies, no CSS modules/Tailwind.

## 8. Pure helpers to extract (isolation + testability)

Per the house rule, all non-trivial tree/selection logic lands in **pure, unit-tested** functions, keeping components thin:

| Helper | Module | Purpose |
| --- | --- | --- |
| `primaryPath`, `pathsEqual`, `pathInList`, `togglePath`, `sameParentSiblings` | `lib/editor/selection.ts` | Selection-set algebra. |
| `resolveCanvasSelection` | `lib/editor/selection.ts` | Group-as-unit hit resolution. |
| `flattenForPanel` | `lib/editor/selection.ts` | Depth-first + collapse-aware + reversed panel rows. |
| `translateObjectBy` | `lib/editor/object-mutations.ts` | Group-and-descendants offset. |

## 9. Testing

**Unit (vitest):**
- `selection.ts` — `togglePath` add/remove/order; `sameParentSiblings` true/false cases (siblings, cross-parent, single, root); `primaryPath`; `resolveCanvasSelection` (nothing entered → top-level group; entered → child; non-grouped hit → self; nested groups); `flattenForPanel` (depth, collapse skipping, reversal, group-above-children).
- `object-mutations.ts` — `translateObjectBy` (leaf offset; group offsets all descendants; rounding; unknown path same-ref; immutability).
- store — `selectObject`/`toggleObjectSelection`/`setObjectSelection`/`selectAction` mutual exclusion; `enterGroup`/`exitGroup` stepping; clamps clear both fields on beat-change/undo/delete; `groupObjects` selects the new group; `ungroupObject` selects the children; `addObject` → single-selection.

**Component (jsdom + @testing-library/react):**
- `LayersPanel` — renders a row per object in front-of-z-first order with correct indentation; hide/lock toggles call `updateObject`; double-click → input → Enter commits `name`; raise/lower call `reorderObject`; Group disabled unless same-parent ≥2; Ungroup enabled only for a single group; add control calls `addObject`.
- `Inspector` — multi-selection summary vs single-object fields.

**e2e (Playwright, mirroring `e2e/objects.spec.ts` / `e2e/object-drag.spec.ts`; may rely on CI per the worktree `node_modules` gotcha):**
- Add object via panel → row appears; select in panel → canvas outline + Inspector; hide → object leaves the overlay; lock → not canvas-hit-selectable but still panel-selectable.
- Raise/lower changes paint order; group two objects → group row + single group selection; ungroup restores children.
- Canvas: click a grouped child → group selected; double-click → enter → child selectable; Escape → exits.
- Drag a selected group → all children move (single undo reverts).

## 10. Consequences & follow-ons

- **In-tree drag-and-drop** (reorder + reparent) is the natural next increment; `reparentObject` and `reorderObject` are already wired, and `LayersPanel` rows carry `data-obj-id` for drop targeting.
- **Multi-object resize** (a selection bounding box) can build on the multi-select set once a group-resize geometry helper exists.
- **#3** replaces the authoring overlay during playback with the real engine render; the panel remains the edit-time navigator.
- The selection generalization (`selectedObjectPaths`) and `enteredGroupPath` are the substrate any richer selection UX (marquee-select, select-all-in-group) would extend.
