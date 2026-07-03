import { expect, test } from "vitest";
import { swatchGradient } from "@/lib/library/swatch";

test("is deterministic for the same id", () => {
  expect(swatchGradient("fall-reveal-2026")).toBe(swatchGradient("fall-reveal-2026"));
});

test("differs for different ids", () => {
  expect(swatchGradient("demo")).not.toBe(swatchGradient("our-story"));
});

test("returns a well-formed CSS linear-gradient", () => {
  expect(swatchGradient("demo")).toMatch(
    /^linear-gradient\(135deg, hsl\(\d+, 45%, 32%\), hsl\(\d+, 55%, 14%\)\)$/,
  );
});
