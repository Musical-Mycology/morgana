import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s", beats: [{ id: "b", timeline: [{ kind: "text", value: "A", in: "fade" }, { kind: "wait", ms: 100 }] }] },
] });

beforeEach(() => useEditor.setState({ doc: null, beats: [], selected: 0, selectedAction: null, past: [], future: [], revision: 0 }));

test("addAction inserts after selectedAction, selects the new one, and records one undo entry", () => {
  const s = useEditor.getState();
  s.load(doc());
  s.selectAction(0);
  s.addAction(0, 0, "wait");
  const st = useEditor.getState();
  expect(st.beats[0].beat.timeline.map((a) => a.kind)).toEqual(["text", "wait", "wait"]);
  expect(st.selectedAction).toBe(1);
  expect(st.past.length).toBe(1);
});

test("addAction with no action selected appends to the end", () => {
  const s = useEditor.getState();
  s.load(doc());
  s.selectAction(null);
  s.addAction(0, null, "clear");
  const st = useEditor.getState();
  expect(st.beats[0].beat.timeline.map((a) => a.kind)).toEqual(["text", "wait", "clear"]);
  expect(st.selectedAction).toBe(2);
});

test("duplicateAction keeps selectedAction pointed at the original index", () => {
  const s = useEditor.getState();
  s.load(doc());
  s.selectAction(0);
  s.duplicateAction(0, 0);
  const st = useEditor.getState();
  expect(st.beats[0].beat.timeline.map((a) => a.kind)).toEqual(["text", "text", "wait"]);
  expect(st.selectedAction).toBe(0);
});

test("deleteAction clamps selectedAction to the new length, or null if the beat is now empty", () => {
  const s = useEditor.getState();
  s.load(doc());
  s.selectAction(1);
  s.deleteAction(0, 1);                                      // delete "wait" (the last action)
  expect(useEditor.getState().selectedAction).toBe(0);        // clamped to the new last index

  s.deleteAction(0, 0);                                       // delete the remaining "text" → empty
  expect(useEditor.getState().selectedAction).toBeNull();
});

test("moveAction moves selectedAction along with the action", () => {
  const s = useEditor.getState();
  s.load(doc());
  s.selectAction(0);
  s.moveAction(0, 0, 1);                                       // "text" swaps down
  const st = useEditor.getState();
  expect(st.beats[0].beat.timeline.map((a) => a.kind)).toEqual(["wait", "text"]);
  expect(st.selectedAction).toBe(1);
});

test("convertAction replaces the kind and keeps the same index selected", () => {
  const s = useEditor.getState();
  s.load(doc());
  s.selectAction(0);
  s.convertAction(0, 0, "wait");
  const st = useEditor.getState();
  expect(st.beats[0].beat.timeline[0]).toMatchObject({ kind: "wait" });
  expect(st.selectedAction).toBe(0);
});

test("each op is one undo entry and undo restores the prior timeline exactly", () => {
  const s = useEditor.getState();
  s.load(doc());
  s.addAction(0, 0, "clear");
  expect(useEditor.getState().past.length).toBe(1);
  useEditor.getState().undo();
  expect(useEditor.getState().beats[0].beat.timeline.map((a) => a.kind)).toEqual(["text", "wait"]);
});
