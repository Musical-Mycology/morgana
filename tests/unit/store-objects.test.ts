import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(base()); });

test("addObject inserts a registry-default object with a unique id and records history", () => {
  const s = useEditor.getState();
  const rev0 = s.revision;
  s.addObject("s1", "text");
  const st = useEditor.getState();
  const objs = st.doc!.scenes[0].objects!;
  expect(objs).toHaveLength(1);
  expect(objs[0].kind).toBe("text");
  expect(objs[0].id).toBe("o-1");
  expect(st.revision).toBe(rev0 + 1);
  expect(st.past).toHaveLength(1);
});

test("a second addObject gets the next unique id", () => {
  useEditor.getState().addObject("s1", "text");
  useEditor.getState().addObject("s1", "shape");
  expect(useEditor.getState().doc!.scenes[0].objects!.map((o) => o.id)).toEqual(["o-1", "o-2"]);
});

test("undo restores the pre-object document", () => {
  useEditor.getState().addObject("s1", "text");
  useEditor.getState().undo();
  expect(useEditor.getState().doc!.scenes[0].objects ?? []).toHaveLength(0);
});

test("groupObjects wraps two objects and records one history entry", () => {
  const s = useEditor.getState();
  s.addObject("s1", "text");
  s.addObject("s1", "shape");
  const revBefore = useEditor.getState().revision;
  useEditor.getState().groupObjects("s1", [[0], [1]]);
  const objs = useEditor.getState().doc!.scenes[0].objects!;
  expect(objs).toHaveLength(1);
  expect(objs[0].kind).toBe("group");
  expect(objs[0].id).toBe("o-3"); // o-1, o-2 taken
  expect(useEditor.getState().revision).toBe(revBefore + 1);
});

test("updateObject edits a field and bumps revision", () => {
  useEditor.getState().addObject("s1", "shape");
  useEditor.getState().updateObject("s1", [0], "transform.x", 0.42);
  expect(useEditor.getState().doc!.scenes[0].objects![0].transform.x).toBe(0.42);
});
