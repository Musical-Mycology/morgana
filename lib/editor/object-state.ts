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

/** Leaf move (group handling added in Task 4). Interpolates present axes current→to. */
function applyMove(map: ObjectStateMap, a: Extract<Action, { kind: "obj_move" }>, p: number): void {
  const st = map.get(a.target); if (!st) return;
  const to = a.to;
  if (to.x != null) st.x = lerp(st.x, to.x, p);
  if (to.y != null) st.y = lerp(st.y, to.y, p);
  if (to.w != null) st.w = lerp(st.w, to.w, p);
  if (to.h != null) st.h = lerp(st.h, to.h, p);
  if (to.rot != null) st.rot = lerp(st.rot, to.rot, p);
}

/** Apply one obj_* action to the map at local progress p (0..1). Mutates map. */
function applyActionAtProgress(map: ObjectStateMap, a: Action, p: number): void {
  if (a.kind === "obj_reveal") {
    const st = map.get(a.target); if (!st) return;
    st.visible = true;
    st.opacity = clamp01(p);            // entrance offsets added in Task 3
  } else if (a.kind === "obj_move") {
    applyMove(map, a, p);
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
 *  math, group semantics, and cross-beat folding land in later tasks (3, 4, 5). */
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
