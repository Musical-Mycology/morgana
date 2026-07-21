import { expect, test } from "vitest";
import { validateDeckDoc, MAX_OBJECT_DEPTH, type DeckDoc } from "@/engine/deck-doc";

const withObjects = (objects: unknown): DeckDoc =>
  ({ version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s1", objects, beats: [] }] } as unknown as DeckDoc);

test("accepts a scene with valid objects incl. a nested group", () => {
  const doc = withObjects([
    { id: "bg", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 1, h: 1 } },
    { id: "grp", kind: "group", transform: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, children: [
      { id: "title", kind: "text", text: "Hi", transform: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 } },
    ] },
  ]);
  expect(validateDeckDoc(doc)).toEqual({ ok: true, errors: [] });
});

test("an object-less scene is still valid", () => {
  expect(validateDeckDoc({ version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s1", beats: [] }] }).ok).toBe(true);
});

test("rejects duplicate ids within a scene, including a nested collision", () => {
  const doc = withObjects([
    { id: "dup", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 1, h: 1 } },
    { id: "grp", kind: "group", transform: { x: 0, y: 0, w: 1, h: 1 }, children: [
      { id: "dup", kind: "text", text: "x", transform: { x: 0, y: 0, w: 1, h: 1 } },
    ] },
  ]);
  expect(validateDeckDoc(doc).ok).toBe(false);
});

test("rejects bad kind, non-finite/non-positive transform, and out-of-range opacity", () => {
  expect(validateDeckDoc(withObjects([{ id: "a", kind: "blob", transform: { x: 0, y: 0, w: 1, h: 1 } }])).ok).toBe(false);
  expect(validateDeckDoc(withObjects([{ id: "a", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 0, h: 1 } }])).ok).toBe(false);
  expect(validateDeckDoc(withObjects([{ id: "a", kind: "shape", shape: "rect", transform: { x: NaN, y: 0, w: 1, h: 1 } }])).ok).toBe(false);
  expect(validateDeckDoc(withObjects([{ id: "a", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 1, h: 1 }, opacity: 2 }])).ok).toBe(false);
});

test("rejects nesting deeper than MAX_OBJECT_DEPTH", () => {
  let node: any = { id: "leaf", kind: "text", text: "x", transform: { x: 0, y: 0, w: 1, h: 1 } };
  for (let i = 0; i < MAX_OBJECT_DEPTH + 1; i++) {
    node = { id: `g${i}`, kind: "group", transform: { x: 0, y: 0, w: 1, h: 1 }, children: [node] };
  }
  expect(validateDeckDoc(withObjects([node])).ok).toBe(false);
});
