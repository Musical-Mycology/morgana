# Object Resize + Rotate Handles (#2b) — Design Spec

- **Date:** 2026-07-21
- **Status:** Design spec (approved for planning)
- **Sub-project:** #2b of the "first-class object model" effort (slice 2 of 3 within sub-project #2)
- **Depends on:** #1 (object data model — `Scene.objects`, `updateObjectTransform` mutation, object
  registry), landed in PR #15; #2a (canvas object foundation — `ObjectsLayer`, `selectedObjectPath`,
  store `updateObjectTransform`, drag-to-move), landed in PR #16 (merged to `main`).
- **Companion docs:**
  [`2026-07-21-object-canvas-foundation-2a-design.md`](2026-07-21-object-canvas-foundation-2a-design.md) (#2a),
  [`2026-07-21-object-layer-model-design.md`](2026-07-21-object-layer-model-design.md) (#1 data model),
  [`2026-06-29-morgana-end-state-design.md`](../../2026-06-29-morgana-end-state-design.md) (north star §4).

---

## 0. Context

Sub-project **#2** is the editor UI for the object model, sliced into three:

| Slice | Delivers |
| --- | --- |
| **#2a** *(done, PR #16)* | Canvas object **foundation**: overlay render, click-to-select, Inspector editing, add/delete, drag-to-move. |
| **#2b** *(this spec)* | **Resize + rotate handles** on the selection box; a shared `usePointerDrag` hook; rotation-aware geometry. |
| **#2c** | Layers & grouping panel: z-reorder, group/ungroup (multi-select), rename, hide/lock, add-object surface. |

#2a rendered objects as absolutely-positioned boxes in an authoring overlay (`ObjectsLayer`),
click-to-select into `selectedObjectPath`, and **drag-to-move** with a transient preview committed once
on pointer-up via the store's `updateObjectTransform(sceneId, path, patch)` (one undo entry per
gesture). The move-drag logic lives **inline** in `ObjectsLayer`. #2b adds direct-manipulation
**resize** (8 handles) and **rotate** (1 handle) on the selected object, refactors the move-drag onto a
shared hook, and reuses the same transient-preview-then-single-commit model.

Engine/playback rendering of objects remains **#3**. #2b operates purely on the authoring overlay and
manipulates only existing `transform` fields — **no schema changes**.

## 1. Scope

### 1.1 In scope (#2b)

- **Resize:** 8 handles (4 corners + 4 edges) on the selection box. Corner handles change two dimensions;
  edge handles change one. Handles that move an edge opposite the box origin adjust `x`/`y` as well as
  `w`/`h` so the pinned corner/edge stays fixed on screen.
- **Rotate:** a rotate handle above the top edge that sets `transform.rot` (degrees).
- **Rotation-aware geometry:** resize and rotate are correct at any existing `rot`. All angle math is
  done in **screen-pixel space** off `host.getBoundingClientRect()` (the stage is 16:9, so the x and y
  normalized→pixel scales differ), then converted back to normalized `transform` fractions.
- **Modifiers:** `Shift`+corner-drag preserves aspect ratio; `Shift`+rotate snaps to 15° increments.
- **Shared `usePointerDrag` hook:** extracted from #2a's inline move logic and reused for move + resize +
  rotate. Encapsulates the window `pointermove`/`pointerup` lifecycle, per-move rect capture, and the
  zero-movement commit guard.
- **New `SelectionOverlay` component:** renders the rotated selection frame, the 8 resize handles, and
  the rotate handle for the selected object; owns the handle gestures.
- **Min-size clamp, no flip:** handles cannot shrink a box below a small minimum or drag it past the
  pinned edge to flip it.

### 1.2 Explicitly deferred

- **→ #2c:** layers/grouping panel; multi-select; group-as-selection-unit; rename; hide/lock UI;
  z-reorder. `SelectionOverlay` is written so #2c's multi-select bounding box can reuse it, but #2b
  selects and manipulates a **single** object.
- **→ #3:** the real engine/playback render of objects. #2b's overlay is authoring-only.
- **Not in v1:** box flipping (negative-dimension drag past the pinned edge); free-rotation numeric
  entry; per-handle keyboard nudging.

## 2. Guiding decisions (locked in brainstorm)

| Decision | Choice |
| --- | --- |
| Rotation-aware resize | **Full rotated-frame resize** — resize is correct at any `rot`, computed in the object's local frame via screen-pixel projection. |
| Modifiers | **Both** — `Shift`+corner = aspect lock; `Shift`+rotate = 15° snap. |
| Component structure | A **new sibling `SelectionOverlay`** component rendered by `ObjectsLayer` for the selected object; not inline in `ObjectsLayer`. |
| Shared drag | A **`usePointerDrag` hook** powers move + resize + rotate; #2a's inline move-drag is refactored onto it. |
| Transient preview | Kept in **`ObjectsLayer` component state** (`preview: {path, patch}`), **never** written to the store during a gesture (honors #2a's no-store-writes-on-pointermove rule). |
| Commit | One `updateObjectTransform(sceneId, path, patch)` on pointer-up = **one undo entry**; zero-movement gesture writes nothing. |
| Min size / flip | Clamp to a small minimum; **no flip** in v1. |

## 3. Pure geometry helpers (`lib/editor/object-drag.ts`, extended)

The existing `pointerFraction(rect, clientX, clientY)` stays. Two new pure functions are added beside it.
All are React-free and DOM-mutation-free so they unit-test in jsdom (which returns a zero-size
`getBoundingClientRect`, so real layout cannot be exercised — the helpers take `rect` as a parameter).

### 3.1 Coordinate model

- `transform = { x, y, w, h, rot?, anchor? }`, all of `x,y,w,h` normalized 0–1 on the fixed 16:9 stage;
  `rot` in degrees; `anchor` is `"center"` (default) or `"top-left"`.
- Host rect gives pixel size `W = rect.width`, `H = rect.height`. A normalized point `(fx, fy)` maps to
  pixels `(fx·W, fy·H)`.
- **Key insight:** CSS applies `rotate(rot)` to the already-pixel-sized box, so the on-screen box is a
  *rigid* rotation of a `(w·W) × (h·H)` pixel rectangle about its pivot. Screen-pixel space is therefore
  Euclidean — do all angle/projection math there, then divide x-extents by `W` and y-extents by `H` to
  return to normalized space. This is why deltas must come from pixels, not normalized coords.
- **Pivot** (rotation origin, matching #2a's `transformOrigin`): for `anchor: "center"` the pivot is the
  box center `((x + w/2)·W, (y + h/2)·H)`; for `anchor: "top-left"` the pivot is the box top-left
  `(x·W, y·H)`. The helpers take the pivot as a derived value so both anchors are handled by one path.

### 3.2 `rotateTransform`

```
rotateTransform(
  t: ObjectTransform,
  rect: DOMRect,
  pointerClientX: number,
  pointerClientY: number,
  opts?: { snap?: boolean },
): { rot: number }
```

- Compute pivot px (per §3.1) and the pointer px `(Px, Py)`.
- `angleDeg = atan2(Py − pivotY, Px − pivotX)` in degrees; re-base so the rotate handle's rest position
  (straight up from the box, i.e. −90° in screen space) maps to `rot = 0`, giving
  `rot = angleDeg + 90`.
- Normalize into a canonical range (e.g. `(−180, 180]`).
- If `opts.snap`, round to the nearest 15°.

### 3.3 `resizeTransform`

```
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

resizeTransform(
  t: ObjectTransform,
  handle: ResizeHandle,
  rect: DOMRect,
  pointerClientX: number,
  pointerClientY: number,
  opts?: { aspect?: boolean },
): { x: number; y: number; w: number; h: number }
```

- Let `θ = rot·π/180`, local axes `e1 = (cosθ, sinθ)` (box's +local-x in screen px) and
  `e2 = (−sinθ, cosθ)` (+local-y).
- Compute the **pinned point** `F` in screen px = the corner or edge-midpoint opposite `handle` in the
  box's current rotated screen position (derived from center px + `R(θ)`·(local corner offset), where
  local corner offsets use current `pw = w·W`, `ph = h·H`).
- Pointer px `P`. New local pixel extents:
  - corner handle → `newPw = |(P − F)·e1|`, `newPh = |(P − F)·e2|`;
  - edge handle `n`/`s` → only `newPh` changes (`newPw = pw`); `e`/`w` → only `newPw` changes.
- **Clamp** `newPw`, `newPh` to a minimum `MIN_PX` (e.g. 8px); do **not** allow the sign to flip (the box
  never crosses `F`).
- **Aspect lock** (`opts.aspect`, corner handles only): constrain `newPw`/`newPh` to the original
  `pw/ph` ratio (scale both by the larger of the two per-axis factors).
- New center px = `F + R(θ)`·(offset of `F` relative to center for the *new* `newPw,newPh`). New
  normalized `w = newPw/W`, `h = newPh/H`; `x = centerX/W − w/2`, `y = centerY/H − h/2` for
  `anchor: "center"` (top-left anchor computes `x,y` from the pinned top-left directly).
- Round outputs to 3 decimals (matches #2a's `toFixed(3)` convention) so a no-op release is detectable.

## 4. Shared pointer-drag hook (`lib/editor/usePointerDrag.ts`, new)

A `"use client"` hook that captures the window-level drag lifecycle #2a implemented inline, so move,
resize, and rotate share one code path:

```
usePointerDrag(opts: {
  hostRef: RefObject<HTMLDivElement | null>;
  onMove: (ctx: { rect: DOMRect; clientX: number; clientY: number; e: PointerEvent }) => void;
  onCommit: (ctx: { rect: DOMRect; clientX: number; clientY: number; e: PointerEvent; moved: boolean }) => void;
}): (e: ReactPointerDown) => void   // returns an onPointerDown handler
```

- On `onPointerDown`: `preventDefault` + `stopPropagation`, capture the start rect (bail if
  `rect.width === 0`), attach `pointermove`/`pointerup` to `window`.
- Each `pointermove`: re-read `hostRef.getBoundingClientRect()` (resize-safe), call `onMove(ctx)`.
- On `pointerup`: detach listeners, compute `moved` (pointer traveled a non-trivial pixel distance from
  start), call `onCommit(ctx)`. `moved === false` lets callers skip the store write (the zero-movement
  guard), preserving "a pure click creates no history entry."
- The hook does **not** itself write to the store or hold preview state — callers own that (move-preview
  and resize/rotate-preview differ), keeping the hook single-purpose.

## 5. `ObjectsLayer` refactor (`components/editor/ObjectsLayer.tsx`)

- Replace the ad-hoc `drag: {path, x, y}` state with a general
  `preview: { path: ObjectPath; patch: Partial<ObjectTransform> } | null`. Effective transform for any
  object = `pathEq(preview.path, path) ? { ...t, ...preview.patch } : t`. Both the object box and
  `SelectionOverlay` render from the effective transform, so box + handles track together during a
  gesture.
- **Body-move** is rewritten onto `usePointerDrag`: `onMove` sets `preview` with a `{x,y}` patch
  (offset math unchanged from #2a); `onCommit` calls `updateObjectTransform(sceneId, path, {x,y})` only
  when `moved` and the rounded value actually changed, then clears `preview`.
- For the **selected, unlocked** object, `ObjectsLayer` renders `<SelectionOverlay …>` passing: the
  effective transform, `hostRef`, `sceneId`, `path`, a `setPreview` callback, and the store's
  `updateObjectTransform`. The overlay is not rendered for `locked` objects or when nothing is selected.

## 6. `SelectionOverlay` component (`components/editor/SelectionOverlay.tsx`, new)

A `"use client"` component that draws the manipulation affordances over the selected object:

- Renders a frame positioned exactly like the object box — same `left/top/width/height` percentages,
  same `transform: rotate(rot)` and `transformOrigin` (anchor) — so the browser rotates the frame and its
  handles rigidly; **handle screen positions come for free from layout** (no manual handle-position math
  needed for rendering; the geometry helpers only need `rect` + pointer for the *gesture*).
- **8 resize handles** positioned at the frame's corners/edge-midpoints (`0%/50%/100`), plus a **rotate
  handle** offset above the top edge (connected by a short stem). Each is a small `--ed-*`-tokened dot.
- Each handle's `onPointerDown` is wired via `usePointerDrag`:
  - resize handle → `onMove` computes `resizeTransform(t, handle, rect, x, y, {aspect: e.shiftKey})`
    and calls `setPreview({path, patch})`; `onCommit` calls `updateObjectTransform(sceneId, path, patch)`
    when `moved`, then clears preview.
  - rotate handle → `onMove` computes `rotateTransform(t, rect, x, y, {snap: e.shiftKey})` → preview;
    `onCommit` commits `{rot}`.
- `e.shiftKey` is read live per `pointermove` (via the event in the `onMove` ctx) so the modifier can be
  toggled mid-drag.

## 7. Layering / pointer priority

- The `ObjectsLayer` wrapper stays `pointer-events: none`; only interactive islands opt in.
- Handles are `pointer-events: auto` and sit **above** the object box and the `.ed__obj--selected`
  outline (which #2a puts at `z-index: 20`) — handles ~`z-index: 30`, rotate handle same layer.
- Each handle's `onPointerDown` calls `stopPropagation`, so a handle grab wins over body-move and over
  the `objects-deselect` catcher.
- The selection **frame between handles** is `pointer-events: none`, so clicking the body still reaches
  the object box beneath for select/move.
- `locked` objects render no overlay and remain non-hit-selectable (unchanged from #2a).

## 8. Styling (`app/editor/editor.css`, extended)

- New rules: `.ed__sel-frame` (the rotated frame, subtle border), `.ed__handle` (resize dot; size,
  border, `background: var(--ed-bg)`, `border-color: var(--ed-accent)`), `.ed__handle--rotate` (rotate
  dot + stem), and per-handle `cursor` values (`nwse-resize`/`nesw-resize`/`ns-resize`/`ew-resize` for
  the axis-aligned case; acceptable that cursors don't rotate with the box in v1).
- All colors via `--ed-*` tokens; positioning stays inline `style` (computed from transform fractions),
  matching `PosHandle`/`ObjectsLayer`. No new dependencies, no CSS Modules, no Tailwind.

## 9. Testing

### 9.1 Unit (vitest — the local TDD gate)

- `rotateTransform`: angle from pointer for cardinal positions (right → 90°, up → 0°, etc.); re-basing so
  straight-up = 0; snap rounds to nearest 15°; correct with `anchor: "top-left"` pivot; anisotropic
  `W ≠ H` handled (angle uses pixels).
- `resizeTransform`: each of the 8 handles pins the correct opposite corner/edge; corner vs edge change
  the right dimension(s); min-size clamp and no-flip; aspect lock constrains ratio; **non-zero `rot`**
  produces a correctly rotated-frame resize; `W ≠ H` correctness; 3-decimal rounding.
- Zero-movement guard: a down-up with no move commits nothing (via the hook's `moved` flag / caller).

### 9.2 e2e (Playwright — CI; mirrors `e2e/object-drag.spec.ts`)

- Select an object → the overlay with handles appears.
- Drag a corner handle → the box resizes; a single undo reverts it (one history entry).
- Drag the rotate handle → `rot` changes; a single undo reverts it.
- `Shift`+corner preserves aspect; `Shift`+rotate snaps.
- A handle grab does not move the body (priority), and clicking the body still moves it.
- Known env gotcha: the existing worktree's `node_modules/next` is incomplete, so Playwright may only run
  in CI / a fresh `npm ci` worktree; `npm test` + `npx tsc --noEmit -p .` are the local gate.

## 10. Consequences & follow-ons

- **#2c** (layers/grouping) reuses `SelectionOverlay` for a multi-object bounding box, and generalizes
  `selectedObjectPath` to a selection set; the `usePointerDrag` hook and geometry helpers are shared
  infrastructure it inherits.
- **#3** (engine render) is unaffected — #2b touches only the authoring overlay and existing `transform`
  fields.
- No data-model or store-API changes beyond reusing `updateObjectTransform`; the store's one-commit-per-
  gesture contract is preserved.
