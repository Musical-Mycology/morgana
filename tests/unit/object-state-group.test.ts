import { describe, it, expect } from "vitest";
import { objectStateAt } from "@/lib/editor/object-state";
import type { Scene, SceneObject } from "@/engine/deck/types";

const leaf = (id: string, x: number, y: number): SceneObject =>
  ({ id, kind: "shape", shape: "rect", transform: { x, y, w: 0.1, h: 0.1 } } as SceneObject);

const groupScene = (): Scene => ({
  id: "s1",
  objects: [{
    id: "g", kind: "group", transform: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 },
    children: [leaf("c1", 0.25, 0.25), leaf("c2", 0.45, 0.45)],
  }],
  beats: [{ id: "b0", timeline: [{ kind: "obj_move", target: "g", to: { x: 0.3 } }] }], // 800ms; dx=+0.1 at p=1
});

describe("objectStateAt — group move", () => {
  it("translates the group box and every descendant by the same x/y delta", () => {
    const m = objectStateAt(groupScene(), 0, 0.8); // p=1
    expect(m.get("g")!.x).toBeCloseTo(0.3, 5);
    expect(m.get("c1")!.x).toBeCloseTo(0.35, 5); // 0.25 + 0.1
    expect(m.get("c2")!.x).toBeCloseTo(0.55, 5); // 0.45 + 0.1
    expect(m.get("c1")!.y).toBeCloseTo(0.25, 5); // y untouched
  });

  it("applies w/h/rot to the group box only, leaving descendant sizes untouched", () => {
    const s = groupScene();
    s.beats[0].timeline = [{ kind: "obj_move", target: "g", to: { w: 0.8, rot: 90 } }];
    const m = objectStateAt(s, 0, 0.8);
    expect(m.get("g")!.w).toBeCloseTo(0.8, 5);
    expect(m.get("g")!.rot).toBeCloseTo(90, 5);
    expect(m.get("c1")!.w).toBeCloseTo(0.1, 5); // child size unchanged
    expect(m.get("c1")!.rot).toBeCloseTo(0, 5);
  });

  it("moving a leaf leaves its siblings untouched", () => {
    const s = groupScene();
    s.beats[0].timeline = [{ kind: "obj_move", target: "c1", to: { x: 0.9 } }];
    const m = objectStateAt(s, 0, 0.8);
    expect(m.get("c1")!.x).toBeCloseTo(0.9, 5);
    expect(m.get("c2")!.x).toBeCloseTo(0.45, 5);
    expect(m.get("g")!.x).toBeCloseTo(0.2, 5);
  });
});
