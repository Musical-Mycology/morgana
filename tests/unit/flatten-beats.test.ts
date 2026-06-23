import { expect, test } from "vitest";
import { flattenBeats } from "@/lib/editor/flatten-beats";
import type { DeckDoc } from "@/engine/deck-doc";
const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] }, { id: "s2", beats: [{ id: "c", timeline: [] }] } ] };
test("one entry per beat, carrying sceneId", () => {
  expect(flattenBeats(doc).map((e) => [e.sceneId, e.beat.id])).toEqual([["s1", "a"], ["s1", "b"], ["s2", "c"]]);
});
