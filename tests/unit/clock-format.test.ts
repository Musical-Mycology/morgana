import { expect, test } from "vitest";
import { formatClock, parseClock } from "@/lib/timing/clock-format";

test("formatClock", () => {
  expect(formatClock(0)).toBe("0:00.0");
  expect(formatClock(47.34)).toBe("0:47.3");
  expect(formatClock(59.96)).toBe("1:00.0");   // rounding carries into minutes
  expect(formatClock(120, { tenths: false })).toBe("2:00");
  expect(formatClock(75.9, { tenths: false })).toBe("1:15"); // tenths:false floors, never shows 1:16 early
  expect(formatClock(-3)).toBe("0:00.0");
});

test("parseClock", () => {
  expect(parseClock("2:00")).toBe(120);
  expect(parseClock("1:30.5")).toBe(90.5);
  expect(parseClock("90")).toBe(90);
  expect(parseClock(" 0:15 ")).toBe(15);
  for (const bad of ["", "abc", "1:75", "-1", "1:2:3", "0", "0:00"]) expect(parseClock(bad)).toBeNull();
});
