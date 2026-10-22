import { beforeEach, expect, test } from "vitest";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

beforeEach(() => useEditor.getState().load({ version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s", beats: [{ id: "a", timeline: [] }] }] } as DeckDoc));

test("setSceneDuration commits an undoable edit", () => {
  useEditor.getState().setSceneDuration(0, 12);
  expect(useEditor.getState().doc!.scenes[0].durationSec).toBe(12);
  useEditor.getState().undo();
  expect(useEditor.getState().doc!.scenes[0].durationSec).toBeUndefined();
});
