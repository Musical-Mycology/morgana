import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";
const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s", beats: [{ id: "b", timeline: [{ kind: "text", value: "hi", in: "fade" }] }] }] };
beforeEach(() => useEditor.setState({ doc: null, beats: [], selected: 0, selectedAction: null }));
test("updateAction edits the selected action immutably and refreshes beats + doc", () => {
  useEditor.getState().load(doc);
  useEditor.getState().updateAction(0, 0, "value", "bye");
  expect(useEditor.getState().beats[0].beat.timeline[0]).toMatchObject({ value: "bye" });
  expect(useEditor.getState().doc!.scenes[0].beats[0].timeline[0]).toMatchObject({ value: "bye" });
});
test("selectAction sets the selected action index", () => {
  useEditor.getState().load(doc);
  useEditor.getState().selectAction(0);
  expect(useEditor.getState().selectedAction).toBe(0);
});
