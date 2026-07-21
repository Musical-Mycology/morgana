import type { DeckDoc } from "@/engine/deck-doc";
import type { Scene, SceneObject } from "@/engine/deck/types";
import { setPath } from "./paths";
import { getObjectAt, getObjectListAt, mapChildList, type ObjectPath } from "./object-tree";

/** Apply `f` to the objects tree of the named scene. If `f` returns the same array
 *  reference (a no-op), the whole doc is returned unchanged. Unknown scene → no-op. */
function mapSceneObjects(doc: DeckDoc, sceneId: string, f: (objects: SceneObject[]) => SceneObject[]): DeckDoc {
  const idx = doc.scenes.findIndex((s) => s.id === sceneId);
  if (idx < 0) return doc;
  const scene = doc.scenes[idx];
  const objects = scene.objects ?? [];
  const next = f(objects);
  if (next === objects) return doc;
  const nextScene: Scene = { ...scene, objects: next };
  return { ...doc, scenes: doc.scenes.map((s, i) => (i === idx ? nextScene : s)) };
}

/** Insert `object` into the sibling list at `parentPath` (default root), at `index`
 *  (default: end of the list = top of z). Unknown parent → no-op. */
export function addObject(doc: DeckDoc, sceneId: string, object: SceneObject, parentPath: ObjectPath = [], index?: number): DeckDoc {
  return mapSceneObjects(doc, sceneId, (objects) => {
    if (getObjectListAt(objects, parentPath) === undefined) return objects; // bad parent
    return mapChildList(objects, parentPath, (list) => {
      const at = index == null ? list.length : Math.max(0, Math.min(index, list.length));
      return [...list.slice(0, at), object, ...list.slice(at)];
    });
  });
}

/** Set a dotted field (`transform.x`, `style.size`, …) on the object at `path`. Missing path → no-op. */
export function updateObject(doc: DeckDoc, sceneId: string, path: ObjectPath, fieldKey: string, value: unknown): DeckDoc {
  return mapSceneObjects(doc, sceneId, (objects) => {
    if (!getObjectAt(objects, path)) return objects;
    const parent = path.slice(0, -1);
    const idx = path[path.length - 1];
    return mapChildList(objects, parent, (list) =>
      list.map((o, i) => (i === idx ? setPath(o, fieldKey, value) : o)));
  });
}

/** Remove the object (and, for a group, its subtree) at `path`. Missing path → no-op. */
export function deleteObject(doc: DeckDoc, sceneId: string, path: ObjectPath): DeckDoc {
  return mapSceneObjects(doc, sceneId, (objects) => {
    if (!getObjectAt(objects, path)) return objects;
    const parent = path.slice(0, -1);
    const idx = path[path.length - 1];
    return mapChildList(objects, parent, (list) => list.filter((_, i) => i !== idx));
  });
}

/** Swap the object at `path` with its neighbour in the sibling list. Boundary → no-op. */
export function reorderObject(doc: DeckDoc, sceneId: string, path: ObjectPath, dir: -1 | 1): DeckDoc {
  const parent = path.slice(0, -1);
  const idx = path[path.length - 1];
  const target = idx + dir;
  return mapSceneObjects(doc, sceneId, (objects) => {
    const list = getObjectListAt(objects, parent);
    if (!list || target < 0 || target >= list.length) return objects;
    return mapChildList(objects, parent, (l) => {
      const next = l.slice();
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  });
}
