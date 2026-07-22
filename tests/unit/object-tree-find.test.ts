import { expect, test } from "vitest";
import { findObjectPath } from "@/lib/editor/object-tree";
import type { SceneObject } from "@/engine/deck/types";

const tree = (): SceneObject[] => [
  { id: "a", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 1, h: 1 } },
  { id: "g", kind: "group", transform: { x: 0, y: 0, w: 1, h: 1 }, children: [
    { id: "b", kind: "text", text: "b", transform: { x: 0, y: 0, w: 1, h: 1 } },
  ] },
];

test("findObjectPath returns the depth-first path to an id, or null", () => {
  expect(findObjectPath(tree(), "a")).toEqual([0]);
  expect(findObjectPath(tree(), "g")).toEqual([1]);
  expect(findObjectPath(tree(), "b")).toEqual([1, 0]);
  expect(findObjectPath(tree(), "missing")).toBeNull();
});
