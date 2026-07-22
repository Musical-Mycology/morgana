import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import { getObjectAt } from "@/lib/editor/object-tree";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "a", kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } },
    { id: "b", kind: "shape", shape: "rect", transform: { x: 0.3, y: 0.3, w: 0.1, h: 0.1 } },
    { id: "c", kind: "shape", shape: "rect", transform: { x: 0.6, y: 0.6, w: 0.1, h: 0.1 } },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(doc()); });

test("groupObjects wraps the selected siblings and selects the new group", () => {
  useEditor.getState().setObjectSelection([[0], [1]]);
  useEditor.getState().groupObjects("s1", [[0], [1]]);
  const sel = useEditor.getState().selectedObjectPaths;
  expect(sel).toHaveLength(1);
  const g = getObjectAt(useEditor.getState().doc!.scenes[0].objects!, sel[0]);
  expect(g!.kind).toBe("group");
});

test("groupObjects on a non-sibling selection is a no-op (selection unchanged)", () => {
  useEditor.getState().setObjectSelection([[0]]);
  useEditor.getState().groupObjects("s1", [[0]]);           // single -> not sameParentSiblings
  expect(useEditor.getState().selectedObjectPaths).toEqual([[0]]);
  expect(useEditor.getState().doc!.scenes[0].objects).toHaveLength(3);
});

test("ungroupObject splices children back and selects them", () => {
  useEditor.getState().groupObjects("s1", [[0], [1]]);       // objects: [group(a,b), c]
  useEditor.getState().ungroupObject("s1", [0]);             // -> [a, b, c]
  expect(useEditor.getState().doc!.scenes[0].objects).toHaveLength(3);
  expect(useEditor.getState().selectedObjectPaths).toEqual([[0], [1]]);
});
