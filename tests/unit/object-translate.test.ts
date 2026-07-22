import { expect, test } from "vitest";
import { translateObjectBy } from "@/lib/editor/object-mutations";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "a", kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.2, w: 0.3, h: 0.3 } },
    { id: "g", kind: "group", transform: { x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, children: [
      { id: "c0", kind: "shape", shape: "rect", transform: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } },
      { id: "c1", kind: "shape", shape: "rect", transform: { x: 0.7, y: 0.7, w: 0.1, h: 0.1 } },
    ] },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

test("translates a leaf object's x/y", () => {
  const next = translateObjectBy(doc(), "s1", [0], 0.05, -0.1);
  expect(next.scenes[0].objects![0].transform).toMatchObject({ x: 0.15, y: 0.1, w: 0.3, h: 0.3 });
});

test("translating a group offsets the group and every descendant", () => {
  const next = translateObjectBy(doc(), "s1", [1], 0.1, 0.1);
  const g = next.scenes[0].objects![1] as Extract<NonNullable<typeof next.scenes[0]["objects"]>[number], { kind: "group" }>;
  expect(g.transform).toMatchObject({ x: 0.6, y: 0.6 });
  expect(g.children[0].transform).toMatchObject({ x: 0.6, y: 0.6 });
  expect(g.children[1].transform).toMatchObject({ x: 0.8, y: 0.8 });
});

test("zero delta and unknown path return the same doc reference", () => {
  const d = doc();
  expect(translateObjectBy(d, "s1", [0], 0, 0)).toBe(d);
  expect(translateObjectBy(d, "s1", [9], 0.1, 0.1)).toBe(d);
  expect(translateObjectBy(d, "nope", [0], 0.1, 0.1)).toBe(d);
});
