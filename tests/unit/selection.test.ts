import { expect, test } from "vitest";
import { pathsEqual, pathInList, primaryPath, togglePath, sameParentSiblings } from "@/lib/editor/selection";

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
