import { beforeEach, expect, test } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const deck = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] },
  { id: "s2", beats: [{ id: "c", timeline: [] }] },
] });

beforeEach(() => useEditor.getState().load(deck()));

test("moveScene reorders scenes and keeps the SAME beat selected", () => {
  useEditor.getState().select(2);                     // "c" in s2
  useEditor.getState().moveScene(1, -1);              // s2 moves ahead of s1
  const s = useEditor.getState();
  expect(s.doc!.scenes.map((x) => x.id)).toEqual(["s2", "s1"]);
  expect(s.beats[s.selected].beat.id).toBe("c");      // followed the beat, not the index
  expect(s.selected).toBe(0);
});

test("deleteScene is keyed by SCENE index and clamps selection when the beat is gone", () => {
  useEditor.getState().select(2);                     // "c" in s2
  useEditor.getState().deleteScene(1);                // delete s2 itself
  const s = useEditor.getState();
  expect(s.doc!.scenes.map((x) => x.id)).toEqual(["s1"]);
  expect(s.selected).toBe(1);                         // clamped to the last remaining beat
  expect(s.selectedAction).toBeNull();
});

test("deleteScene can delete an empty scene, which has no flat beat index", () => {
  useEditor.getState().load({ version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "s1", beats: [{ id: "a", timeline: [] }] },
    { id: "gap", beats: [] },
  ] });
  useEditor.getState().deleteScene(1);
  expect(useEditor.getState().doc!.scenes.map((x) => x.id)).toEqual(["s1"]);
});

test("addBeatToScene appends to the target scene and selects the new beat", () => {
  useEditor.getState().addBeatToScene(0);
  const s = useEditor.getState();
  expect(s.doc!.scenes[0].beats.map((b) => b.id)).toEqual(["a", "b", "b-1"]);
  expect(s.beats[s.selected].beat.id).toBe("b-1");
});

test("addBeatToScene fills an empty scene", () => {
  useEditor.getState().load({ version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "s1", beats: [{ id: "a", timeline: [] }] },
    { id: "gap", beats: [] },
  ] });
  useEditor.getState().addBeatToScene(1);
  const s = useEditor.getState();
  expect(s.doc!.scenes[1].beats.length).toBe(1);
  expect(s.selected).toBe(1);
});

test("moveBeat across a scene boundary keeps the moved beat selected", () => {
  useEditor.getState().select(1);                     // "b", tail of s1
  useEditor.getState().moveBeat(1, 1);                // transfers to the head of s2
  const s = useEditor.getState();
  expect(s.doc!.scenes[1].beats.map((b) => b.id)).toEqual(["b", "c"]);
  expect(s.beats[s.selected].beat.id).toBe("b");      // NOT flatIdx + dir, which would be "c"
});

test("scene actions are undoable", () => {
  useEditor.getState().deleteScene(1);
  expect(useEditor.getState().doc!.scenes.length).toBe(1);
  useEditor.getState().undo();
  expect(useEditor.getState().doc!.scenes.length).toBe(2);
});
