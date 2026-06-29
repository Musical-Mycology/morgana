import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s", beats: [{ id: "b", timeline: [{ kind: "text", value: "hi", in: "fade" }] }] },
] };

beforeEach(() => useEditor.setState({ doc: null, beats: [], selected: 0, selectedAction: null, past: [], future: [], revision: 0 }));

test("addAction inserts after the index, selects it, and is undoable", () => {
  const s = useEditor.getState();
  s.load(doc);
  s.addAction(0, 0, { kind: "wait", ms: 250 });
  expect(useEditor.getState().beats[0].beat.timeline.map((a) => a.kind)).toEqual(["text", "wait"]);
  expect(useEditor.getState().selectedAction).toBe(1);
  useEditor.getState().undo();
  expect(useEditor.getState().beats[0].beat.timeline.map((a) => a.kind)).toEqual(["text"]);
});

test("deleteAction removes + clears selection", () => {
  const s = useEditor.getState();
  s.load(doc);
  s.selectAction(0);
  s.deleteAction(0, 0);
  expect(useEditor.getState().beats[0].beat.timeline.length).toBe(0);
  expect(useEditor.getState().selectedAction).toBeNull();
});

test("moveAction reorders + follows the selection", () => {
  const s = useEditor.getState();
  s.load(doc);
  s.addAction(0, 0, { kind: "wait", ms: 250 }); // [text, wait], selectedAction = 1
  s.moveAction(0, 1, -1);                        // wait → index 0
  expect(useEditor.getState().beats[0].beat.timeline.map((a) => a.kind)).toEqual(["wait", "text"]);
  expect(useEditor.getState().selectedAction).toBe(0);
});
