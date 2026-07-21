import { expect, test } from "vitest";
import { addObject, updateObject, deleteObject, reorderObject } from "@/lib/editor/object-mutations";
import type { DeckDoc } from "@/engine/deck-doc";
import type { SceneObject } from "@/engine/deck/types";

const obj = (id: string): SceneObject => ({ id, kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 1, h: 1 } });
const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [obj("a"), obj("b")], beats: [] },
  { id: "s2", beats: [] },
] });

test("addObject appends to the scene's root list (top of z) by default", () => {
  const d = addObject(base(), "s1", obj("c"));
  expect(d.scenes[0].objects!.map((o) => o.id)).toEqual(["a", "b", "c"]);
});

test("addObject can insert into a group at an index", () => {
  let d = addObject(base(), "s1", { id: "g", kind: "group", transform: { x: 0, y: 0, w: 1, h: 1 }, children: [] });
  d = addObject(d, "s1", obj("child"), [2], 0); // [2] = the new group
  expect((d.scenes[0].objects![2] as any).children.map((o: SceneObject) => o.id)).toEqual(["child"]);
});

test("addObject on an unknown scene is a no-op (same reference)", () => {
  const b = base();
  expect(addObject(b, "nope", obj("c"))).toBe(b);
});

test("updateObject sets a nested field via dot path", () => {
  const d = updateObject(base(), "s1", [1], "transform.x", 0.25);
  expect(d.scenes[0].objects![1].transform.x).toBe(0.25);
  expect(base().scenes[0].objects![1].transform.x).toBe(0); // input untouched
});

test("updateObject on a missing path is a no-op", () => {
  const b = base();
  expect(updateObject(b, "s1", [9], "transform.x", 0.5)).toBe(b);
});

test("deleteObject removes the targeted node", () => {
  const d = deleteObject(base(), "s1", [0]);
  expect(d.scenes[0].objects!.map((o) => o.id)).toEqual(["b"]);
});

test("reorderObject swaps within the sibling list; boundary is a no-op", () => {
  const up = reorderObject(base(), "s1", [0], 1);
  expect(up.scenes[0].objects!.map((o) => o.id)).toEqual(["b", "a"]);
  const b = base();
  expect(reorderObject(b, "s1", [0], -1)).toBe(b); // already backmost
  expect(reorderObject(b, "s1", [1], 1)).toBe(b);  // already topmost
});
