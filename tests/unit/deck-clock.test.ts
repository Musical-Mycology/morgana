import { expect, test } from "vitest";
import { deckLayout, locate, deckTimeOf, sceneOverrun } from "@/engine/authoring/deck-clock";
import type { DeckDoc } from "@/engine/deck-doc";
import type { Beat, Scene } from "@/engine/deck/types";

const w = (id: string, ms: number): Beat => ({ id, timeline: [{ kind: "wait", ms }] });
const zero = (id: string): Beat => ({ id, timeline: [{ kind: "art", art: { to: "3.02", mode: "cut" } }] });
const doc = (scenes: Scene[]): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes });

// s0 pinned 5s with 3s content (2s hold); s1 unpinned 2+1=3s; s2 empty pinned 2s; s3 pinned 1s with 2.5s content (overrun)
const D = doc([
  { id: "s0", durationSec: 5, beats: [w("a", 1000), w("b", 2000)] },
  { id: "s1", beats: [w("c", 2000), w("d", 1000)] },
  { id: "s2", durationSec: 2, beats: [] },
  { id: "s3", durationSec: 1, beats: [w("e", 2500)] },
]);

test("deckLayout: starts, lengths, content, flat indices", () => {
  const L = deckLayout(D);
  expect(L.scenes.map((s) => [s.start, s.length, s.contentLength, s.pinned])).toEqual([
    [0, 5, 3, true], [5, 3, 3, false], [8, 2, 0, true], [10, 1, 2.5, true],
  ]);
  expect(L.total).toBe(11);
  expect(L.scenes[1].beats.map((b) => [b.flatIdx, b.start, b.duration])).toEqual([[2, 0, 2], [3, 2, 1]]);
});

test("play phase maps T into the right beat", () => {
  expect(locate(deckLayout(D), 0.5)).toEqual({ sceneIdx: 0, beatIdx: 0, flatIdx: 0, localT: 0.5, phase: "play" });
  expect(locate(deckLayout(D), 1.5)).toEqual({ sceneIdx: 0, beatIdx: 1, flatIdx: 1, localT: 0.5, phase: "play" });
});

test("hold phase: content ended before the pinned end → last beat, settled", () => {
  expect(locate(deckLayout(D), 4)).toEqual({ sceneIdx: 0, beatIdx: 1, flatIdx: 1, localT: 2, phase: "hold" });
});

test("scenes are half-open: exactly on a boundary belongs to the next scene", () => {
  expect(locate(deckLayout(D), 5)).toMatchObject({ sceneIdx: 1, beatIdx: 0, localT: 0, phase: "play" });
});

test("empty pinned scene", () => {
  expect(locate(deckLayout(D), 9)).toEqual({ sceneIdx: 2, beatIdx: null, flatIdx: null, localT: 0, phase: "empty" });
});

test("overrun is cut at the boundary; later scenes never move", () => {
  const L = deckLayout(D);
  expect(sceneOverrun(L.scenes[3])).toBeCloseTo(1.5);
  expect(sceneOverrun(L.scenes[0])).toBe(0);
  expect(sceneOverrun(L.scenes[1])).toBe(0);
  expect(locate(L, 10.5)).toMatchObject({ sceneIdx: 3, localT: 0.5, phase: "play" });
});

test("T is clamped; T === total is the final end state", () => {
  const L = deckLayout(D);
  expect(locate(L, -4)).toMatchObject({ sceneIdx: 0, localT: 0 });
  expect(locate(L, 999)).toMatchObject({ sceneIdx: 3, beatIdx: 0, localT: 1 });
});

test("zero-length beats are skipped while content plays; the last beat is shown once content has finished", () => {
  const L = deckLayout(doc([{ id: "s", beats: [zero("z"), w("a", 1000), zero("y")] }]));
  expect(locate(L, 0)).toEqual({ sceneIdx: 0, beatIdx: 1, flatIdx: 1, localT: 0, phase: "play" });
  expect(locate(L, 1)).toEqual({ sceneIdx: 0, beatIdx: 2, flatIdx: 2, localT: 0, phase: "hold" });
});

test("a pinned scene whose beats are all zero-length holds its last beat", () => {
  const L = deckLayout(doc([{ id: "s", durationSec: 3, beats: [zero("z"), zero("y")] }]));
  expect(locate(L, 1)).toEqual({ sceneIdx: 0, beatIdx: 1, flatIdx: 1, localT: 0, phase: "hold" });
});

test("a trailing zero-length beat is the held frame once content has finished", () => {
  const L = deckLayout(doc([{ id: "s", durationSec: 3, beats: [w("a", 1000), zero("z")] }]));
  expect(locate(L, 2)).toEqual({ sceneIdx: 0, beatIdx: 1, flatIdx: 1, localT: 0, phase: "hold" });
});

test("a held final scene is 'hold' at its end, including exact content end", () => {
  const L = deckLayout(doc([{ id: "s", durationSec: 5, beats: [w("a", 1000), w("b", 2000)] }]));
  expect(locate(L, 5)).toEqual({ sceneIdx: 0, beatIdx: 1, flatIdx: 1, localT: 2, phase: "hold" });
  expect(locate(L, 3)).toEqual({ sceneIdx: 0, beatIdx: 1, flatIdx: 1, localT: 2, phase: "hold" });
  expect(locate(L, 4.999)).toEqual({ sceneIdx: 0, beatIdx: 1, flatIdx: 1, localT: 2, phase: "hold" });
});

test("overrun: a beat starting exactly at the cut boundary is not reached at T === total", () => {
  const L = deckLayout(doc([{ id: "s", durationSec: 1, beats: [w("a", 1000), w("b", 1000)] }]));
  expect(locate(L, 1)).toEqual({ sceneIdx: 0, beatIdx: 0, flatIdx: 0, localT: 1, phase: "play" });
});

test("an exact intra-scene beat boundary starts the next beat in play", () => {
  expect(locate(deckLayout(D), 1)).toEqual({ sceneIdx: 0, beatIdx: 1, flatIdx: 1, localT: 0, phase: "play" });
});

test("overrun: beats starting at or after the cut boundary are never reached", () => {
  const L = deckLayout(doc([{ id: "s", durationSec: 1, beats: [w("a", 500), w("b", 2000), w("c", 1000)] }]));
  expect(locate(L, 0.75)).toEqual({ sceneIdx: 0, beatIdx: 1, flatIdx: 1, localT: 0.25, phase: "play" });
  expect(locate(L, 1)).toEqual({ sceneIdx: 0, beatIdx: 1, flatIdx: 1, localT: 0.5, phase: "play" });
});

test("zero-length scenes are skipped", () => {
  const L = deckLayout(doc([{ id: "gap", beats: [] }, { id: "s", beats: [w("a", 1000)] }]));
  expect(L.total).toBe(1);
  expect(locate(L, 0)).toMatchObject({ sceneIdx: 1, beatIdx: 0 });
});

test("nothing to play → null", () => {
  expect(locate(deckLayout(doc([{ id: "gap", beats: [] }])), 0)).toBeNull();
  expect(locate(deckLayout(doc([])), 0)).toBeNull();
});

test("deckTimeOf is the inverse of locate inside content", () => {
  const L = deckLayout(D);
  for (const T of [0.25, 1.5, 6.2, 7.9, 10.4]) {
    const l = locate(L, T)!;
    expect(deckTimeOf(L, l.flatIdx!, l.localT)).toBeCloseTo(T);
  }
  expect(deckTimeOf(L, 99, 0)).toBe(0); // unknown flat index
  expect(deckTimeOf(L, 4, 9)).toBe(11); // clamped to the scene's (cut) end
});

test("sceneOverrun absorbs float fuzz: content that exactly fills a pin is not an overrun", () => {
  // 100ms/1000 + 200ms/1000 is 0.30000000000000004 in floats; the scene exactly fills its 0.3s pin.
  const L = deckLayout(doc([{ id: "s", durationSec: 0.3, beats: [w("a", 100), w("b", 200)] }]));
  expect(L.scenes[0].contentLength).not.toBe(0.3);
  expect(sceneOverrun(L.scenes[0])).toBe(0);
});

test("sceneOverrun reports a real 30ms overrun", () => {
  const L = deckLayout(doc([{ id: "s", durationSec: 1, beats: [w("a", 1030)] }]));
  expect(sceneOverrun(L.scenes[0])).toBeCloseTo(0.03, 6);
});
