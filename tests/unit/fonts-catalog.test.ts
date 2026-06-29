import { expect, test } from "vitest";
import { FONT_CATALOG, FONT_DEFAULTS, fontFamilies } from "@/lib/fonts/catalog";

test("catalog has the starter library and the 3 defaults", () => {
  expect(FONT_CATALOG.length).toBeGreaterThanOrEqual(8);
  const names = FONT_CATALOG.map((f) => f.family);
  expect(names).toEqual(expect.arrayContaining(["Londrina Solid", "Atkinson Hyperlegible", "Dancing Script", "Inter"]));
  expect(names).toContain(FONT_DEFAULTS.display);
  expect(names).toContain(FONT_DEFAULTS.body);
  expect(names).toContain(FONT_DEFAULTS.cursive);
});

test("fontFamilies filters by role", () => {
  expect(fontFamilies("cursive").every((f) => f.role === "cursive")).toBe(true);
  expect(fontFamilies().length).toBe(FONT_CATALOG.length);
});
