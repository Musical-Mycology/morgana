import { expect, test } from "vitest";
import { pointerFraction } from "@/lib/editor/object-drag";

const rect = { left: 100, top: 50, width: 800, height: 450 } as DOMRect;

test("maps client coords to a clamped 0–1 fraction of the rect", () => {
  expect(pointerFraction(rect, 500, 275)).toEqual({ x: 0.5, y: 0.5 });
  expect(pointerFraction(rect, 100, 50)).toEqual({ x: 0, y: 0 });
  expect(pointerFraction(rect, 5000, 5000)).toEqual({ x: 1, y: 1 }); // clamped
  expect(pointerFraction(rect, -100, -100)).toEqual({ x: 0, y: 0 });   // clamped
});
