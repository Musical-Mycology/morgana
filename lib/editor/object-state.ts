import type { Scene, SceneObject, ObjectTransform, Action } from "@/engine/deck/types";
import { revealedObjectIds } from "@/lib/editor/object-gating";
import { beatTimeline } from "@/engine/authoring/seek";

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

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

export const FLY_DY = 0.05;   // flyUp rise, stage-height fraction
export const SIDE_DX = 0.03;  // fadeSide slide, stage-width fraction
export const POP_FROM = 0.8;  // pop starting scale

/** Move a leaf or group target. Interpolates present axes current→to. For a group target
 *  (kids.length > 0), x/y deltas are also applied to every descendant; w/h/rot apply to the
 *  group box only, leaving descendant sizes/rotation untouched. */
function applyMove(
  map: ObjectStateMap,
  a: Extract<Action, { kind: "obj_move" }>,
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
  } else {
    if (to.x != null) st.x = lerp(st.x, to.x, p);
    if (to.y != null) st.y = lerp(st.y, to.y, p);
  }
  if (to.w != null) st.w = lerp(st.w, to.w, p);
  if (to.h != null) st.h = lerp(st.h, to.h, p);
  if (to.rot != null) st.rot = lerp(st.rot, to.rot, p);
}

/** Apply one obj_* action to the map at local progress p (0..1). Mutates map. */
function applyActionAtProgress(map: ObjectStateMap, a: Action, p: number, descendants: Map<string, string[]>): void {
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
    applyMove(map, a, p, descendants);
  } else if (a.kind === "obj_out") {
    const st = map.get(a.target); if (!st) return;
    st.opacity = clamp01(1 - p);
    if (p >= 1) st.visible = false;
  }
}

/** Computes each object's render state at an absolute point in playback (beatIndex, tLocal
 *  seconds into that beat). Seeds declared transform/opacity, visibility gated by whether an
 *  obj_reveal anywhere in the scene targets the object (hidden until revealed), then interpolates
 *  the current beat's obj_reveal/obj_move/obj_out actions at local progress. Entrance-variant
 *  math and group obj_move semantics are in place (Tasks 3, 4). Prior beats (0..beatIndex-1)
 *  are folded to their settled end-state (p=1, document order) before the current beat is
 *  interpolated, giving correct cross-beat persistence, gating, and re-reveal-after-out. */
export function objectStateAt(scene: Scene, beatIndex: number, tLocal: number): ObjectStateMap {
  const gated = revealedObjectIds(scene);
  const map: ObjectStateMap = new Map();
  const descendants = new Map<string, string[]>();
  for (const { obj, descendantIds } of flattenObjects(scene.objects ?? [])) {
    map.set(obj.id, seed(obj.transform, obj.opacity, !gated.has(obj.id)));
    if (descendantIds.length) descendants.set(obj.id, descendantIds);
  }
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

  const beat = scene.beats[beatIndex];
  if (!beat) return map;
  for (const { action, start, end } of beatTimeline(beat.timeline)) {
    if (action.kind !== "obj_reveal" && action.kind !== "obj_move" && action.kind !== "obj_out") continue;
    if (start > tLocal) continue;                       // window not reached
    const dur = end - start;
    const p = dur <= 0 ? 1 : clamp01((tLocal - start) / dur);
    applyActionAtProgress(map, action, p, descendants);
  }
  return map;
}
