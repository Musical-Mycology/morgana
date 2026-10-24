import { expect, test } from "vitest";
import {
  CREDITS_GAP, CREDITS_NAME_LH, CREDITS_ROLE_LH, DEFAULT_CREDITS_AREA,
  creditLineWindow, creditsOffset, creditsScroll, estimateCreditsBlockH,
} from "@/engine/deck/credits";
import { scrollOffsetAt } from "@/engine/components/effects/note-state";

test("the default area", () => {
  expect(DEFAULT_CREDITS_AREA).toEqual({ x: 0.2, y: 0.32, w: 0.6, h: 0.63 });
});

test("creditsOffset: areaH at the start, −blockH at the end, linear and clamped", () => {
  expect(creditsOffset(0, 4000, 300, 200)).toBe(200);
  expect(creditsOffset(4, 4000, 300, 200)).toBe(-300);
  expect(creditsOffset(2, 4000, 300, 200)).toBe(-50);
  expect(creditsOffset(-1, 4000, 300, 200)).toBe(200);
  expect(creditsOffset(9, 4000, 300, 200)).toBe(-300);
  expect(creditsOffset(1, 4000, 300, 200) - creditsOffset(0, 4000, 300, 200))
    .toBeCloseTo(creditsOffset(3, 4000, 300, 200) - creditsOffset(2, 4000, 300, 200), 12);
  expect(creditsOffset(0, 0, 300, 200)).toBe(-300);
});

test("creditsScroll agrees with creditsOffset at every t (one formula for paint and particles)", () => {
  const s = creditsScroll(1, 4000, 0.5, 0.63);
  expect(s).toEqual({ t0: 1, dur: 4, from: 0.63, to: -0.5 });
  for (const t of [0, 1, 1.7, 3, 5, 8]) expect(scrollOffsetAt(s, t)).toBeCloseTo(creditsOffset(t - 1, 4000, 0.5, 0.63), 12);
});

test("creditLineWindow: from the top edge entering the area's bottom to it leaving the area's top", () => {
  const area = { y: 0.32, h: 0.63 };
  const s = { t0: 1, dur: 10, from: 0.63, to: -0.5 };      // k = −0.113 per second
  const w = creditLineWindow(0.42, area, s)!;              // a line 0.1 below the block top
  expect(w.start).toBeCloseTo(1 + 0.1 / 0.113, 9);
  expect(w.end).toBeCloseTo(1 + 0.73 / 0.113, 9);
  const yAt = (t: number) => 0.42 + scrollOffsetAt(s, t);
  expect(yAt(w.start)).toBeCloseTo(0.95, 9);               // enters at the area's bottom
  expect(yAt(w.end)).toBeCloseTo(0.32, 9);                 // leaves at the area's top
});

test("creditLineWindow: the first line enters at once; clipped to the roll; null when not moving up", () => {
  const area = { y: 0.32, h: 0.63 };
  const s = { t0: 2, dur: 4, from: 0.63, to: -0.2 };
  expect(creditLineWindow(0.32, area, s)!.start).toBeCloseTo(2, 12);
  const lastLine = creditLineWindow(0.32 + 0.2, area, s)!; // its top only reaches 0.32 + 0.2 − 0.2 = area.y at the end
  expect(lastLine.end).toBeCloseTo(6, 9);
  expect(creditLineWindow(0.4, area, { t0: 0, dur: 4, from: 0.2, to: 0.2 })).toBeNull();
  expect(creditLineWindow(0.4, area, { t0: 0, dur: 0, from: 0.63, to: -0.2 })).toBeNull();
});

test("estimateCreditsBlockH sums role lines, name lines and item gaps", () => {
  expect(estimateCreditsBlockH([{ role: "Dir", names: ["A"] }, { names: ["B", "C"] }]))
    .toBeCloseTo(CREDITS_ROLE_LH + CREDITS_NAME_LH + CREDITS_GAP + 2 * CREDITS_NAME_LH, 12);
  expect(estimateCreditsBlockH([{ role: "", names: ["A"] }])).toBeCloseTo(CREDITS_NAME_LH, 12); // an empty role draws no line
  expect(estimateCreditsBlockH([])).toBe(0);
});
