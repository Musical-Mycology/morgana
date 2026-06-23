import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateDeckDoc } from "@/engine/deck-doc";

test("samples/demo.deck.json is a valid DeckDoc", () => {
  const doc = JSON.parse(readFileSync(join(process.cwd(), "samples/demo.deck.json"), "utf8"));
  expect(validateDeckDoc(doc)).toEqual({ ok: true, errors: [] });
});
