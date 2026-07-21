import { expect, test } from "vitest";
import { OBJECT_REGISTRY, descriptorForObject } from "@/lib/editor/object-registry";
import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";
import { getPath } from "@/lib/editor/paths";

const KINDS = ["text", "image", "shape", "group"] as const;

test("every kind has a descriptor whose defaults() validates inside a scene", () => {
  for (const kind of KINDS) {
    const obj = descriptorForObject({ kind }).defaults();
    expect(obj.kind).toBe(kind);
    const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s1", objects: [obj], beats: [] }] };
    expect(validateDeckDoc(doc)).toEqual({ ok: true, errors: [] });
  }
});

test("transform schema keys resolve to finite numbers on each default", () => {
  for (const kind of KINDS) {
    const obj = descriptorForObject({ kind }).defaults();
    for (const key of ["transform.x", "transform.y", "transform.w", "transform.h"]) {
      expect(Number.isFinite(getPath(obj, key) as number)).toBe(true);
    }
  }
});

test("kind-specific defaults carry their required fields", () => {
  expect((descriptorForObject({ kind: "text" }).defaults() as any).text).toBeTypeOf("string");
  expect((descriptorForObject({ kind: "image" }).defaults() as any).src).toBeTypeOf("string");
  expect((descriptorForObject({ kind: "shape" }).defaults() as any).shape).toBeTypeOf("string");
  expect((descriptorForObject({ kind: "group" }).defaults() as any).children).toEqual([]);
});

test("OBJECT_REGISTRY covers exactly the four kinds", () => {
  expect(Object.keys(OBJECT_REGISTRY).sort()).toEqual(["group", "image", "shape", "text"]);
});
