import type { Scene, SceneObject } from "@/engine/deck/types";

/** Ids of objects revealed by an obj_reveal in any beat of the scene. */
export function revealedObjectIds(scene: Scene): Set<string> {
  const ids = new Set<string>();
  for (const beat of scene.beats) {
    for (const a of beat.timeline) {
      if (a.kind === "obj_reveal" && typeof a.target === "string" && a.target) ids.add(a.target);
    }
  }
  return ids;
}

/** True iff the object starts hidden (some obj_reveal targets it). */
export function isGated(scene: Scene, objectId: string): boolean {
  return revealedObjectIds(scene).has(objectId);
}

/** {value,label} options for an objectRef field: every object incl. nested children. */
export function objectRefOptions(scene: Scene | undefined): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const walk = (list: SceneObject[]) => list.forEach((o) => {
    out.push({ value: o.id, label: o.name ?? o.id });
    if (o.kind === "group") walk(o.children);
  });
  if (scene?.objects) walk(scene.objects);
  return out;
}
