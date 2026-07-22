// tests/unit/object-actions.test.ts
import { expect, test } from "vitest";
import { buildObjectAnimation, insertActionAt } from "@/lib/editor/object-actions";
import type { DeckDoc } from "@/engine/deck-doc";
import type { Scene } from "@/engine/deck/types";

const scene = (): Scene => ({
  id: "s1",
  objects: [{ id: "logo", kind: "image", src: "", transform: { x: 0.3, y: 0.4, w: 0.2, h: 0.2 } }],
  beats: [{ id: "b1", timeline: [{ kind: "clear" }] }],
});

test("buildObjectAnimation sets target for each verb", () => {
  const s = scene();
  expect(buildObjectAnimation(s, "logo", "obj_reveal")).toMatchObject({ kind: "obj_reveal", target: "logo", in: "fade" });
  expect(buildObjectAnimation(s, "logo", "obj_out")).toMatchObject({ kind: "obj_out", target: "logo" });
});

test("buildObjectAnimation seeds obj_move.to from the object's current position", () => {
  const a = buildObjectAnimation(scene(), "logo", "obj_move") as unknown as { to: Record<string, number> };
  expect(a.to).toEqual({ x: 0.3, y: 0.4 });
});

test("insertActionAt inserts at the given index", () => {
  const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [scene()] };
  const action = buildObjectAnimation(doc.scenes[0], "logo", "obj_reveal");
  const next = insertActionAt(doc, 0, 1, action);
  expect(next.scenes[0].beats[0].timeline.map((a) => a.kind)).toEqual(["clear", "obj_reveal"]);
  expect(doc.scenes[0].beats[0].timeline).toHaveLength(1); // input untouched
});
