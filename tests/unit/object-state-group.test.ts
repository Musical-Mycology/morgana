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

describe("objectStateAt — group obj_reveal/obj_out cascade", () => {
  it("obj_reveal on a group makes all descendants visible and fades them in (group itself paints nothing)", () => {
    const s = groupScene();
    s.beats[0].timeline = [{ kind: "obj_reveal", target: "g", in: "fade" }]; // 600ms default
    // Gated: descendants of "g" aren't independently targeted by obj_reveal, so revealedObjectIds
    // only gates "g" itself — c1/c2 seed as visible=true from t=0 regardless. Assert mid-progress
    // opacity/visible cascade onto the descendants explicitly.
    const mid = objectStateAt(s, 0, 0.3); // p=0.5
    expect(mid.get("g")!.visible).toBe(true);
    expect(mid.get("g")!.opacity).toBeCloseTo(0.5, 5);
    expect(mid.get("c1")!.visible).toBe(true);
    expect(mid.get("c1")!.opacity).toBeCloseTo(0.5, 5);
    expect(mid.get("c2")!.visible).toBe(true);
    expect(mid.get("c2")!.opacity).toBeCloseTo(0.5, 5);

    const end = objectStateAt(s, 0, 0.6); // p=1
    expect(end.get("c1")!.opacity).toBeCloseTo(1, 5);
    expect(end.get("c2")!.opacity).toBeCloseTo(1, 5);
  });

  it("obj_out on a group fades all descendants out and hides them at p=1", () => {
    const s = groupScene();
    s.beats[0].timeline = [{ kind: "obj_out", target: "g" }]; // 500ms default
    const mid = objectStateAt(s, 0, 0.25); // p=0.5
    expect(mid.get("g")!.opacity).toBeCloseTo(0.5, 5);
    expect(mid.get("c1")!.opacity).toBeCloseTo(0.5, 5);
    expect(mid.get("c2")!.opacity).toBeCloseTo(0.5, 5);
    expect(mid.get("c1")!.visible).toBe(true); // still visible mid-fade

    const end = objectStateAt(s, 0, 0.5); // p=1
    expect(end.get("g")!.visible).toBe(false);
    expect(end.get("c1")!.visible).toBe(false);
    expect(end.get("c1")!.opacity).toBeCloseTo(0, 5);
    expect(end.get("c2")!.visible).toBe(false);
    expect(end.get("c2")!.opacity).toBeCloseTo(0, 5);
  });

  it("obj_reveal on a leaf continues to leave siblings/parent untouched (no regression)", () => {
    const s = groupScene();
    s.beats[0].timeline = [{ kind: "obj_reveal", target: "c1", in: "fade" }];
    const mid = objectStateAt(s, 0, 0.3); // p=0.5
    expect(mid.get("c1")!.opacity).toBeCloseTo(0.5, 5);
    expect(mid.get("c2")!.opacity).toBeCloseTo(1, 5); // untouched, seeded default opacity
    expect(mid.get("g")!.opacity).toBeCloseTo(1, 5); // untouched
  });

  it("obj_out on a leaf continues to leave siblings/parent untouched (no regression)", () => {
    const s = groupScene();
    s.beats[0].timeline = [{ kind: "obj_out", target: "c1" }];
    const end = objectStateAt(s, 0, 0.5); // p=1
    expect(end.get("c1")!.visible).toBe(false);
    expect(end.get("c2")!.visible).toBe(true);
    expect(end.get("g")!.visible).toBe(true);
  });
});
