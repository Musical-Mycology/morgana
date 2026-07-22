import { beforeEach, expect, test } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [{ id: "logo", kind: "image", src: "", transform: { x: 0.3, y: 0.4, w: 0.2, h: 0.2 } }],
    beats: [{ id: "b1", timeline: [{ kind: "clear" }] }] },
] });

beforeEach(() => useEditor.getState().load(doc()));

test("addObjectAnimation appends a targeted verb to the current beat and selects it", () => {
  useEditor.getState().addObjectAnimation(0, "logo", "obj_reveal");
  const tl = useEditor.getState().doc!.scenes[0].beats[0].timeline;
  expect(tl).toHaveLength(2);
  expect(tl[1]).toMatchObject({ kind: "obj_reveal", target: "logo" });
  expect(useEditor.getState().selectedAction).toBe(1);
});

test("addObjectAnimation for obj_move seeds to from the object position", () => {
  useEditor.getState().addObjectAnimation(0, "logo", "obj_move");
  const tl = useEditor.getState().doc!.scenes[0].beats[0].timeline;
  expect(tl[1]).toMatchObject({ kind: "obj_move", target: "logo", to: { x: 0.3, y: 0.4 } });
});

test("the append is undoable", () => {
  useEditor.getState().addObjectAnimation(0, "logo", "obj_out");
  useEditor.getState().undo();
  expect(useEditor.getState().doc!.scenes[0].beats[0].timeline).toHaveLength(1);
});
