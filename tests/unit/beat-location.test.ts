import { expect, test } from "vitest";
import { beatLocation } from "@/lib/editor/flatten-beats";
import type { DeckDoc } from "@/engine/deck-doc";

const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] },
  { id: "s2", beats: [{ id: "c", timeline: [] }] },
] };

test("maps a flat beat index to {sceneIdx, beatIdx}", () => {
  expect(beatLocation(doc, 0)).toEqual({ sceneIdx: 0, beatIdx: 0 });
  expect(beatLocation(doc, 1)).toEqual({ sceneIdx: 0, beatIdx: 1 });
  expect(beatLocation(doc, 2)).toEqual({ sceneIdx: 1, beatIdx: 0 });
  expect(beatLocation(doc, 9)).toBeNull();
});
