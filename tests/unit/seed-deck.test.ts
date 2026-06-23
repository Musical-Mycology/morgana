// @vitest-environment node
import { expect, test } from "vitest";
import { extractScenes, buildDoc } from "@/tools/seed-deck";
import { sampleScenes } from "@/tools/__fixtures__/sample-deck";

test("extractScenes finds the Scene[] export (array whose items have beats)", () => {
  const mod = { sampleScenes, sampleDeck: [{ id: "x", layout: "cinematic", slots: {} }] };
  expect(extractScenes(mod)).toBe(sampleScenes);
  expect(extractScenes(mod, "sampleScenes")).toBe(sampleScenes);
});

test("buildDoc wraps scenes in a valid DeckDoc envelope", () => {
  const doc = buildDoc(sampleScenes, { id: "sample", title: "Sample", treatment: "warm" });
  expect(doc.version).toBe(1);
  expect(doc.meta).toMatchObject({ id: "sample", title: "Sample", treatment: "warm" });
  expect(doc.scenes).toBe(sampleScenes);
});
