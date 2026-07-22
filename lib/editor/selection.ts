import type { ObjectPath } from "./object-tree";

/** Value-equality for two ObjectPaths (null/undefined are never equal to anything). */
export function pathsEqual(a: ObjectPath | null | undefined, b: ObjectPath | null | undefined): boolean {
  if (!a || !b) return false;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** True if `p` is present in `list` (by value). */
export function pathInList(list: ObjectPath[], p: ObjectPath): boolean {
  return list.some((q) => pathsEqual(q, p));
}

/** The primary selection = the last path, or null when the set is empty. */
export function primaryPath(paths: ObjectPath[]): ObjectPath | null {
  return paths.length ? paths[paths.length - 1] : null;
}

/** Add `p` if absent (it becomes the new primary), else remove it. Order preserved. */
export function togglePath(list: ObjectPath[], p: ObjectPath): ObjectPath[] {
  return pathInList(list, p) ? list.filter((q) => !pathsEqual(q, p)) : [...list, p];
}

/** True when >=2 paths share exactly one parent (the `groupObjects` precondition). */
export function sameParentSiblings(paths: ObjectPath[]): boolean {
  if (paths.length < 2) return false;
  const parent = paths[0].slice(0, -1);
  return paths.every(
    (p) => p.length === paths[0].length && p.slice(0, -1).every((v, i) => v === parent[i])
  );
}
