import { expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateDeckDoc } from "@/engine/deck-doc";

const samplesDir = join(process.cwd(), "samples");
const files = readdirSync(samplesDir).filter((f) => f.endsWith(".deck.json"));

test("samples directory has at least the demo and our-story decks", () => {
  // "at least" per the title — assert a subset, not an exact list, so new fixtures (e.g.
  // samples/notes.deck.json, the §7a parity-corpus seed) don't have to touch this test.
  expect(files).toEqual(expect.arrayContaining(["demo.deck.json", "our-story.deck.json"]));
});

test.each(files)("samples/%s is a valid DeckDoc", (file) => {
  const doc = JSON.parse(readFileSync(join(samplesDir, file), "utf8"));
  expect(validateDeckDoc(doc)).toEqual({ ok: true, errors: [] });
});
