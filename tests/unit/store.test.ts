import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";
const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s1", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] }] };
beforeEach(() => useEditor.setState({ doc: null, beats: [], selected: 0 }));
test("load populates doc + flattened beats", () => {
  useEditor.getState().load(doc);
  expect(useEditor.getState().beats.map((b) => b.beat.id)).toEqual(["a", "b"]);
});
test("select clamps", () => {
  useEditor.getState().load(doc);
  useEditor.getState().select(99); expect(useEditor.getState().selected).toBe(1);
  useEditor.getState().select(-5); expect(useEditor.getState().selected).toBe(0);
});
