import { expect, test } from "vitest";
import {
  clamp01, hash32, mulberry32, backOut2, powerOut1, powerIn1,
  EMIT_SPEED_N, NOTE_SIZE_N, STAGE_ASPECT,
} from "@/engine/components/effects/note-state";

test("clamp01 pins to the unit interval", () => {
  expect(clamp01(-0.5)).toBe(0);
  expect(clamp01(0.25)).toBe(0.25);
  expect(clamp01(3)).toBe(1);
});

test("hash32 is a pure, well-distributed uint32", () => {
  expect(hash32(0, 0)).toBe(hash32(0, 0));          // pure
  expect(hash32(1, 2)).not.toBe(hash32(2, 1));      // order matters
  for (const [a, b] of [[0, 0], [1, 7], [255, 1024]]) {
    const h = hash32(a, b);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  }
});

test("mulberry32 is reproducible and stays in [0,1)", () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  expect(seqA).toEqual(seqB);
  for (const v of seqA) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  expect(new Set(seqA).size).toBe(3);               // not a constant generator
});

test("ease functions match GSAP's formulas at their endpoints and midpoint", () => {
  // back.out(2): overshoots above 1 in the middle, pinned at the ends
  expect(backOut2(0)).toBeCloseTo(0, 10);
  expect(backOut2(1)).toBeCloseTo(1, 10);
  expect(backOut2(0.5)).toBeCloseTo(1.125, 10);     // (−.5)²·(3(−.5)+2)+1
  // power1.out = 1 − (1−p)²
  expect(powerOut1(0)).toBeCloseTo(0, 10);
  expect(powerOut1(0.5)).toBeCloseTo(0.75, 10);
  expect(powerOut1(1)).toBeCloseTo(1, 10);
  // power1.in = p²
  expect(powerIn1(0)).toBeCloseTo(0, 10);
  expect(powerIn1(0.5)).toBeCloseTo(0.25, 10);
  expect(powerIn1(1)).toBeCloseTo(1, 10);
});

test("normalization constants derive from the 1920px reference stage", () => {
  expect(EMIT_SPEED_N).toBeCloseTo(130 / 1920, 10);
  expect(NOTE_SIZE_N).toBeCloseTo(42 / 1920, 10);
  expect(STAGE_ASPECT).toBeCloseTo(16 / 9, 10);
});
