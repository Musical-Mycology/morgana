import { expect, test } from "vitest";
import { insertBeatAfter, duplicateBeatAt, deleteBeatAt, moveBeatBy, appendScene, deleteSceneAt, uniqueBeatId, uniqueSceneId } from "@/lib/editor/mutations";
import { flattenBeats } from "@/lib/editor/flatten-beats";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }, { id: "b", timeline: [] }] },
  { id: "s2", beats: [{ id: "c", timeline: [] }] },
] });

test("uniqueBeatId / uniqueSceneId avoid collisions", () => {
  expect(uniqueBeatId(base())).toBe("b-1");          // a/b/c used, b-N free
  expect(uniqueSceneId(base())).toBe("s-1");          // s1/s2 used; the s-N namespace is free → s-1
});

test("insertBeatAfter adds a beat right after the flat index, in the same scene", () => {
  const d = insertBeatAfter(base(), 0);               // after "a"
  expect(d.scenes[0].beats.map((b) => b.id)).toEqual(["a", "b-1", "b"]);
  expect(d.scenes[0].beats[1].timeline.length).toBe(1); // non-empty default
});

test("duplicateBeatAt deep-clones with a fresh id", () => {
  const d = duplicateBeatAt(base(), 0);               // dup "a"
  expect(d.scenes[0].beats.map((b) => b.id)).toEqual(["a", "b-1", "b"]);
  expect(d.scenes[0].beats[1].timeline).toEqual(d.scenes[0].beats[0].timeline);
  d.scenes[0].beats[1].timeline.push({ kind: "clear" });        // independent copy
  expect(d.scenes[0].beats[0].timeline.length).toBe(1);
});

test("deleteBeatAt removes the targeted beat", () => {
  const d = deleteBeatAt(base(), 1);                  // delete "b"
  expect(flattenBeats(d).map((e) => e.beat.id)).toEqual(["a", "c"]);
});

test("moveBeatBy swaps within a scene; no-ops at the scene boundary", () => {
  expect(moveBeatBy(base(), 0, 1).scenes[0].beats.map((b) => b.id)).toEqual(["b", "a"]);
  const d = base();
  expect(moveBeatBy(d, 1, 1)).toBe(d);                // "b" is last in s1 → boundary no-op (same ref)
});

test("appendScene / deleteSceneAt add and remove whole scenes", () => {
  const added = appendScene(base());
  expect(added.scenes.map((s) => s.id)).toEqual(["s1", "s2", "s-1"]);
  expect(added.scenes[2].beats.length).toBe(1);
  const removed = deleteSceneAt(base(), 2);           // flat 2 is in s2
  expect(removed.scenes.map((s) => s.id)).toEqual(["s1"]);
});
