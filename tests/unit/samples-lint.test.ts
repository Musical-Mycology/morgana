// @vitest-environment node
import { expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lintDeck } from "@/lib/editor/lint";
import type { DeckDoc } from "@/engine/deck-doc";

const samples = readdirSync("samples").filter((f) => f.endsWith(".deck.json"));

test("there are sample decks to check", () => {
  expect(samples.length).toBeGreaterThan(0);
});

test.each(samples)("%s has no structural errors", (file) => {
  const doc = JSON.parse(readFileSync(join("samples", file), "utf8")) as DeckDoc;
  const errors = lintDeck(doc).filter((i) => i.severity === "error");
  expect(errors).toEqual([]);   // an error means the deck would not even save
});

test.each(samples)("%s has no lint warnings", (file) => {
  const doc = JSON.parse(readFileSync(join("samples", file), "utf8")) as DeckDoc;
  const warnings = lintDeck(doc).filter((i) => i.severity === "warning");
  expect(warnings).toEqual([]);
});
