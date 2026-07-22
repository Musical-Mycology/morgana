// lib/editor/object-actions.ts
import type { Action, Scene } from "@/engine/deck/types";
import { descriptorFor } from "@/lib/editor/registry";
import { findObjectPath, getObjectAt } from "@/lib/editor/object-tree";

export type ObjectVerbKind = "obj_reveal" | "obj_move" | "obj_out";

/** Build an obj_* verb targeting `objectId`; obj_move.to is seeded from the object's position. */
export function buildObjectAnimation(scene: Scene, objectId: string, kind: ObjectVerbKind): Action {
  const action = { ...descriptorFor({ kind }).defaults(), target: objectId } as Action & { target: string; to?: Record<string, number> };
  if (kind === "obj_move") {
    const path = findObjectPath(scene.objects ?? [], objectId);
    const obj = path ? getObjectAt(scene.objects ?? [], path) : undefined;
    if (obj) action.to = { x: obj.transform.x, y: obj.transform.y };
  }
  return action;
}

export { insertActionAt } from "@/lib/editor/mutations";
