import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import { primaryPath } from "@/lib/editor/selection";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "b1", timeline: [{ kind: "text", value: "x", in: "fade" }] }, { id: "b2", timeline: [] }] },
] });

const primary = () => primaryPath(useEditor.getState().selectedObjectPaths);

beforeEach(() => { useEditor.getState().load(base()); });

test("selectObject sets a single-path selection and clears selectedAction", () => {
  useEditor.getState().selectAction(0);
  useEditor.getState().selectObject([0]);
  expect(useEditor.getState().selectedObjectPaths).toEqual([[0]]);
  expect(useEditor.getState().selectedAction).toBeNull();
});

test("selectObject(null) clears the selection", () => {
  useEditor.getState().selectObject([0]);
  useEditor.getState().selectObject(null);
  expect(useEditor.getState().selectedObjectPaths).toEqual([]);
});

test("toggleObjectSelection adds then removes a path", () => {
  useEditor.getState().selectObject([0]);
  useEditor.getState().toggleObjectSelection([1]);
  expect(useEditor.getState().selectedObjectPaths).toEqual([[0], [1]]);
  expect(primary()).toEqual([1]);
  useEditor.getState().toggleObjectSelection([0]);
  expect(useEditor.getState().selectedObjectPaths).toEqual([[1]]);
});

test("setObjectSelection replaces the whole set", () => {
  useEditor.getState().setObjectSelection([[0], [1]]);
  expect(useEditor.getState().selectedObjectPaths).toEqual([[0], [1]]);
});

test("enterGroup / exitGroup step the entered-group context", () => {
  useEditor.getState().enterGroup([2]);
  expect(useEditor.getState().enteredGroupPath).toEqual([2]);
  useEditor.getState().exitGroup();
  expect(useEditor.getState().enteredGroupPath).toBeNull();
});

test("exitGroup with no entered group clears the selection", () => {
  useEditor.getState().selectObject([0]);
  useEditor.getState().exitGroup();
  expect(useEditor.getState().selectedObjectPaths).toEqual([]);
});

test("selectAction clears the object selection (mutual exclusion)", () => {
  useEditor.getState().selectObject([0]);
  useEditor.getState().selectAction(0);
  expect(useEditor.getState().selectedAction).toBe(0);
  expect(useEditor.getState().selectedObjectPaths).toEqual([]);
});

test("changing the selected beat clears object selection and entered group", () => {
  useEditor.getState().selectObject([0]);
  useEditor.getState().enterGroup([0]);
  useEditor.getState().select(1);
  expect(useEditor.getState().selectedObjectPaths).toEqual([]);
  expect(useEditor.getState().enteredGroupPath).toBeNull();
  expect(useEditor.getState().selectedAction).toBeNull();
});

test("addObject selects the new object; deleteObject clears the selection", () => {
  useEditor.getState().addObject("s1", "text");
  expect(useEditor.getState().selectedObjectPaths).toEqual([[0]]);
  useEditor.getState().deleteObject("s1", [0]);
  expect(useEditor.getState().selectedObjectPaths).toEqual([]);
});

test("load, addAction, deleteBeat, deleteScene each clear the object selection", () => {
  const clearAnd = (fn: () => void) => { useEditor.getState().load(base()); useEditor.getState().selectObject([0]); fn(); return useEditor.getState().selectedObjectPaths; };
  expect(clearAnd(() => useEditor.getState().load(base()))).toEqual([]);
  expect(clearAnd(() => useEditor.getState().addAction(0, null, "text"))).toEqual([]);
  expect(clearAnd(() => useEditor.getState().deleteBeat(0))).toEqual([]);
  expect(clearAnd(() => useEditor.getState().deleteScene(0))).toEqual([]);
});
