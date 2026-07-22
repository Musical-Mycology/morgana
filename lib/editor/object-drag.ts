/** Map client pixel coords to a clamped 0–1 fraction of `rect` (the 16:9 stage host). */
export function pointerFraction(rect: DOMRect, clientX: number, clientY: number): { x: number; y: number } {
  const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
  return { x, y };
}

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
