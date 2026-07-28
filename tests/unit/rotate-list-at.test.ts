import { expect, test } from "vitest";
import { ROTATE_STEP, rotateItemAt } from "@/engine/components/effects/cinematic-anim";

const items = ["alpha", "beta", "gamma"];

test("ROTATE_STEP matches the dwell rotateList's tweens actually occupy", () => {
  // fromTo 0.5 + "+=1.1" gap + out 0.45 (cinematic-anim.ts rotateList)
  expect(ROTATE_STEP).toBeCloseTo(2.05, 2);
});

test("rotateItemAt cycles items on ROTATE_STEP and wraps", () => {
  expect(rotateItemAt(items, 0)).toBe("alpha");
  expect(rotateItemAt(items, ROTATE_STEP * 1.5)).toBe("beta");
  expect(rotateItemAt(items, ROTATE_STEP * 3.2)).toBe("alpha");   // wrapped
});

test("rotateItemAt clamps a negative elapsed to the first item", () => {
  expect(rotateItemAt(items, -5)).toBe("alpha");
});

test("rotateItemAt tolerates an empty list", () => {
  expect(rotateItemAt([], 3)).toBe("");
});
