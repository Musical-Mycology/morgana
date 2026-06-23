import { expect, test } from "vitest";
import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";

const good: DeckDoc = {
  version: 1,
  meta: { id: "demo", title: "Demo" },
  scenes: [{ id: "s1", beats: [{ id: "b1", timeline: [{ kind: "text", value: "hi", in: "fade" }] }] }],
};

test("accepts a well-formed deck doc", () => {
  expect(validateDeckDoc(good)).toEqual({ ok: true, errors: [] });
});

test("rejects bad version / missing meta.id / non-array scenes", () => {
  expect(validateDeckDoc({ ...good, version: 2 }).ok).toBe(false);
  expect(validateDeckDoc({ ...good, meta: { title: "x" } }).ok).toBe(false);
  expect(validateDeckDoc({ ...good, scenes: "nope" }).ok).toBe(false);
});
