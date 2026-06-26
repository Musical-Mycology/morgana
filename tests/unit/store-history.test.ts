import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s", beats: [{ id: "b", timeline: [{ kind: "text", value: "hi", in: "fade" }] }] },
] };

beforeEach(() => useEditor.setState({ doc: null, beats: [], selected: 0, selectedAction: null, past: [], future: [], revision: 0 }));

test("load resets history + revision", () => {
  useEditor.getState().load(doc);
  expect(useEditor.getState().revision).toBe(0);
  expect(useEditor.getState().past).toEqual([]);
  expect(useEditor.getState().future).toEqual([]);
});

test("an edit bumps revision and records history; undo/redo round-trips", () => {
  const s = useEditor.getState();
  s.load(doc);
  s.updateAction(0, 0, "value", "bye");
  expect(useEditor.getState().revision).toBe(1);
  expect(useEditor.getState().beats[0].beat.timeline[0]).toMatchObject({ value: "bye" });
  expect(useEditor.getState().past.length).toBe(1);

  useEditor.getState().undo();
  expect(useEditor.getState().beats[0].beat.timeline[0]).toMatchObject({ value: "hi" });
  expect(useEditor.getState().future.length).toBe(1);

  useEditor.getState().redo();
  expect(useEditor.getState().beats[0].beat.timeline[0]).toMatchObject({ value: "bye" });
});

test("undo with empty history is a no-op", () => {
  useEditor.getState().load(doc);
  useEditor.getState().undo();
  expect(useEditor.getState().beats[0].beat.timeline[0]).toMatchObject({ value: "hi" });
});

test("structural methods mutate + record history; delete clamps selection", () => {
  const multi: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "s", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] },
  ] };
  const s = useEditor.getState();
  s.load(multi);
  s.select(1);

  s.addBeat(1);                                       // after "b"
  expect(useEditor.getState().beats.length).toBe(3);

  s.deleteBeat(2);                                    // remove the new one
  expect(useEditor.getState().beats.length).toBe(2);

  s.deleteBeat(1);                                    // remove "b" while it was selected
  expect(useEditor.getState().beats.map((e) => e.beat.id)).toEqual(["a"]);
  expect(useEditor.getState().selected).toBe(0);      // clamped

  expect(useEditor.getState().past.length).toBeGreaterThan(0);
  useEditor.getState().undo();
  expect(useEditor.getState().beats.map((e) => e.beat.id)).toEqual(["a", "b"]);
});
