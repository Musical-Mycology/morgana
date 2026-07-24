import { expect, test } from "vitest";
import { flattenBeats, sceneGroups, flatIndexOfBeat, flatIndexOf } from "@/lib/editor/flatten-beats";
import type { DeckDoc } from "@/engine/deck-doc";
const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] }, { id: "s2", beats: [{ id: "c", timeline: [] }] } ] };
test("one entry per beat, carrying sceneId", () => {
  expect(flattenBeats(doc).map((e) => [e.sceneId, e.beat.id])).toEqual([["s1", "a"], ["s1", "b"], ["s2", "c"]]);
});

const withEmpty = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] },
  { id: "gap", beats: [] },
  { id: "s2", beats: [{ id: "c", timeline: [] }] },
] });

test("sceneGroups keeps empty scenes, unlike grouping the flat beat list", () => {
  const groups = sceneGroups(withEmpty());
  expect(groups.map((g) => g.sceneId)).toEqual(["s1", "gap", "s2"]);
  expect(groups.map((g) => g.sceneIdx)).toEqual([0, 1, 2]);
  expect(groups[1].items).toEqual([]);
});

test("sceneGroups assigns flat indices continuously across empty scenes", () => {
  const groups = sceneGroups(withEmpty());
  expect(groups[0].items).toEqual([{ flatIdx: 0, beatId: "a" }, { flatIdx: 1, beatId: "b" }]);
  expect(groups[2].items).toEqual([{ flatIdx: 2, beatId: "c" }]);
});

test("flatIndexOfBeat finds a beat by id, or returns -1", () => {
  expect(flatIndexOfBeat(withEmpty(), "c")).toBe(2);
  expect(flatIndexOfBeat(withEmpty(), "nope")).toBe(-1);
});

test("flatIndexOf maps scene+beat coordinates to a flat index, or returns -1", () => {
  expect(flatIndexOf(withEmpty(), 2, 0)).toBe(2);
  expect(flatIndexOf(withEmpty(), 0, 1)).toBe(1);
  expect(flatIndexOf(withEmpty(), 1, 0)).toBe(-1); // empty scene has no beats
  expect(flatIndexOf(withEmpty(), 9, 0)).toBe(-1);
});
