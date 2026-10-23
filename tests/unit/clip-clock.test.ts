import { expect, test } from "vitest";
import { clipTimeAt, HOLD_EPSILON } from "@/engine/deck/clip-clock";

test("clip time runs from the moment the clip appeared", () => {
  expect(clipTimeAt(10, 12, undefined, 5)).toBe(2);
  expect(clipTimeAt(10, 12, { in: 1 }, 5)).toBe(3);
});

test("clip time is never negative (scrub before it appeared)", () => {
  expect(clipTimeAt(10, 9, undefined, 5)).toBe(0);
});

test("a clip shorter than its time on screen holds its last frame", () => {
  expect(HOLD_EPSILON).toBe(0.001);
  expect(clipTimeAt(10, 20, undefined, 5)).toBeCloseTo(5 - 0.001, 10);
});

test("loop wraps within [in, duration)", () => {
  expect(clipTimeAt(10, 16, { loop: true }, 5)).toBeCloseTo(1, 10);
  expect(clipTimeAt(10, 16, { in: 1, loop: true }, 5)).toBeCloseTo(3, 10);
});

test("unknown duration is treated as unbounded", () => {
  expect(clipTimeAt(0, 7, undefined, NaN)).toBe(7);
  expect(clipTimeAt(0, 7, undefined)).toBe(7);
});

test("an in-point past the end is clamped", () => {
  expect(clipTimeAt(0, 0, { in: 9 }, 5)).toBeCloseTo(5 - 0.001, 10);
});

test("loop with duration <= in falls back to hold", () => {
  expect(clipTimeAt(0, 3, { in: 9, loop: true }, 5)).toBeCloseTo(5 - 0.001, 10);
});
