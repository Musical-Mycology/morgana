# Object Resize + Rotate Handles (#2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add direct-manipulation resize (8 handles) and rotate (1 handle) of the selected canvas object, correct at any existing rotation, reusing #2a's transient-preview-then-single-commit model.

**Architecture:** Pure, rotation-aware geometry helpers (`resizeTransform`, `rotateTransform`) in `lib/editor/object-drag.ts` compute a `Partial<ObjectTransform>` from the host pixel rect + pointer coords. A shared `usePointerDrag` hook owns the window pointer lifecycle. A new `SelectionOverlay` component renders the rotated frame + handles and wires each handle's gesture through the hook to the geometry helpers. `ObjectsLayer` refactors its inline body-move onto the same hook, holds a transient `preview` merged into rendering, and mounts `SelectionOverlay` for the selected object. All gestures commit once on pointer-up via the existing store `updateObjectTransform`.

**Tech Stack:** Next.js (React 19, client components), Zustand store, TypeScript, vitest + @testing-library/react (jsdom) for unit/component tests, Playwright for e2e.

## Global Constraints

- No schema changes — manipulate only existing `ObjectTransform` fields (`x,y,w,h,rot,anchor`), all normalized 0–1 on the fixed 16:9 stage. `rot` is degrees **clockwise**; `anchor` defaults to `"center"`.
- All angle/projection math in **screen-pixel space** off `host.getBoundingClientRect()`, converted back to normalized by dividing x-extents by `rect.width` and y-extents by `rect.height` (the 16:9 stage makes normalized space anisotropic).
- **No store writes on pointermove.** Transient preview lives in component state; exactly one `updateObjectTransform(sceneId, path, patch)` on pointer-up = one undo entry. A gesture with no net change writes nothing (guard with `transformChanged`).
- Round all emitted transform numbers to 3 decimals (`Number(n.toFixed(3))`), matching #2a.
- CSS: `--ed-*` tokens only (available: `--ed-accent`, `--ed-fg`, `--ed-fg-muted`, `--ed-line`, `--ed-bg-0`, `--ed-bg-1`, `--ed-bg-2`). No new deps, no CSS Modules, no Tailwind.
- Local gate: `npm test` (vitest) + `npx tsc --noEmit -p .`. Playwright e2e runs in CI (worktree `node_modules/next` may be incomplete locally — never block a task on that).
- jsdom test convention (from `tests/unit/objects-layer-drag.test.tsx`): no global `PointerEvent`; dispatch `new MouseEvent("pointerdown"|"pointermove"|"pointerup", {clientX, clientY, bubbles:true, cancelable:true})`; stub `getBoundingClientRect` on the host div to a non-zero rect.

**File structure:**
- `lib/editor/object-drag.ts` (modify) — add `ResizeHandle`, `round3`, `transformChanged`, `rotateTransform`, `resizeTransform` beside the existing `pointerFraction`.
- `lib/editor/usePointerDrag.ts` (create) — shared pointer-drag hook.
- `components/editor/SelectionOverlay.tsx` (create) — rotated frame + 8 resize handles + rotate handle.
- `components/editor/ObjectsLayer.tsx` (modify) — `preview` state, body-move on the hook, mount `SelectionOverlay`.
- `app/editor/editor.css` (modify) — `.ed__sel-frame`, `.ed__handle`, `.ed__handle--rotate`.
- Tests: `tests/unit/object-resize-rotate.test.ts`, `tests/unit/use-pointer-drag.test.tsx`, `tests/unit/selection-overlay.test.tsx`, `e2e/object-resize-rotate.spec.ts`.

---

### Task 1: Rotation-aware geometry helpers

**Files:**
- Modify: `lib/editor/object-drag.ts`
- Test: `tests/unit/object-resize-rotate.test.ts`

**Interfaces:**
- Consumes: `ObjectTransform` from `@/engine/deck/types`; existing `pointerFraction`.
- Produces:
  - `type ResizeHandle = "nw"|"n"|"ne"|"e"|"se"|"s"|"sw"|"w"`
  - `round3(n: number): number`
  - `transformChanged(t: ObjectTransform, patch: Partial<ObjectTransform>): boolean`
  - `rotateTransform(t, rect, clientX, clientY, opts?: {snap?: boolean}): { rot: number }`
  - `resizeTransform(t, handle, rect, clientX, clientY, opts?: {aspect?: boolean}): { x:number; y:number; w:number; h:number }`
  - (`rect` is any `{left:number; top:number; width:number; height:number}`.)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/object-resize-rotate.test.ts`:

```ts
import { expect, test } from "vitest";
import { rotateTransform, resizeTransform, transformChanged, round3 } from "@/lib/editor/object-drag";
import type { ObjectTransform } from "@/engine/deck/types";

const rect = { left: 0, top: 0, width: 1000, height: 1000 } as DOMRect;
const wide = { left: 0, top: 0, width: 800, height: 450 } as DOMRect;
const box: ObjectTransform = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }; // center at (0.5,0.5)

test("round3 rounds to three decimals", () => {
  expect(round3(0.123456)).toBe(0.123);
});

test("transformChanged compares rounded fields", () => {
  expect(transformChanged({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { x: 0.1 })).toBe(false);
  expect(transformChanged({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { x: 0.3 })).toBe(true);
  expect(transformChanged({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { rot: 0 })).toBe(false);
  expect(transformChanged({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { rot: 15 })).toBe(true);
});

test("rotateTransform: pointer directions map to clockwise degrees, handle-up = 0", () => {
  // center at (500,500) in a 1000x1000 rect
  expect(rotateTransform(box, rect, 500, 100).rot).toBe(0);   // straight up
  expect(rotateTransform(box, rect, 900, 500).rot).toBe(90);  // right
  expect(rotateTransform(box, rect, 500, 900).rot).toBe(180); // down
  expect(rotateTransform(box, rect, 100, 500).rot).toBe(-90); // left
});

test("rotateTransform: snap rounds to nearest 15 degrees", () => {
  const near = rotateTransform(box, rect, 900, 520, { snap: true }).rot; // ~93deg -> 90
  expect(near % 15).toBe(0);
});

test("resizeTransform se handle (rot=0) pins the nw corner and grows w/h", () => {
  // nw corner at (0.4,0.4); drag se pointer to (0.7,0.7)
  const out = resizeTransform(box, "se", rect, 700, 700);
  expect(out.x).toBe(0.4);
  expect(out.y).toBe(0.4);
  expect(out.w).toBe(0.3);
  expect(out.h).toBe(0.3);
});

test("resizeTransform nw handle (rot=0) pins the se corner", () => {
  // se corner at (0.6,0.6); drag nw pointer to (0.5,0.5)
  const out = resizeTransform(box, "nw", rect, 500, 500);
  expect(out.x).toBe(0.5);
  expect(out.y).toBe(0.5);
  expect(out.w).toBe(0.1);
  expect(out.h).toBe(0.1);
});

test("resizeTransform e edge changes only width", () => {
  const out = resizeTransform(box, "e", rect, 800, 999);
  expect(out.w).toBe(0.4);   // right edge to 0.8, left pinned 0.4
  expect(out.h).toBe(0.2);   // unchanged
  expect(out.y).toBe(0.4);
});

test("resizeTransform clamps to a minimum and never flips", () => {
  const out = resizeTransform(box, "se", rect, 100, 100); // drag far past nw
  expect(out.w).toBeGreaterThan(0);
  expect(out.h).toBeGreaterThan(0);
});

test("resizeTransform aspect lock keeps w/h ratio on a corner", () => {
  const start: ObjectTransform = { x: 0.4, y: 0.4, w: 0.2, h: 0.1 }; // ratio 2:1
  const out = resizeTransform(start, "se", rect, 800, 999, { aspect: true });
  expect(round3(out.w / out.h)).toBe(2);
});

test("resizeTransform se handle is rotation-aware (rot=90)", () => {
  const rotated: ObjectTransform = { ...box, rot: 90 };
  // local +x axis now points screen-down; extend along it
  const out = resizeTransform(rotated, "se", rect, 500, 800);
  // width (local x) grows; result stays finite and within stage
  expect(out.w).toBeGreaterThan(0.2);
  expect(Number.isFinite(out.x)).toBe(true);
});

test("resizeTransform is correct under anisotropic 16:9 scaling", () => {
  // 800x450 rect: se drag pins nw, converts px extents per-axis
  const out = resizeTransform(box, "se", wide, 800 * 0.7, 450 * 0.7);
  expect(out.x).toBe(0.4);
  expect(out.y).toBe(0.4);
  expect(round3(out.w)).toBe(0.3);
  expect(round3(out.h)).toBe(0.3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/object-resize-rotate.test.ts`
Expected: FAIL — `rotateTransform`/`resizeTransform`/`transformChanged`/`round3` are not exported.

- [ ] **Step 3: Write the implementation**

Append to `lib/editor/object-drag.ts` (keep the existing `pointerFraction`):

```ts
import type { ObjectTransform } from "@/engine/deck/types";

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const DEG = Math.PI / 180;
const MIN_PX = 8;

export const round3 = (n: number) => Number(n.toFixed(3));

/** Rotate (vx,vy) by `deg` clockwise in screen (y-down) space — the CSS rotate matrix. */
function rotVec(deg: number, vx: number, vy: number): [number, number] {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [vx * c - vy * s, vx * s + vy * c];
}

/** true if any numeric field in `patch` differs (rounded) from `t`. */
export function transformChanged(t: ObjectTransform, patch: Partial<ObjectTransform>): boolean {
  return (Object.keys(patch) as (keyof ObjectTransform)[]).some(
    (k) => round3(patch[k] as number) !== round3((t[k] as number) ?? 0),
  );
}

type Rect = { left: number; top: number; width: number; height: number };

/** Rotation pivot (transform-origin) in stage pixels, honoring `anchor`. */
function pivotPx(t: ObjectTransform, W: number, H: number): [number, number] {
  const topLeft = t.anchor === "top-left";
  return [t.x * W + (topLeft ? 0 : (t.w * W) / 2), t.y * H + (topLeft ? 0 : (t.h * H) / 2)];
}

export function rotateTransform(
  t: ObjectTransform, rect: Rect, clientX: number, clientY: number,
  opts: { snap?: boolean } = {},
): { rot: number } {
  const [px, py] = pivotPx(t, rect.width, rect.height);
  const dx = clientX - rect.left - px;
  const dy = clientY - rect.top - py;
  // atan2 is clockwise in y-down space; re-base so the handle's rest (straight up) = 0.
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  deg = ((deg % 360) + 360) % 360;      // [0,360)
  if (deg > 180) deg -= 360;             // (-180,180]
  if (opts.snap) deg = Math.round(deg / 15) * 15;
  return { rot: round3(deg) };
}

// x/y "side" of each handle: +1 = far edge, -1 = near edge, 0 = centered on that axis.
const SX: Record<ResizeHandle, number> = { nw: -1, n: 0, ne: 1, e: 1, se: 1, s: 0, sw: -1, w: -1 };
const SY: Record<ResizeHandle, number> = { nw: -1, n: -1, ne: -1, e: 0, se: 1, s: 1, sw: 1, w: 0 };

/** Local-from-top-left coord for a sign along one axis (px). */
const localPos = (sign: number, size: number) => (sign > 0 ? size : sign < 0 ? 0 : size / 2);

export function resizeTransform(
  t: ObjectTransform, handle: ResizeHandle, rect: Rect, clientX: number, clientY: number,
  opts: { aspect?: boolean } = {},
): { x: number; y: number; w: number; h: number } {
  const W = rect.width, H = rect.height, rot = t.rot ?? 0;
  const pw = t.w * W, ph = t.h * H;
  const sx = SX[handle], sy = SY[handle];
  const topLeft = t.anchor === "top-left";
  const ox = topLeft ? 0 : pw / 2, oy = topLeft ? 0 : ph / 2;
  const [pivX, pivY] = [t.x * W + ox, t.y * H + oy];

  // fixed point F = the corner/edge opposite the dragged handle, in stage px.
  const fLx = localPos(-sx, pw), fLy = localPos(-sy, ph);
  const [fRx, fRy] = rotVec(rot, fLx - ox, fLy - oy);
  const Fx = pivX + fRx, Fy = pivY + fRy;

  // pointer relative to F, projected onto the box's local axes.
  const gx = clientX - rect.left - Fx, gy = clientY - rect.top - Fy;
  const [e1x, e1y] = rotVec(rot, 1, 0);   // local +x
  const [e2x, e2y] = rotVec(rot, 0, 1);   // local +y
  const a = gx * e1x + gy * e1y;
  const b = gx * e2x + gy * e2y;

  let newPw = sx === 0 ? pw : Math.max(MIN_PX, sx * a);
  let newPh = sy === 0 ? ph : Math.max(MIN_PX, sy * b);
  if (opts.aspect && sx !== 0 && sy !== 0) {
    const factor = Math.max(newPw / pw, newPh / ph);
    newPw = pw * factor; newPh = ph * factor;
  }

  // reconstruct top-left so F stays fixed with the new size.
  const oxN = topLeft ? 0 : newPw / 2, oyN = topLeft ? 0 : newPh / 2;
  const [fRxN, fRyN] = rotVec(rot, localPos(-sx, newPw) - oxN, localPos(-sy, newPh) - oyN);
  const pivXN = Fx - fRxN, pivYN = Fy - fRyN;
  return {
    x: round3((pivXN - oxN) / W),
    y: round3((pivYN - oyN) / H),
    w: round3(newPw / W),
    h: round3(newPh / H),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/object-resize-rotate.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/editor/object-drag.ts tests/unit/object-resize-rotate.test.ts
git commit -m "feat(objects): rotation-aware resize/rotate geometry helpers (#2b)"
```

---

### Task 2: Shared `usePointerDrag` hook

**Files:**
- Create: `lib/editor/usePointerDrag.ts`
- Test: `tests/unit/use-pointer-drag.test.tsx`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces:
  - `interface DragCtx { rect: DOMRect; clientX: number; clientY: number; e: PointerEvent | React.PointerEvent }`
  - `interface DragHandlers { onStart?: (c: DragCtx) => void; onMove: (c: DragCtx) => void; onCommit: (c: DragCtx & { moved: boolean }) => void }`
  - `usePointerDrag(hostRef): (e: React.PointerEvent, handlers: DragHandlers) => void`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/use-pointer-drag.test.tsx`:

```tsx
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef, useRef } from "react";
import { usePointerDrag, type DragHandlers } from "@/lib/editor/usePointerDrag";

afterEach(cleanup);

function firePointer(target: EventTarget, type: string, clientX: number, clientY: number) {
  target.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true }));
}

function Harness({ handlers }: { handlers: DragHandlers }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const start = usePointerDrag(hostRef);
  return (
    <div>
      <div ref={hostRef} data-testid="host" />
      <button data-testid="grip" onPointerDown={(e) => start(e, handlers)} />
    </div>
  );
}

/** stub the host's rect so the hook does not bail on a zero-size rect */
function stubHost(el: HTMLElement) {
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, width: 1000, height: 562, right: 1000, bottom: 562, x: 0, y: 0, toJSON() {} }),
    configurable: true,
  });
}

test("onStart/onMove fire and onCommit reports moved=true after a drag", () => {
  const onStart = vi.fn(), onMove = vi.fn(), onCommit = vi.fn();
  const { getByTestId } = render(<Harness handlers={{ onStart, onMove, onCommit }} />);
  stubHost(getByTestId("host"));

  firePointer(getByTestId("grip"), "pointerdown", 100, 100);
  firePointer(window, "pointermove", 300, 200);
  firePointer(window, "pointerup", 300, 200);

  expect(onStart).toHaveBeenCalledTimes(1);
  expect(onMove).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit.mock.calls[0][0].moved).toBe(true);
});

test("a movement-free press reports moved=false", () => {
  const onCommit = vi.fn();
  const { getByTestId } = render(<Harness handlers={{ onMove: vi.fn(), onCommit }} />);
  stubHost(getByTestId("host"));

  firePointer(getByTestId("grip"), "pointerdown", 100, 100);
  firePointer(window, "pointerup", 100, 100);

  expect(onCommit.mock.calls[0][0].moved).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/use-pointer-drag.test.tsx`
Expected: FAIL — module `@/lib/editor/usePointerDrag` not found.

- [ ] **Step 3: Write the implementation**

Create `lib/editor/usePointerDrag.ts`:

```ts
"use client";
import { useCallback, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

export interface DragCtx {
  rect: DOMRect;
  clientX: number;
  clientY: number;
  e: PointerEvent | ReactPointerEvent;
}
export interface DragHandlers {
  onStart?: (ctx: DragCtx) => void;
  onMove: (ctx: DragCtx) => void;
  onCommit: (ctx: DragCtx & { moved: boolean }) => void;
}

const MOVE_THRESHOLD_PX = 2;

/**
 * Window-level pointer-drag lifecycle shared by move + resize + rotate.
 * Returns a starter `(reactPointerDownEvent, handlers)` so each object/handle
 * can supply its own closures at pointer-down time (no hooks-in-a-loop).
 * Bails if the host rect is missing or zero-size (jsdom / not laid out yet).
 */
export function usePointerDrag(hostRef: RefObject<HTMLDivElement | null>) {
  return useCallback((e: ReactPointerEvent, handlers: DragHandlers) => {
    e.preventDefault();
    e.stopPropagation();
    const rect0 = hostRef.current?.getBoundingClientRect();
    if (!rect0 || rect0.width === 0) return;
    const startX = e.clientX, startY = e.clientY;
    handlers.onStart?.({ rect: rect0, clientX: e.clientX, clientY: e.clientY, e });

    const move = (ev: PointerEvent) => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      handlers.onMove({ rect, clientX: ev.clientX, clientY: ev.clientY, e: ev });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const rect = hostRef.current?.getBoundingClientRect() ?? rect0;
      const moved =
        Math.abs(ev.clientX - startX) > MOVE_THRESHOLD_PX ||
        Math.abs(ev.clientY - startY) > MOVE_THRESHOLD_PX;
      handlers.onCommit({ rect, clientX: ev.clientX, clientY: ev.clientY, e: ev, moved });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [hostRef]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/use-pointer-drag.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/editor/usePointerDrag.ts tests/unit/use-pointer-drag.test.tsx
git commit -m "feat(objects): shared usePointerDrag hook (#2b)"
```

---

### Task 3: `SelectionOverlay` component + handle styling

**Files:**
- Create: `components/editor/SelectionOverlay.tsx`
- Modify: `app/editor/editor.css`
- Test: `tests/unit/selection-overlay.test.tsx`

**Interfaces:**
- Consumes: `ResizeHandle`, `resizeTransform`, `rotateTransform`, `transformChanged` (Task 1); `usePointerDrag` (Task 2); `ObjectTransform` from `@/engine/deck/types`; `ObjectPath` from `@/lib/editor/object-tree`.
- Produces (used by Task 4):
  - `SelectionOverlay` props:
    ```ts
    {
      hostRef: RefObject<HTMLDivElement | null>;
      transform: ObjectTransform;   // effective (preview-merged) transform, for render + pointer-down snapshot
      sceneId: string;
      path: ObjectPath;
      onPreview: (patch: Partial<ObjectTransform>) => void;
      onPreviewEnd: () => void;
      commit: (sceneId: string, path: ObjectPath, patch: Partial<ObjectTransform>) => void;
    }
    ```
  - Renders `data-testid="obj-selection"` frame, `data-testid="obj-handle-<id>"` for each of the 8 resize handles, and `data-testid="obj-handle-rotate"`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/selection-overlay.test.tsx`:

```tsx
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { SelectionOverlay } from "@/components/editor/SelectionOverlay";
import type { ObjectTransform } from "@/engine/deck/types";

afterEach(cleanup);

function firePointer(target: EventTarget, type: string, clientX: number, clientY: number) {
  target.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true }));
}
function stubbedHostRef() {
  const ref = createRef<HTMLDivElement>();
  const div = document.createElement("div");
  Object.defineProperty(div, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000, x: 0, y: 0, toJSON() {} }),
    configurable: true,
  });
  ref.current = div;
  return ref;
}
const t: ObjectTransform = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };

function setup(overrides: Partial<Parameters<typeof SelectionOverlay>[0]> = {}) {
  const commit = vi.fn();
  const onPreview = vi.fn();
  const onPreviewEnd = vi.fn();
  const utils = render(
    <SelectionOverlay
      hostRef={stubbedHostRef()} transform={t} sceneId="s1" path={[0]}
      onPreview={onPreview} onPreviewEnd={onPreviewEnd} commit={commit} {...overrides}
    />,
  );
  return { commit, onPreview, onPreviewEnd, ...utils };
}

test("renders the frame, 8 resize handles, and a rotate handle", () => {
  const { getByTestId } = setup();
  ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach((id) =>
    expect(getByTestId(`obj-handle-${id}`)).toBeTruthy(),
  );
  expect(getByTestId("obj-handle-rotate")).toBeTruthy();
  expect(getByTestId("obj-selection")).toBeTruthy();
});

test("dragging the se handle commits one resize (w/h change)", () => {
  const { commit, getByTestId } = setup();
  firePointer(getByTestId("obj-handle-se"), "pointerdown", 600, 600); // se corner
  firePointer(window, "pointermove", 700, 700);
  firePointer(window, "pointerup", 700, 700);
  expect(commit).toHaveBeenCalledTimes(1);
  const [, , patch] = commit.mock.calls[0];
  expect(patch.w).toBeGreaterThan(0.2);
  expect(patch.h).toBeGreaterThan(0.2);
});

test("dragging the rotate handle commits a rot change", () => {
  const { commit, getByTestId } = setup();
  firePointer(getByTestId("obj-handle-rotate"), "pointerdown", 500, 400); // above center
  firePointer(window, "pointermove", 900, 500);                          // swing right
  firePointer(window, "pointerup", 900, 500);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit.mock.calls[0][2]).toHaveProperty("rot");
});

test("a movement-free handle press commits nothing", () => {
  const { commit, onPreviewEnd, getByTestId } = setup();
  firePointer(getByTestId("obj-handle-se"), "pointerdown", 600, 600);
  firePointer(window, "pointerup", 600, 600);
  expect(commit).not.toHaveBeenCalled();
  expect(onPreviewEnd).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/selection-overlay.test.tsx`
Expected: FAIL — module `@/components/editor/SelectionOverlay` not found.

- [ ] **Step 3: Write the component**

Create `components/editor/SelectionOverlay.tsx`:

```tsx
"use client";
import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { ObjectTransform } from "@/engine/deck/types";
import type { ObjectPath } from "@/lib/editor/object-tree";
import { usePointerDrag } from "@/lib/editor/usePointerDrag";
import { resizeTransform, rotateTransform, transformChanged, type ResizeHandle } from "@/lib/editor/object-drag";

const HANDLES: { id: ResizeHandle; cx: number; cy: number; cursor: string }[] = [
  { id: "nw", cx: 0, cy: 0, cursor: "nwse-resize" },
  { id: "n", cx: 0.5, cy: 0, cursor: "ns-resize" },
  { id: "ne", cx: 1, cy: 0, cursor: "nesw-resize" },
  { id: "e", cx: 1, cy: 0.5, cursor: "ew-resize" },
  { id: "se", cx: 1, cy: 1, cursor: "nwse-resize" },
  { id: "s", cx: 0.5, cy: 1, cursor: "ns-resize" },
  { id: "sw", cx: 0, cy: 1, cursor: "nesw-resize" },
  { id: "w", cx: 0, cy: 0.5, cursor: "ew-resize" },
];

export interface SelectionOverlayProps {
  hostRef: RefObject<HTMLDivElement | null>;
  transform: ObjectTransform;
  sceneId: string;
  path: ObjectPath;
  onPreview: (patch: Partial<ObjectTransform>) => void;
  onPreviewEnd: () => void;
  commit: (sceneId: string, path: ObjectPath, patch: Partial<ObjectTransform>) => void;
}

export function SelectionOverlay({
  hostRef, transform, sceneId, path, onPreview, onPreviewEnd, commit,
}: SelectionOverlayProps) {
  const startDrag = usePointerDrag(hostRef);
  const startT = useRef<ObjectTransform>(transform);

  const shift = (e: DragCtxEvent) => "shiftKey" in e && e.shiftKey;

  const resizeDown = (handle: ResizeHandle) => (e: ReactPointerEvent) => {
    startDrag(e, {
      onStart: () => { startT.current = transform; },
      onMove: (c) => onPreview(resizeTransform(startT.current, handle, c.rect, c.clientX, c.clientY, { aspect: shift(c.e) })),
      onCommit: (c) => {
        if (c.moved) {
          const patch = resizeTransform(startT.current, handle, c.rect, c.clientX, c.clientY, { aspect: shift(c.e) });
          if (transformChanged(startT.current, patch)) commit(sceneId, path, patch);
        }
        onPreviewEnd();
      },
    });
  };

  const rotateDown = (e: ReactPointerEvent) => {
    startDrag(e, {
      onStart: () => { startT.current = transform; },
      onMove: (c) => onPreview(rotateTransform(startT.current, c.rect, c.clientX, c.clientY, { snap: shift(c.e) })),
      onCommit: (c) => {
        if (c.moved) {
          const patch = rotateTransform(startT.current, c.rect, c.clientX, c.clientY, { snap: shift(c.e) });
          if (transformChanged(startT.current, patch)) commit(sceneId, path, patch);
        }
        onPreviewEnd();
      },
    });
  };

  const frameStyle: CSSProperties = {
    position: "absolute",
    left: `${transform.x * 100}%`, top: `${transform.y * 100}%`,
    width: `${transform.w * 100}%`, height: `${transform.h * 100}%`,
    transform: transform.rot ? `rotate(${transform.rot}deg)` : undefined,
    transformOrigin: transform.anchor === "top-left" ? "0 0" : "50% 50%",
    pointerEvents: "none",
  };

  return (
    <div data-testid="obj-selection" className="ed__sel-frame" style={frameStyle}>
      <div
        data-testid="obj-handle-rotate" className="ed__handle ed__handle--rotate"
        onPointerDown={rotateDown}
        style={{ position: "absolute", left: "50%", top: 0, pointerEvents: "auto" }}
      />
      {HANDLES.map((h) => (
        <div
          key={h.id} data-testid={`obj-handle-${h.id}`} className="ed__handle"
          onPointerDown={resizeDown(h.id)}
          style={{ position: "absolute", left: `${h.cx * 100}%`, top: `${h.cy * 100}%`, cursor: h.cursor, pointerEvents: "auto" }}
        />
      ))}
    </div>
  );
}

type DragCtxEvent = PointerEvent | ReactPointerEvent;
```

- [ ] **Step 4: Add the CSS**

In `app/editor/editor.css`, after the existing `.ed__obj--selected` rule, add:

```css
.ed__sel-frame { box-sizing: border-box; z-index: 25; }
.ed__handle {
  box-sizing: border-box; width: 10px; height: 10px;
  background: var(--ed-bg-0); border: 1px solid var(--ed-accent); border-radius: 2px;
  transform: translate(-50%, -50%); z-index: 30;
}
.ed__handle--rotate { border-radius: 50%; transform: translate(-50%, calc(-50% - 16px)); }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/selection-overlay.test.tsx`
Expected: PASS (all four cases).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/editor/SelectionOverlay.tsx app/editor/editor.css tests/unit/selection-overlay.test.tsx
git commit -m "feat(objects): SelectionOverlay with resize+rotate handles (#2b)"
```

---

### Task 4: Refactor `ObjectsLayer` onto the hook + preview + mount overlay

**Files:**
- Modify: `components/editor/ObjectsLayer.tsx`
- Tests (must stay green): `tests/unit/objects-layer.test.tsx`, `tests/unit/objects-layer-drag.test.tsx`, `tests/unit/objects-layer-select.test.tsx`

**Interfaces:**
- Consumes: `usePointerDrag` (Task 2); `SelectionOverlay` (Task 3); `pointerFraction`, `round3`, `transformChanged` (Task 1); `getObjectAt` from `@/lib/editor/object-tree`.
- Produces: unchanged public surface (`ObjectsLayer({ hostRef })`). Object boxes still render `data-testid="obj"` / `data-obj-id`; body-move still commits one undoable `{x,y}` change.

- [ ] **Step 1: Confirm the existing move tests describe current behavior**

Run: `npx vitest run tests/unit/objects-layer-drag.test.tsx`
Expected: PASS (baseline before refactor).

- [ ] **Step 2: Rewrite `ObjectsLayer.tsx`**

Replace the whole file with (renderContent is unchanged from #2a — reproduced in full so it can be applied without cross-referencing):

```tsx
"use client";
import { useRef, useState, type RefObject } from "react";
import { useEditor } from "@/lib/editor/store";
import type { SceneObject, TextObjectStyle, ObjectTransform } from "@/engine/deck/types";
import type { ObjectPath } from "@/lib/editor/object-tree";
import { getObjectAt } from "@/lib/editor/object-tree";
import { pointerFraction, round3, transformChanged } from "@/lib/editor/object-drag";
import { usePointerDrag } from "@/lib/editor/usePointerDrag";
import { SelectionOverlay } from "./SelectionOverlay";

const SIZE_PX: Record<NonNullable<TextObjectStyle["size"]>, number> = { lg: 34, md: 22, sm: 15 };

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

type Preview = { path: ObjectPath; patch: Partial<ObjectTransform> } | null;

export function ObjectsLayer({ hostRef }: { hostRef: RefObject<HTMLDivElement | null> }) {
  const doc = useEditor((s) => s.doc);
  const selected = useEditor((s) => s.selected);
  const beats = useEditor((s) => s.beats);
  const selectedObjectPath = useEditor((s) => s.selectedObjectPath);
  const selectObject = useEditor((s) => s.selectObject);
  const updateObjectTransform = useEditor((s) => s.updateObjectTransform);
  const startDrag = usePointerDrag(hostRef);
  const [preview, setPreview] = useState<Preview>(null);
  const sceneId = beats[selected]?.sceneId;
  const objects = doc?.scenes.find((sc) => sc.id === sceneId)?.objects ?? [];
  if (!objects.length) return null;

  const effOf = (t: ObjectTransform, path: ObjectPath): ObjectTransform =>
    preview && pathEq(preview.path, path) ? { ...t, ...preview.patch } : t;

  const bodyDown = (obj: SceneObject, path: ObjectPath) => (e: React.PointerEvent) => {
    if (obj.locked) return;
    selectObject(path);
    const t = obj.transform;
    let off = { x: 0, y: 0 };
    startDrag(e, {
      onStart: (c) => { const f = pointerFraction(c.rect, c.clientX, c.clientY); off = { x: f.x - t.x, y: f.y - t.y }; },
      onMove: (c) => { const f = pointerFraction(c.rect, c.clientX, c.clientY); setPreview({ path, patch: { x: round3(f.x - off.x), y: round3(f.y - off.y) } }); },
      onCommit: (c) => {
        if (c.moved) {
          const f = pointerFraction(c.rect, c.clientX, c.clientY);
          const patch = { x: round3(f.x - off.x), y: round3(f.y - off.y) };
          if (transformChanged(t, patch)) updateObjectTransform(sceneId!, path, patch);
        }
        setPreview(null);
      },
    });
  };

  const selObj = selectedObjectPath ? getObjectAt(objects, selectedObjectPath) : undefined;
  const showOverlay = selObj && !selObj.locked && !selObj.hidden && selectedObjectPath;

  return (
    <div className="ed__objects" style={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: "none" }}>
      {selectedObjectPath && (
        <div
          data-testid="objects-deselect"
          style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}
          onPointerDown={() => selectObject(null)}
        />
      )}
      {flatten(objects).map(({ obj, path }) => {
        if (obj.hidden) return null;
        if (obj.kind === "group" && !pathEq(selectedObjectPath, path)) return null;
        const t = obj.transform;
        const eff = effOf(t, path);
        const selectedCls = pathEq(selectedObjectPath, path) ? " ed__obj--selected" : "";
        const style: React.CSSProperties = {
          position: "absolute", left: `${eff.x * 100}%`, top: `${eff.y * 100}%`, width: `${eff.w * 100}%`, height: `${eff.h * 100}%`,
          transform: eff.rot ? `rotate(${eff.rot}deg)` : undefined, transformOrigin: eff.anchor === "top-left" ? "0 0" : "50% 50%",
          opacity: obj.opacity ?? 1,
        };
        return (
          <div
            key={obj.id}
            data-testid="obj"
            data-obj-id={obj.id}
            className={`ed__obj ed__obj--${obj.kind}${selectedCls}`}
            onPointerDown={bodyDown(obj, path)}
            style={{ ...style, pointerEvents: obj.locked ? "none" : "auto", cursor: "move" }}
          >
            {renderContent(obj)}
          </div>
        );
      })}
      {showOverlay && (
        <SelectionOverlay
          hostRef={hostRef}
          transform={effOf(selObj!.transform, selectedObjectPath!)}
          sceneId={sceneId!}
          path={selectedObjectPath!}
          onPreview={(patch) => setPreview({ path: selectedObjectPath!, patch })}
          onPreviewEnd={() => setPreview(null)}
          commit={updateObjectTransform}
        />
      )}
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

- [ ] **Step 3: Run the existing ObjectsLayer tests (behavior preserved)**

Run: `npx vitest run tests/unit/objects-layer-drag.test.tsx tests/unit/objects-layer.test.tsx tests/unit/objects-layer-select.test.tsx`
Expected: PASS — body-move still yields exactly one history entry; movement-free click still writes nothing; select/deselect unchanged.

- [ ] **Step 4: Add a mount test for the overlay**

Append to `tests/unit/objects-layer-select.test.tsx` (or create `tests/unit/objects-layer-overlay.test.tsx` with the file's existing imports/setup) a test:

```tsx
test("a selected, unlocked object mounts the resize/rotate overlay", () => {
  // uses the file's existing render + selectObject([0]) setup
  expect(screen.getByTestId("obj-selection")).toBeTruthy();
  expect(screen.getByTestId("obj-handle-se")).toBeTruthy();
  expect(screen.getByTestId("obj-handle-rotate")).toBeTruthy();
});
```

If creating a new file, mirror the header of `tests/unit/objects-layer-drag.test.tsx` (imports, `doc()`, `beforeEach` loading the doc + `selectObject([0])`, `stubbedHostRef`, `afterEach(cleanup)`) and render `<ObjectsLayer hostRef={stubbedHostRef()} />`.

- [ ] **Step 5: Run the new mount test**

Run: `npx vitest run tests/unit/objects-layer-select.test.tsx` (or the new file)
Expected: PASS.

- [ ] **Step 6: Full unit suite + typecheck**

Run: `npm test && npx tsc --noEmit -p .`
Expected: all green, no type errors.

- [ ] **Step 7: Commit**

```bash
git add components/editor/ObjectsLayer.tsx tests/unit/objects-layer-select.test.tsx
git commit -m "refactor(objects): ObjectsLayer uses usePointerDrag + mounts SelectionOverlay (#2b)"
```

---

### Task 5: Playwright e2e — real-layout resize + rotate

**Files:**
- Create: `e2e/object-resize-rotate.spec.ts`

**Interfaces:**
- Consumes: the running editor with #2b overlay; store `updateObjectTransform` + `undo`; `data-testid` handles from Task 3.

- [ ] **Step 1: Write the e2e spec**

Create `e2e/object-resize-rotate.spec.ts` (mirrors `e2e/object-drag.spec.ts`'s seeding + read pattern):

```ts
import { expect, test } from "@playwright/test";

async function seed(request: import("@playwright/test").APIRequestContext, id: string) {
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "RR" }, scenes: [
    { id: "s", objects: [{ id: "o-1", kind: "shape", shape: "rect", fill: "#3a6", transform: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 } }], beats: [{ id: "a", timeline: [] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "RR" } });
  await request.put(`/api/decks/${id}`, { data: doc });
}

test("resizing via the se handle grows the object and one undo reverts it", async ({ page, request }) => {
  const id = "e2e-obj-resize";
  await seed(request, id);
  await page.goto(`/editor?deck=${id}`);
  const host = page.locator(".ed__canvas-host");
  const obj = page.locator('[data-obj-id="o-1"]');
  await expect(obj).toBeVisible();
  await obj.click(); // select -> overlay appears
  await expect(page.getByTestId("obj-handle-se")).toBeVisible();

  const box = (await host.boundingBox())!;
  const se = (await page.getByTestId("obj-handle-se").boundingBox())!;
  const readW = () => obj.evaluate((el) => parseFloat((el as HTMLElement).style.width));
  const w0 = await readW();

  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, { steps: 8 });
  await page.mouse.up();

  await expect.poll(readW).toBeGreaterThan(w0);
  await page.getByTestId("undo").click();
  await expect.poll(readW).toBeCloseTo(w0, 0);
  await request.delete(`/api/decks/${id}`);
});

test("rotating via the rotate handle sets a non-zero rotation, undoable in one step", async ({ page, request }) => {
  const id = "e2e-obj-rotate";
  await seed(request, id);
  await page.goto(`/editor?deck=${id}`);
  const obj = page.locator('[data-obj-id="o-1"]');
  await expect(obj).toBeVisible();
  await obj.click();

  const readRot = () => obj.evaluate((el) => (el as HTMLElement).style.transform || "");
  const rotate = (await page.getByTestId("obj-handle-rotate").boundingBox())!;
  const objBox = (await obj.boundingBox())!;
  const cx = objBox.x + objBox.width / 2;

  await page.mouse.move(rotate.x + rotate.width / 2, rotate.y + rotate.height / 2);
  await page.mouse.down();
  await page.mouse.move(cx + objBox.width, objBox.y + objBox.height / 2, { steps: 8 }); // swing to the right
  await page.mouse.up();

  await expect.poll(readRot).toContain("rotate(");
  await page.getByTestId("undo").click();
  await expect.poll(readRot).not.toContain("rotate(");
  await request.delete(`/api/decks/${id}`);
});

test("a handle drag does not move the object body", async ({ page, request }) => {
  const id = "e2e-obj-handle-priority";
  await seed(request, id);
  await page.goto(`/editor?deck=${id}`);
  const obj = page.locator('[data-obj-id="o-1"]');
  await expect(obj).toBeVisible();
  await obj.click();
  const readLeft = () => obj.evaluate((el) => parseFloat((el as HTMLElement).style.left));
  const left0 = await readLeft();

  const se = (await page.getByTestId("obj-handle-se").boundingBox())!;
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x + 60, se.y + 60, { steps: 6 });
  await page.mouse.up();

  // se-resize pins the nw corner => left (x) must not change
  await expect.poll(readLeft).toBeCloseTo(left0, 0);
  await request.delete(`/api/decks/${id}`);
});
```

- [ ] **Step 2: Run e2e (CI, or a fresh `npm ci` worktree)**

Run: `npx playwright test e2e/object-resize-rotate.spec.ts`
Expected: 3 passed. (If local `node_modules/next` is incomplete, rely on CI — do not block.)

- [ ] **Step 3: Commit**

```bash
git add e2e/object-resize-rotate.spec.ts
git commit -m "test(objects): e2e resize + rotate handles (#2b)"
```

---

## Self-Review

**Spec coverage:**
- 8 resize handles (corners + edges), x/y adjust for opposite-edge handles → Task 1 `resizeTransform` (SX/SY maps, F reconstruction) + Task 3 handle set. ✓
- Rotate handle sets `rot` → Task 1 `rotateTransform` + Task 3 rotate handle. ✓
- Rotation-aware resize in pixel space, anisotropic W≠H → Task 1 tests (`rot=90`, `wide` rect). ✓
- Shift aspect-lock + 15° snap → Task 1 (`opts.aspect`/`opts.snap`) + Task 3 (`shift(c.e)`). ✓
- Shared `usePointerDrag` reused for move+resize+rotate → Task 2, consumed in Tasks 3 & 4. ✓
- Transient preview in component state, one commit per gesture, no store write on move, zero-movement guard → Task 4 `preview` + `transformChanged`/`moved`. ✓
- New `SelectionOverlay` sibling → Task 3. ✓
- Layering/pointer priority (handles auto + stopPropagation above body/deselect) → hook `stopPropagation` (Task 2) + `.ed__sel-frame` pointer-events none / handles auto (Task 3) + e2e priority test (Task 5). ✓
- `locked` objects render no overlay → Task 4 `showOverlay` guard. ✓
- No schema change, `--ed-*` tokens only → respected throughout. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete and self-contained (renderContent reproduced in full). ✓

**Type consistency:** `resizeTransform`/`rotateTransform`/`transformChanged`/`round3`/`ResizeHandle` signatures defined in Task 1 are consumed with identical names/shapes in Tasks 3–4. `usePointerDrag(hostRef) => (e, handlers)` and `DragCtx`/`DragHandlers` from Task 2 match their use sites. `SelectionOverlayProps` from Task 3 matches the mount in Task 4. ✓

**Known limitation (documented, not a gap):** handle *cursors* are axis-aligned and do not rotate with the box in v1 (spec §8 accepts this). Box flipping is intentionally out of scope (min-size clamp, no flip).
