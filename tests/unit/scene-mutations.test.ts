import { expect, test } from "vitest";
import { moveSceneBy, deleteSceneAtIndex, deleteSceneAt, appendBeatToScene, moveBeatBy } from "@/lib/editor/mutations";
import { flattenBeats } from "@/lib/editor/flatten-beats";
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

test("moveBeatBy down off a scene tail prepends to the next scene, keeping the flat index", () => {
  const d = moveBeatBy(base(), 1, 1);                 // "b" tail of s1 → head of s2
  expect(d.scenes[0].beats.map((b) => b.id)).toEqual(["a"]);
  expect(d.scenes[1].beats.map((b) => b.id)).toEqual(["b", "c"]);
  expect(flattenBeats(d).map((f) => f.beat.id).indexOf("b")).toBe(1); // unchanged
});

test("moveBeatBy up off a scene head appends to the previous scene, keeping the flat index", () => {
  const d = moveBeatBy(base(), 2, -1);                // "c" head of s2 → tail of s1
  expect(d.scenes[0].beats.map((b) => b.id)).toEqual(["a", "b", "c"]);
  expect(d.scenes[1].beats).toEqual([]);
  expect(flattenBeats(d).map((f) => f.beat.id).indexOf("c")).toBe(2); // unchanged
});

test("moveBeatBy transfers into an empty scene", () => {
  const d = moveBeatBy(base(), 2, 1);                 // "c" tail of s2 → head of empty s3
  expect(d.scenes[1].beats).toEqual([]);
  expect(d.scenes[2].beats.map((b) => b.id)).toEqual(["c"]);
});

test("moveBeatBy may leave the source scene empty", () => {
  const d = moveBeatBy(base(), 2, -1);                // "c" was s2's only beat
  expect(d.scenes.map((s) => s.id)).toEqual(["s1", "s2", "s3"]); // scene NOT pruned
  expect(d.scenes[1].beats).toEqual([]);
});

test("moveBeatBy no-ops only when there is no adjacent scene", () => {
  const d = base();
  expect(moveBeatBy(d, 0, -1)).toBe(d);               // first beat of the first scene
  expect(moveBeatBy(d, 99, 1)).toBe(d);               // no such beat
  const tail: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "s1", beats: [{ id: "a", timeline: [] }] },
  ] };
  expect(moveBeatBy(tail, 0, 1)).toBe(tail);          // only beat of the only scene
});

test("moveBeatBy CAN move the flat-0 beat up when a leading empty scene exists", () => {
  const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [
    { id: "empty", beats: [] },
    { id: "s", beats: [{ id: "a", timeline: [] }] },
  ] };
  const d = moveBeatBy(doc, 0, -1);
  expect(d.scenes[0].beats.map((b) => b.id)).toEqual(["a"]);
  expect(d.scenes[1].beats).toEqual([]);
});
