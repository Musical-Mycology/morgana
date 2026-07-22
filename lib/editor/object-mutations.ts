import type { DeckDoc } from "@/engine/deck-doc";
import type { ObjectTransform, Scene, SceneObject } from "@/engine/deck/types";
import { setPath } from "./paths";
import { getObjectAt, getObjectListAt, mapChildList, isPrefix, type ObjectPath } from "./object-tree";
import { round3 } from "./object-drag";

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

/** Bounding box (union) of the children's boxes — a group's descriptive transform in #1.
 *  Rotation is ignored (uses each child's x/y/w/h). Empty → full stage. */
function unionTransform(children: SceneObject[]): ObjectTransform {
  if (children.length === 0) return { x: 0, y: 0, w: 1, h: 1, rot: 0, anchor: "center" };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of children) {
    const t = c.transform;
    x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y);
    x1 = Math.max(x1, t.x + t.w); y1 = Math.max(y1, t.y + t.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, rot: 0, anchor: "center" };
}

/** Wrap the selected same-parent siblings into a new group at the topmost selected slot.
 *  Children keep their original order and absolute coords. Requires ≥1 path, all sharing
 *  one parent; otherwise a no-op. */
export function groupObjects(doc: DeckDoc, sceneId: string, paths: ObjectPath[], groupId: string): DeckDoc {
  if (paths.length === 0) return doc;
  const parent = paths[0].slice(0, -1);
  const sameParent = paths.every((p) => p.length === paths[0].length && isPrefix(parent, p) && p.slice(0, -1).every((v, i) => v === parent[i]));
  if (!sameParent) return doc;
  const idxs = paths.map((p) => p[p.length - 1]).sort((a, b) => a - b);
  const insertAt = idxs[0];
  return mapSceneObjects(doc, sceneId, (objects) => {
    const list = getObjectListAt(objects, parent);
    if (!list || idxs.some((i) => i < 0 || i >= list.length)) return objects;
    const picked = idxs.map((i) => list[i]);
    const group: SceneObject = { id: groupId, kind: "group", transform: unionTransform(picked), children: picked };
    return mapChildList(objects, parent, (l) => {
      const remaining = l.filter((_, i) => !idxs.includes(i));
      const at = Math.min(insertAt, remaining.length);
      return [...remaining.slice(0, at), group, ...remaining.slice(at)];
    });
  });
}

/** Splice a group's children into its parent at the group's slot, dropping the group. Non-group → no-op. */
export function ungroupObject(doc: DeckDoc, sceneId: string, path: ObjectPath): DeckDoc {
  const node = doc.scenes.find((s) => s.id === sceneId)?.objects;
  const target = node ? getObjectAt(node, path) : undefined;
  if (!target || target.kind !== "group") return doc;
  const parent = path.slice(0, -1);
  const idx = path[path.length - 1];
  const kids = target.children;
  return mapSceneObjects(doc, sceneId, (objects) =>
    mapChildList(objects, parent, (l) => [...l.slice(0, idx), ...kids, ...l.slice(idx + 1)]));
}

/** Merge a partial transform patch onto the object at `path` (batched multi-field edit,
 *  one commit). Unknown scene/path → same doc reference. */
export function updateObjectTransform(doc: DeckDoc, sceneId: string, path: ObjectPath, patch: Partial<ObjectTransform>): DeckDoc {
  return mapSceneObjects(doc, sceneId, (objects) => {
    if (!getObjectAt(objects, path)) return objects;
    const parent = path.slice(0, -1);
    const idx = path[path.length - 1];
    return mapChildList(objects, parent, (list) =>
      list.map((o, i) => (i === idx ? { ...o, transform: { ...o.transform, ...patch } } : o)));
  });
}

/** Offset a single object's transform, recursing into a group's descendants (which hold
 *  absolute coords in #1) so a whole group moves together. */
function shift(o: SceneObject, dx: number, dy: number): SceneObject {
  const t = o.transform;
  const transform = { ...t, x: round3(t.x + dx), y: round3(t.y + dy) };
  return o.kind === "group"
    ? { ...o, transform, children: o.children.map((c) => shift(c, dx, dy)) }
    : { ...o, transform };
}

/** Offset the node at `path` — and, for a group, all its descendants — by (dx, dy) in
 *  stage fractions. Used for group-as-unit drag. Zero delta / unknown scene/path → same doc. */
export function translateObjectBy(doc: DeckDoc, sceneId: string, path: ObjectPath, dx: number, dy: number): DeckDoc {
  if (dx === 0 && dy === 0) return doc;
  return mapSceneObjects(doc, sceneId, (objects) => {
    if (!getObjectAt(objects, path)) return objects;
    const parent = path.slice(0, -1);
    const idx = path[path.length - 1];
    return mapChildList(objects, parent, (list) => list.map((o, i) => (i === idx ? shift(o, dx, dy) : o)));
  });
}

/** Move the node at `from` into the list at `toParent`, at `toIndex`. Refuses to move a group
 *  into its own subtree; unknown source/target → no-op. */
export function reparentObject(doc: DeckDoc, sceneId: string, from: ObjectPath, toParent: ObjectPath, toIndex: number): DeckDoc {
  if (isPrefix(from, toParent)) return doc; // can't move a node into itself/its descendants
  const objects = doc.scenes.find((s) => s.id === sceneId)?.objects;
  if (!objects) return doc;
  const node = getObjectAt(objects, from);
  if (!node || getObjectListAt(objects, toParent) === undefined) return doc;

  const fromParent = from.slice(0, -1);
  const fromIdx = from[from.length - 1];
  const sameList = fromParent.length === toParent.length && fromParent.every((v, i) => v === toParent[i]);

  return mapSceneObjects(doc, sceneId, (objs) => {
    // 1) remove from source
    let next = mapChildList(objs, fromParent, (l) => l.filter((_, i) => i !== fromIdx));
    // 2) adjust the target index if the removal shifted it (same list, target after source)
    const adjIndex = sameList && toIndex > fromIdx ? toIndex - 1 : toIndex;
    // 3) insert into target
    next = mapChildList(next, toParent, (l) => {
      const at = Math.max(0, Math.min(adjIndex, l.length));
      return [...l.slice(0, at), node, ...l.slice(at)];
    });
    return next;
  });
}
