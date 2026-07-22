import { expect, test } from "vitest";
import { pathsEqual, pathInList, primaryPath, togglePath, sameParentSiblings } from "@/lib/editor/selection";
import { resolveCanvasSelection } from "@/lib/editor/selection";
import { flattenForPanel } from "@/lib/editor/selection";
import type { SceneObject } from "@/engine/deck/types";

test("pathsEqual compares by value and handles null/undefined", () => {
  expect(pathsEqual([0, 1], [0, 1])).toBe(true);
  expect(pathsEqual([0, 1], [0, 2])).toBe(false);
  expect(pathsEqual([0], [0, 1])).toBe(false);
  expect(pathsEqual(null, [0])).toBe(false);
  expect(pathsEqual([0], undefined)).toBe(false);
});

test("pathInList finds a path by value", () => {
  expect(pathInList([[0], [1, 2]], [1, 2])).toBe(true);
  expect(pathInList([[0], [1, 2]], [1, 3])).toBe(false);
});

test("primaryPath returns the last path or null", () => {
  expect(primaryPath([])).toBeNull();
  expect(primaryPath([[0], [2]])).toEqual([2]);
});

test("togglePath adds an absent path (as new primary) and removes a present one", () => {
  expect(togglePath([[0]], [1])).toEqual([[0], [1]]);
  expect(togglePath([[0], [1]], [0])).toEqual([[1]]);
});

test("sameParentSiblings: true only for >=2 paths sharing one parent", () => {
  expect(sameParentSiblings([[0], [2]])).toBe(true);          // root siblings
  expect(sameParentSiblings([[1, 0], [1, 2]])).toBe(true);     // siblings in group 1
  expect(sameParentSiblings([[0]])).toBe(false);               // single
  expect(sameParentSiblings([[0], [1, 0]])).toBe(false);       // different depth/parent
  expect(sameParentSiblings([[1, 0], [2, 0]])).toBe(false);    // different parent
});

test("resolveCanvasSelection at root selects the top-level ancestor", () => {
  // hit a child of the root group [1] -> select the group [1]
  expect(resolveCanvasSelection([1, 0], null)).toEqual([1]);
  // hit a deeply-nested leaf -> still the top-level ancestor
  expect(resolveCanvasSelection([1, 0, 2], null)).toEqual([1]);
  // hit a top-level leaf -> itself
  expect(resolveCanvasSelection([0], null)).toEqual([0]);
});

test("resolveCanvasSelection inside an entered group selects that group's direct child", () => {
  // entered group [1], hit its child [1,0] -> select [1,0]
  expect(resolveCanvasSelection([1, 0], [1])).toEqual([1, 0]);
  // entered [1], hit a nested-group child [1,0,3] -> select the direct child group [1,0]
  expect(resolveCanvasSelection([1, 0, 3], [1])).toEqual([1, 0]);
});

test("resolveCanvasSelection ignores an entered group the hit is not inside", () => {
  // entered [1] but hit is under root object [2] -> resolve at root
  expect(resolveCanvasSelection([2, 0], [1])).toEqual([2]);
});

const T = { x: 0, y: 0, w: 0.1, h: 0.1 };
const tree = (): SceneObject[] => [
  { id: "A", kind: "shape", shape: "rect", transform: { ...T } },
  { id: "G", kind: "group", transform: { ...T }, children: [
    { id: "c0", kind: "shape", shape: "rect", transform: { ...T } },
    { id: "c1", kind: "shape", shape: "rect", transform: { ...T } },
  ] },
  { id: "B", kind: "shape", shape: "rect", transform: { ...T } },
];

test("flattenForPanel is front-of-z first with the group header above its children", () => {
  const rows = flattenForPanel(tree(), new Set());
  expect(rows.map((r) => r.obj.id)).toEqual(["B", "G", "c1", "c0", "A"]);
  // paths stay canonical (document indices), depth reflects nesting
  expect(rows.find((r) => r.obj.id === "c1")!.path).toEqual([1, 1]);
  expect(rows.find((r) => r.obj.id === "c1")!.depth).toBe(1);
  expect(rows.find((r) => r.obj.id === "G")!.depth).toBe(0);
});

test("flattenForPanel skips a collapsed group's children", () => {
  const rows = flattenForPanel(tree(), new Set(["G"]));
  expect(rows.map((r) => r.obj.id)).toEqual(["B", "G", "A"]);
});
