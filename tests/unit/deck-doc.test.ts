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

const withEmitter = (over: Record<string, unknown>): DeckDoc => ({
  ...good,
  scenes: [{ id: "s1", beats: [{ id: "b1", timeline: [
    { kind: "note_emitter", color: "#ffffff", pos: { x: 0.5, y: 0.5 }, dir: 0, decay: 1000, freq: 2, ...over },
  ] }] }],
} as unknown as DeckDoc);

test("note_emitter freq and decay must be finite numbers >= 0", () => {
  expect(validateDeckDoc(withEmitter({}))).toEqual({ ok: true, errors: [] });
  expect(validateDeckDoc(withEmitter({ freq: 0, decay: 0 })).ok).toBe(true);
  for (const bad of [NaN, Infinity, -Infinity, "6", -1, null]) {
    expect(validateDeckDoc(withEmitter({ freq: bad })).errors).toContain("scenes[0].beats[0].timeline[0].freq must be a finite number ≥ 0");
    expect(validateDeckDoc(withEmitter({ decay: bad })).errors).toContain("scenes[0].beats[0].timeline[0].decay must be a finite number ≥ 0");
  }
});
