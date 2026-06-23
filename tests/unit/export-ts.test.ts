import { expect, test } from "vitest";
import { deckDocToModule } from "@/lib/bridge/export-ts";
import type { DeckDoc } from "@/engine/deck-doc";

const doc: DeckDoc = {
  version: 1, meta: { id: "demo", title: "Demo" },
  scenes: [{ id: "s1", beats: [{ id: "b1", timeline: [{ kind: "text", value: "hi", in: "fade" }] }] }],
};

test("emits a typed TS module and round-trips the scenes JSON", () => {
  const out = deckDocToModule(doc, { constName: "demoScenes" });
  expect(out).toContain('import type { Scene } from "@/lib/deck/types";');
  expect(out).toContain("export const demoScenes: Scene[] =");
  // extract the array literal and parse it back
  const json = out.slice(out.indexOf("=") + 1, out.lastIndexOf(";")).trim();
  expect(JSON.parse(json)).toEqual(doc.scenes);
});

test("defaults: const name 'scenes' and the mm-website types import path", () => {
  const out = deckDocToModule(doc);
  expect(out).toContain("export const scenes: Scene[] =");
  expect(out).toContain('from "@/lib/deck/types"');
});
