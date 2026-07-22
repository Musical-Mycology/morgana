import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "g", kind: "group", transform: { x: 0.5, y: 0.5, w: 0.3, h: 0.3 }, children: [
      { id: "c", kind: "shape", shape: "rect", transform: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } },
    ] },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(doc()); });

test("translateObjectBy moves a group + descendants in one undo entry", () => {
  const rev = useEditor.getState().revision;
  useEditor.getState().translateObjectBy("s1", [0], 0.1, 0.1);
  const objs = useEditor.getState().doc!.scenes[0].objects!;
  expect(objs[0].transform).toMatchObject({ x: 0.6, y: 0.6 });
  expect((objs[0] as { children: { transform: { x: number; y: number } }[] }).children[0].transform).toMatchObject({ x: 0.6, y: 0.6 });
  expect(useEditor.getState().revision).toBe(rev + 1);
  useEditor.getState().undo();
  expect(useEditor.getState().doc!.scenes[0].objects![0].transform).toMatchObject({ x: 0.5, y: 0.5 });
});
