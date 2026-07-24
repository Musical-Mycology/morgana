import { expect, test } from "vitest";
import { moveSceneBy, deleteSceneAtIndex, deleteSceneAt, appendBeatToScene } from "@/lib/editor/mutations";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] },
  { id: "s2", beats: [{ id: "c", timeline: [] }] },
  { id: "s3", beats: [] },
] });

test("moveSceneBy swaps adjacent scenes", () => {
  expect(moveSceneBy(base(), 0, 1).scenes.map((s) => s.id)).toEqual(["s2", "s1", "s3"]);
  expect(moveSceneBy(base(), 2, -1).scenes.map((s) => s.id)).toEqual(["s1", "s3", "s2"]);
});

test("moveSceneBy no-ops at both ends and out of range, returning the same reference", () => {
  const d = base();
  expect(moveSceneBy(d, 0, -1)).toBe(d);
  expect(moveSceneBy(d, 2, 1)).toBe(d);
  expect(moveSceneBy(d, 9, 1)).toBe(d);
  expect(moveSceneBy(d, -1, 1)).toBe(d);
});

test("deleteSceneAtIndex removes the scene by index, including an empty one", () => {
  expect(deleteSceneAtIndex(base(), 0).scenes.map((s) => s.id)).toEqual(["s2", "s3"]);
  expect(deleteSceneAtIndex(base(), 2).scenes.map((s) => s.id)).toEqual(["s1", "s2"]);
});

test("deleteSceneAtIndex no-ops out of range, returning the same reference", () => {
  const d = base();
  expect(deleteSceneAtIndex(d, 9)).toBe(d);
  expect(deleteSceneAtIndex(d, -1)).toBe(d);
});

test("deleteSceneAt still deletes the scene CONTAINING a flat beat index", () => {
  expect(deleteSceneAt(base(), 2).scenes.map((s) => s.id)).toEqual(["s1", "s3"]); // flat 2 is "c" in s2
  const d = base();
  expect(deleteSceneAt(d, 99)).toBe(d);
});

test("appendBeatToScene appends a fresh beat, including to an empty scene", () => {
  const d = appendBeatToScene(base(), 2);
  expect(d.scenes[2].beats.map((b) => b.id)).toEqual(["b-1"]);
  expect(d.scenes[2].beats[0].timeline.length).toBe(1); // newBeat's non-empty default
  expect(appendBeatToScene(base(), 0).scenes[0].beats.map((b) => b.id)).toEqual(["a", "b", "b-1"]);
});

test("appendBeatToScene no-ops out of range, returning the same reference", () => {
  const d = base();
  expect(appendBeatToScene(d, 9)).toBe(d);
});
