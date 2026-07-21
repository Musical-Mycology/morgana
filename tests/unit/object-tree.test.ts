import { expect, test } from "vitest";
import { getObjectAt, getObjectListAt, mapChildList, collectObjectIds, uniqueObjectId, isPrefix } from "@/lib/editor/object-tree";
import type { SceneObject } from "@/engine/deck/types";
import type { DeckDoc } from "@/engine/deck-doc";

const tree = (): SceneObject[] => [
  { id: "a", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 1, h: 1 } },
  { id: "g", kind: "group", transform: { x: 0, y: 0, w: 1, h: 1 }, children: [
    { id: "b", kind: "text", text: "b", transform: { x: 0, y: 0, w: 1, h: 1 } },
    { id: "c", kind: "text", text: "c", transform: { x: 0, y: 0, w: 1, h: 1 } },
  ] },
];

test("getObjectAt resolves root and nested paths", () => {
  expect(getObjectAt(tree(), [0])!.id).toBe("a");
  expect(getObjectAt(tree(), [1, 1])!.id).toBe("c");
  expect(getObjectAt(tree(), [1, 9])).toBeUndefined();
  expect(getObjectAt(tree(), [0, 0])).toBeUndefined(); // "a" is not a group
});

test("getObjectListAt returns the sibling list for a parent path", () => {
  expect(getObjectListAt(tree(), []).map((o) => o.id)).toEqual(["a", "g"]);
  expect(getObjectListAt(tree(), [1]).map((o) => o.id)).toEqual(["b", "c"]);
});

test("mapChildList transforms a list immutably without touching the input", () => {
  const input = tree();
  const out = mapChildList(input, [1], (list) => list.slice().reverse());
  expect((out[1] as any).children.map((o: SceneObject) => o.id)).toEqual(["c", "b"]);
  expect((input[1] as any).children.map((o: SceneObject) => o.id)).toEqual(["b", "c"]); // unchanged
});

test("collectObjectIds gathers ids depth-first", () => {
  expect(collectObjectIds(tree())).toEqual(["a", "g", "b", "c"]);
  expect(collectObjectIds(undefined)).toEqual([]);
});

test("uniqueObjectId returns the smallest free o-N in the scene", () => {
  const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "s1", objects: [{ id: "o-1", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 1, h: 1 } }], beats: [] },
  ] };
  expect(uniqueObjectId(doc, "s1")).toBe("o-2");
  expect(uniqueObjectId(doc, "missing")).toBe("o-1");
});

test("isPrefix detects ancestor paths", () => {
  expect(isPrefix([1], [1, 0])).toBe(true);
  expect(isPrefix([1], [1])).toBe(true);
  expect(isPrefix([1, 0], [1])).toBe(false);
  expect(isPrefix([0], [1, 0])).toBe(false);
});
