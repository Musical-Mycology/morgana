import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s", beats: [{ id: "b", timeline: [] }] },
] };

beforeEach(() => useEditor.setState({ doc: null, beats: [], selected: 0, selectedAction: null, past: [], future: [], revision: 0 }));

test("updateMeta sets nested meta.fonts.display", () => {
  const s = useEditor.getState();
  s.load(doc);
  s.updateMeta("fonts.display", "Inter");
  expect(useEditor.getState().doc!.meta.fonts).toEqual({ display: "Inter" });
});
