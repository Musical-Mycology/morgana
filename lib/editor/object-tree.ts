import type { DeckDoc } from "@/engine/deck-doc";
import type { SceneObject } from "@/engine/deck/types";

/** A path from a scene's root `objects` array, descending through group `children`.
 *  `[2]` = third root object; `[2,0]` = first child of that group. */
export type ObjectPath = number[];

/** Resolve the object at `path`, or undefined if any segment is missing / not a group. */
export function getObjectAt(objects: SceneObject[], path: ObjectPath): SceneObject | undefined {
  if (path.length === 0) return undefined;
  const [head, ...rest] = path;
  const node = objects[head];
  if (!node) return undefined;
  if (rest.length === 0) return node;
  if (node.kind !== "group") return undefined;
  return getObjectAt(node.children, rest);
}

/** The sibling list at `parentPath` (`[]` = root), or undefined if the parent isn't a group. */
export function getObjectListAt(objects: SceneObject[], parentPath: ObjectPath): SceneObject[] | undefined {
  if (parentPath.length === 0) return objects;
  const node = getObjectAt(objects, parentPath);
  return node && node.kind === "group" ? node.children : undefined;
}

/** Immutably transform the sibling list at `parentPath`. Returns a new tree; input untouched. */
export function mapChildList(objects: SceneObject[], parentPath: ObjectPath, f: (list: SceneObject[]) => SceneObject[]): SceneObject[] {
  if (parentPath.length === 0) return f(objects);
  const [head, ...rest] = parentPath;
  return objects.map((o, i) => {
    if (i !== head || o.kind !== "group") return o;
    return { ...o, children: mapChildList(o.children, rest, f) };
  });
}

/** All ids in the tree, depth-first (parent before its children). */
export function collectObjectIds(objects: SceneObject[] | undefined): string[] {
  const ids: string[] = [];
  const walk = (list: SceneObject[]) => list.forEach((o) => { ids.push(o.id); if (o.kind === "group") walk(o.children); });
  if (objects) walk(objects);
  return ids;
}

/** Smallest free `o-N` id within the named scene (mirrors uniqueBeatId's namespace scan). */
export function uniqueObjectId(doc: DeckDoc, sceneId: string): string {
  const scene = doc.scenes.find((s) => s.id === sceneId);
  const used = new Set(collectObjectIds(scene?.objects));
  for (let n = 1; ; n++) { const id = `o-${n}`; if (!used.has(id)) return id; }
}

/** True if `prefix` is an ancestor of (or equal to) `path`. Guards against moving a group into itself. */
export function isPrefix(prefix: ObjectPath, path: ObjectPath): boolean {
  if (prefix.length > path.length) return false;
  return prefix.every((v, i) => v === path[i]);
}
