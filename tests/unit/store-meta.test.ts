import { expect, test, beforeEach } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";
const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [] };
beforeEach(() => useEditor.setState({ doc: null, beats: [], selected: 0, selectedAction: null }));
test("updateMeta patches deck meta immutably (scalar + nested chrome)", () => {
  useEditor.getState().load(doc);
  useEditor.getState().updateMeta("title", "New Title");
  useEditor.getState().updateMeta("chrome.splash.tagline", "Hello");
  const m = useEditor.getState().doc!.meta;
  expect(m.title).toBe("New Title");
  expect(m.chrome?.splash?.tagline).toBe("Hello");
});
