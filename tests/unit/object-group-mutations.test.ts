import { expect, test } from "vitest";
import { groupObjects, ungroupObject, reparentObject } from "@/lib/editor/object-mutations";
import type { DeckDoc } from "@/engine/deck-doc";
import type { SceneObject } from "@/engine/deck/types";

const at = (id: string, x: number, y: number, w = 0.2, h = 0.2): SceneObject =>
  ({ id, kind: "shape", shape: "rect", transform: { x, y, w, h } });
const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [at("a", 0.1, 0.1), at("b", 0.5, 0.5), at("c", 0.8, 0.0)], beats: [] },
] });

test("groupObjects wraps same-parent siblings into a new group at the topmost slot", () => {
  const d = groupObjects(base(), "s1", [[0], [2]], "grp");
  const ids = d.scenes[0].objects!.map((o) => o.id);
  expect(ids).toEqual(["grp", "b"]);              // group takes index 0 (topmost selected was [0])
  const grp = d.scenes[0].objects![0] as any;
  expect(grp.kind).toBe("group");
  expect(grp.children.map((o: SceneObject) => o.id)).toEqual(["a", "c"]); // original order preserved
  // union bbox spans a(0.1,0.1,0.2,0.2) + c(0.8,0.0,0.2,0.2) → x0.1 y0.0 w0.9 h0.3
  expect(grp.transform.x).toBeCloseTo(0.1); expect(grp.transform.y).toBeCloseTo(0.0);
  expect(grp.transform.w).toBeCloseTo(0.9); expect(grp.transform.h).toBeCloseTo(0.3);
});

test("groupObjects with paths under different parents is a no-op", () => {
  let d = groupObjects(base(), "s1", [[0], [1]], "g1");   // group a,b first
  const b = d;
  // now try to group a root object [1] with a nested one [0,0] → different parents
  expect(groupObjects(b, "s1", [[1], [0, 0]], "g2")).toBe(b);
});

test("ungroupObject splices a group's children back into the parent at its slot", () => {
  const grouped = groupObjects(base(), "s1", [[0], [1]], "grp"); // → [grp(a,b), c]
  const d = ungroupObject(grouped, "s1", [0]);
  expect(d.scenes[0].objects!.map((o) => o.id)).toEqual(["a", "b", "c"]);
});

test("ungroupObject on a non-group is a no-op", () => {
  const b = base();
  expect(ungroupObject(b, "s1", [0])).toBe(b);
});

test("reparentObject moves a node into a group", () => {
  const grouped = groupObjects(base(), "s1", [[0]], "grp"); // → [grp(a), b, c]
  const d = reparentObject(grouped, "s1", [1], [0], 0);     // move b into grp at index 0
  const grp = d.scenes[0].objects![0] as any;
  expect(grp.children.map((o: SceneObject) => o.id)).toEqual(["b", "a"]);
  expect(d.scenes[0].objects!.map((o) => o.id)).toEqual(["grp", "c"]);
});

test("reparentObject refuses to move a group into its own subtree", () => {
  const grouped = groupObjects(base(), "s1", [[0]], "grp"); // grp at [0], its child a at [0,0]
  const b = grouped;
  expect(reparentObject(b, "s1", [0], [0, 0], 0)).toBe(b);
});
