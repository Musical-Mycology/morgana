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

/** Computes each object's render state at an absolute point in playback (beatIndex, tLocal ms
 *  into that beat). Task 1 only seeds t=0: declared transform/opacity, visibility gated by
 *  whether an obj_reveal anywhere in the scene targets the object (hidden until revealed).
 *  Action interpolation (obj_reveal/obj_move/obj_out progress) lands in later tasks. */
export function objectStateAt(scene: Scene, beatIndex: number, tLocal: number): ObjectStateMap {
  const gated = revealedObjectIds(scene);
  const map: ObjectStateMap = new Map();
  for (const { obj } of flattenObjects(scene.objects ?? [])) {
    map.set(obj.id, seed(obj.transform, obj.opacity, !gated.has(obj.id)));
  }
  return map;
}
