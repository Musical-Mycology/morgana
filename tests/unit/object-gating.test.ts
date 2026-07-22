// tests/unit/object-gating.test.ts
import { expect, test } from "vitest";
import { revealedObjectIds, isGated, objectRefOptions } from "@/lib/editor/object-gating";
import type { Scene } from "@/engine/deck/types";

const scene = (): Scene => ({
  id: "s1",
  objects: [
    { id: "logo", name: "Logo", kind: "image", src: "", transform: { x: 0, y: 0, w: 0.2, h: 0.2 } },
    { id: "grp", kind: "group", transform: { x: 0, y: 0, w: 1, h: 1 }, children: [
      { id: "cap", kind: "text", text: "hi", transform: { x: 0, y: 0, w: 0.3, h: 0.1 } },
    ] },
  ],
  beats: [
    { id: "b1", timeline: [{ kind: "obj_reveal", target: "cap" }] },
    { id: "b2", timeline: [{ kind: "obj_move", target: "logo", to: { x: 0.5 } }] },
  ],
});

test("revealedObjectIds collects obj_reveal targets across all beats", () => {
  expect(revealedObjectIds(scene())).toEqual(new Set(["cap"]));
});

test("isGated is true only for objects an obj_reveal targets", () => {
  const s = scene();
  expect(isGated(s, "cap")).toBe(true);   // revealed (nested child)
  expect(isGated(s, "logo")).toBe(false); // only moved, never revealed → visible from t=0
  expect(isGated(s, "grp")).toBe(false);
});

test("objectRefOptions lists every object incl. nested, label = name ?? id", () => {
  expect(objectRefOptions(scene())).toEqual([
    { value: "logo", label: "Logo" },
    { value: "grp", label: "grp" },
    { value: "cap", label: "cap" },
  ]);
});

test("objectRefOptions on an object-less scene is empty", () => {
  expect(objectRefOptions({ id: "s", beats: [] })).toEqual([]);
});
