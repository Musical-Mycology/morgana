import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import { primaryPath } from "@/lib/editor/selection";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "b1", timeline: [{ kind: "text", value: "x", in: "fade" }] }, { id: "b2", timeline: [] }] },
] });

const withObjects = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "a", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 0.1, h: 0.1 } },
    { id: "b", kind: "shape", shape: "rect", transform: { x: 0.2, y: 0, w: 0.1, h: 0.1 } },
    { id: "c", kind: "shape", shape: "rect", transform: { x: 0.4, y: 0, w: 0.1, h: 0.1 } },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

const objIds = () => useEditor.getState().doc!.scenes[0].objects!.map((o) => o.id);

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

test("reorderObject carries the selection, so raising twice moves the same object", () => {
  useEditor.getState().load(withObjects());
  useEditor.getState().selectObject([0]);                       // 'a', backmost
  useEditor.getState().reorderObject("s1", primary()!, 1);
  expect(objIds()).toEqual(["b", "a", "c"]);
  expect(primary()).toEqual([1]);
  useEditor.getState().reorderObject("s1", primary()!, 1);
  expect(objIds()).toEqual(["b", "c", "a"]);                    // 'a' moved twice, not 'b'
  expect(primary()).toEqual([2]);
});

test("reorderObject remaps a selected swap partner as well as the moved object", () => {
  useEditor.getState().load(withObjects());
  useEditor.getState().selectObject([0]);
  useEditor.getState().toggleObjectSelection([1]);               // selection [[0],[1]], primary [1] = 'b'
  useEditor.getState().reorderObject("s1", [1], -1);             // 'b' lowers past 'a'
  expect(objIds()).toEqual(["b", "a", "c"]);
  expect(useEditor.getState().selectedObjectPaths).toEqual([[1], [0]]);  // 'a' -> [1], 'b' -> [0]
});

test("a boundary reorder is a no-op and leaves the selection where it was", () => {
  useEditor.getState().load(withObjects());
  useEditor.getState().selectObject([2]);                        // already topmost
  const rev = useEditor.getState().revision;
  useEditor.getState().reorderObject("s1", [2], 1);
  expect(objIds()).toEqual(["a", "b", "c"]);
  expect(useEditor.getState().selectedObjectPaths).toEqual([[2]]);
  expect(useEditor.getState().revision).toBe(rev);
});
