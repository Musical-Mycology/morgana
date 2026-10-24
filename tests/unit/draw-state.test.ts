import { expect, test } from "vitest";
import { drawDuration, isDrawnLine, drawGlyphAt, drawSweepAt, drawText, wordRuns } from "@/engine/components/effects/draw-state";
import { introDuration } from "@/engine/authoring/beat-clock";

test("drawDuration = (0.1 + chars·0.08 + 0.4) / speed", () => {
  expect(drawDuration(3)).toBeCloseTo(0.74, 12);
  expect(drawDuration(3, 2)).toBeCloseTo(0.37, 12);
  expect(drawDuration(0)).toBeCloseTo(0.5, 12);
});

test("introDuration for a normal draw line follows drawDuration", () => {
  expect(introDuration({ in: "draw", value: "abc" })).toBeCloseTo(0.74, 12);
  expect(introDuration({ in: "draw", value: "abc", speed: 2 })).toBeCloseTo(0.37, 12);
  expect(introDuration({ in: "fade", value: "abc" })).toBe(0.8); // other styles unchanged
});

test("a dotted or empty draw line is timed exactly as fade (it reveals with fade), dots tail included", () => {
  expect(introDuration({ in: "draw", value: "Hi", dots: true })).toBe(introDuration({ in: "fade", value: "Hi", dots: true }));
  expect(introDuration({ in: "draw", value: "Hi", dots: true })).toBeGreaterThan(introDuration({ in: "fade", value: "Hi" }));
  expect(introDuration({ in: "draw", value: "" })).toBe(introDuration({ in: "fade", value: "" }));
  expect(introDuration({ in: "draw", value: "Hi", speed: 2 })).toBeCloseTo(drawDuration(2, 2), 12); // a normal draw line is unchanged
  expect(isDrawnLine({ in: "draw", value: "Hi" })).toBe(true);
  expect(isDrawnLine({ in: "draw", value: "Hi", dots: true })).toBe(false);
  expect(isDrawnLine({ in: "draw", value: "" })).toBe(false);
  expect(isDrawnLine({ in: "fade", value: "Hi" })).toBe(false);
});

test("drawGlyphAt: each glyph strokes over 0.18 s from i·0.08, then all glyphs fill together over 0.4 s", () => {
  expect(drawGlyphAt(0, 3, 0)).toEqual({ dash: 1, fill: 0, stroke: 1 });
  expect(drawGlyphAt(0, 3, 0.09).dash).toBeCloseTo(0.5, 12);
  expect(drawGlyphAt(1, 3, 0.09).dash).toBeCloseTo(1 - 0.01 / 0.18, 12);
  expect(drawGlyphAt(2, 3, 0.09).dash).toBe(1);
  const atFill = drawGlyphAt(2, 3, 0.34);
  expect(atFill.dash).toBeCloseTo(0, 12);
  expect(atFill.fill).toBeCloseTo(0, 12);
  const mid = drawGlyphAt(0, 3, 0.54);
  expect(mid.fill).toBeCloseTo(0.5, 12);
  expect(mid.stroke).toBeCloseTo(0.5, 12);
  expect(drawGlyphAt(1, 3, 0.74)).toEqual({ dash: 0, fill: 1, stroke: 0 });
  expect(drawGlyphAt(1, 3, 9)).toEqual({ dash: 0, fill: 1, stroke: 0 });
});

test("speed scales time: speed 2 at t is speed 1 at 2t", () => {
  expect(drawGlyphAt(0, 3, 0.045, 2)).toEqual(drawGlyphAt(0, 3, 0.09));
  expect(drawSweepAt(3, 0.085, 2)).toBeCloseTo(drawSweepAt(3, 0.17), 12);
});

test("drawSweepAt runs 0 → 1 over the outline phase (0.1 + chars·0.08)", () => {
  expect(drawSweepAt(3, 0)).toBe(0);
  expect(drawSweepAt(3, 0.17)).toBeCloseTo(0.5, 12);
  expect(drawSweepAt(3, 0.34)).toBeCloseTo(1, 12);
  expect(drawSweepAt(3, 5)).toBe(1);
});

test("drawText keeps length (newline → space); wordRuns finds each non-space run", () => {
  expect(drawText("A\nB c")).toBe("A B c");
  expect(wordRuns("  Hello  big world ")).toEqual([[2, 7], [9, 12], [13, 18]]);
  expect(wordRuns("   ")).toEqual([]);
});
