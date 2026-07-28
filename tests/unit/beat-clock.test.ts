import { expect, test } from "vitest";
import { actionDuration, isSeekable, beatTimeline, foldAt, rebuildBoundary } from "@/engine/authoring/beat-clock";
import type { Action } from "@/engine/deck/types";

test("actionDuration mirrors the engine's reservations", () => {
  expect(actionDuration({ kind: "wait", ms: 400 })).toBeCloseTo(0.4);
  expect(actionDuration({ kind: "media", id: "m", pos: { x: 0, y: 0 }, durationMs: 600 })).toBeCloseTo(0.6);
  expect(actionDuration({ kind: "fade_out", durationMs: 500 })).toBeCloseTo(0.5);
  expect(actionDuration({ kind: "text", value: "hi", in: "fade" })).toBeCloseTo(0.8, 1);
});

test("seekability: every effect is seekable except the inert `cue`", () => {
  expect(isSeekable({ kind: "text", value: "x", in: "fade" })).toBe(true);
  expect(isSeekable({ kind: "art", art: { to: "3.02", mode: "fade" } })).toBe(true);
  expect(isSeekable({ kind: "note_emitter", color: "#fff", pos: { x: 0, y: 0 }, dir: 0, decay: 1000, freq: 5 })).toBe(true);
  expect(isSeekable({ kind: "cue", cue: { effect: "noteEmit", action: "start" } })).toBe(false);
});

test("beatTimeline assigns sequential [start,end) windows", () => {
  const tl: Action[] = [
    { kind: "text", value: "a", in: "fade" },           // dur 0.8 → start 0
    { kind: "wait", ms: 200 },                            // dur 0.2 → start 0.8
    { kind: "art", art: { to: "3.02", mode: "fade" } },   // dur 0   → start 1.0
  ];
  const win = beatTimeline(tl);
  expect(win[0].start).toBeCloseTo(0);
  expect(win[1].start).toBeCloseTo(0.8, 1);
  expect(win[2].start).toBeCloseTo(1.0, 1);   // art has 0 duration but starts at 1.0
});

const TL: Action[] = [
  { kind: "text", value: "a", in: "fade" },   // dur 0.8 → [0, 0.8)
  { kind: "wait", ms: 200 },                  // dur 0.2 → [0.8, 1.0)
  { kind: "clear" },                          // dur 0   → at 1.0
  { kind: "text", value: "b", in: "fade" },   // dur 0.8 → [1.0, 1.8)
];

test("foldAt reports at most one in-flight action, and never one not yet reached", () => {
  const fold = foldAt(TL, 0.4);
  expect(fold.map((f) => f.index)).toEqual([0]);
  expect(fold[0].phase).toBe("in-flight");
  expect(fold[0].p).toBeCloseTo(0.5, 2);
});

test("foldAt settles everything at or past the end", () => {
  const fold = foldAt(TL, 99);
  expect(fold.map((f) => f.index)).toEqual([0, 1, 2, 3]);
  expect(fold.every((f) => f.phase === "settled" && f.p === 1)).toBe(true);
});

test("foldAt treats a zero-duration action as settled the instant it is reached", () => {
  const fold = foldAt(TL, 1.0);
  expect(fold.find((f) => f.index === 2)!.phase).toBe("settled");
});

test("rebuildBoundary finds the last destructive action at or before t", () => {
  expect(rebuildBoundary(TL, 0.5)).toBe(-1);  // nothing destructive yet
  expect(rebuildBoundary(TL, 1.4)).toBe(2);   // the clear at 1.0
});
