import { expect, test } from "vitest";
import { updateObjectTransform } from "@/lib/editor/object-mutations";
import type { DeckDoc } from "@/engine/deck-doc";
import type { SceneObject } from "@/engine/deck/types";

const obj = (id: string): SceneObject => ({ id, kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });
const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [obj("a"), obj("b")], beats: [] },
] });

test("merges a partial transform patch immutably", () => {
  const d = updateObjectTransform(base(), "s1", [1], { x: 0.5, w: 0.4 });
  expect(d.scenes[0].objects![1].transform).toEqual({ x: 0.5, y: 0.1, w: 0.4, h: 0.2 });
  expect(base().scenes[0].objects![1].transform.x).toBe(0.1); // input untouched
});

test("no-op on unknown scene or path returns the same doc reference", () => {
  const b = base();
  expect(updateObjectTransform(b, "nope", [0], { x: 0.5 })).toBe(b);
  expect(updateObjectTransform(b, "s1", [9], { x: 0.5 })).toBe(b);
});
