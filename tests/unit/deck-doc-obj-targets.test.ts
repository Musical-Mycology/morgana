import { expect, test } from "vitest";
import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";

const base = (objects: unknown, timeline: unknown): DeckDoc => ({
  version: 1, meta: { id: "d", title: "D" },
  scenes: [{ id: "s1", objects, beats: [{ id: "b1", timeline }] }],
} as unknown as DeckDoc);

const OBJ = [{ id: "logo", kind: "image", src: "", transform: { x: 0, y: 0, w: 0.2, h: 0.2 } }];

test("accepts an obj_* action whose target exists in the scene", () => {
  expect(validateDeckDoc(base(OBJ, [{ kind: "obj_reveal", target: "logo", in: "fade" }])).ok).toBe(true);
});

test("rejects a dangling target (unknown id)", () => {
  const r = validateDeckDoc(base(OBJ, [{ kind: "obj_move", target: "ghost", to: { x: 0.5 } }]));
  expect(r.ok).toBe(false);
  expect(r.errors.join(" ")).toMatch(/ghost/);
});

test("rejects an empty target", () => {
  expect(validateDeckDoc(base(OBJ, [{ kind: "obj_out", target: "" }])).ok).toBe(false);
});

test("a target valid in another scene does not satisfy this scene", () => {
  const doc = {
    version: 1, meta: { id: "d", title: "D" }, scenes: [
      { id: "s1", objects: OBJ, beats: [{ id: "b1", timeline: [] }] },
      { id: "s2", objects: [], beats: [{ id: "b2", timeline: [{ kind: "obj_reveal", target: "logo" }] }] },
    ],
  } as unknown as DeckDoc;
  expect(validateDeckDoc(doc).ok).toBe(false);
});

test("rejects out-of-range / non-finite obj_move.to axes and negative duration", () => {
  expect(validateDeckDoc(base(OBJ, [{ kind: "obj_move", target: "logo", to: { x: 1.5 } }])).ok).toBe(false);
  expect(validateDeckDoc(base(OBJ, [{ kind: "obj_move", target: "logo", to: { w: 0 } }])).ok).toBe(false);
  expect(validateDeckDoc(base(OBJ, [{ kind: "obj_move", target: "logo", to: { rot: Infinity } }])).ok).toBe(false);
  expect(validateDeckDoc(base(OBJ, [{ kind: "obj_reveal", target: "logo", durationMs: -1 }])).ok).toBe(false);
});

test("legacy timelines without obj_* actions still validate", () => {
  expect(validateDeckDoc(base(OBJ, [{ kind: "text", value: "hi", in: "fade" }])).ok).toBe(true);
  expect(validateDeckDoc(base(undefined, [{ kind: "clear" }])).ok).toBe(true);
});
