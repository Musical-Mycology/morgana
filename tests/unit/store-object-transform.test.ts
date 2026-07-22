import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [{ id: "o-1", kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }], beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(base()); });

test("updateObjectTransform commits one undoable transform change", () => {
  const rev0 = useEditor.getState().revision;
  useEditor.getState().updateObjectTransform("s1", [0], { x: 0.6, y: 0.7 });
  const t = useEditor.getState().doc!.scenes[0].objects![0].transform;
  expect([t.x, t.y]).toEqual([0.6, 0.7]);
  expect(useEditor.getState().revision).toBe(rev0 + 1);
  useEditor.getState().undo();
  expect(useEditor.getState().doc!.scenes[0].objects![0].transform.x).toBe(0.1);
});
