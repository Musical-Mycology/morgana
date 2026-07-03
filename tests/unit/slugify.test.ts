import { expect, test } from "vitest";
import { slugify } from "@/lib/library/slugify";

test("lowercases and hyphenates", () => {
  expect(slugify("Fall Product Reveal")).toBe("fall-product-reveal");
});

test("collapses repeated separators and strips leading/trailing hyphens", () => {
  expect(slugify("Deck #2!!")).toBe("deck-2");
  expect(slugify("  spaced  out  ")).toBe("spaced-out");
});

test("leaves an already-valid id unchanged", () => {
  expect(slugify("already-valid-id")).toBe("already-valid-id");
});

test("falls back to a fixed prefix when nothing alphanumeric survives", () => {
  expect(slugify("!!!")).toBe("deck");
  expect(slugify("")).toBe("deck");
});

test("always matches DECK_ID_RE", () => {
  const DECK_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
  for (const input of ["Fall Product Reveal", "!!!", "Q3 Investor Update", "123 Go", "---"]) {
    expect(slugify(input)).toMatch(DECK_ID_RE);
  }
});
