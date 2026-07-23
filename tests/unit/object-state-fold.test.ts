import { describe, it, expect } from "vitest";
import { objectStateAt } from "@/lib/editor/object-state";
import type { Scene, SceneObject, Action } from "@/engine/deck/types";

const obj = (id: string): SceneObject =>
  ({ id, kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } } as SceneObject);
const scn = (objects: SceneObject[], beats: Action[][]): Scene =>
  ({ id: "s1", objects, beats: beats.map((tl, i) => ({ id: `b${i}`, timeline: tl })) });

describe("objectStateAt — fold prior beats", () => {
  it("an object revealed in beat 0 is visible (settled) when viewing beat 1 at t=0", () => {
    const s = scn([obj("a")], [[{ kind: "obj_reveal", target: "a" }], []]);
    const st = objectStateAt(s, 1, 0).get("a")!;
    expect(st.visible).toBe(true);
    expect(st.opacity).toBeCloseTo(1, 5);
  });

  it("a gated object is still hidden when viewing an earlier beat than its reveal", () => {
    const s = scn([obj("a")], [[], [{ kind: "obj_reveal", target: "a" }]]);
    expect(objectStateAt(s, 0, 0).get("a")!.visible).toBe(false);
  });

  it("obj_out in a prior beat leaves the object hidden in a later beat", () => {
    const s = scn([obj("a")], [[{ kind: "obj_reveal", target: "a" }], [{ kind: "obj_out", target: "a" }], []]);
    expect(objectStateAt(s, 2, 0).get("a")!.visible).toBe(false);
  });

  it("re-reveal after out makes it visible again", () => {
    const s = scn([obj("a")], [[{ kind: "obj_out", target: "a" }], [{ kind: "obj_reveal", target: "a" }]]);
    // note: 'a' is gated (an obj_reveal targets it), so it starts hidden; out in b0 keeps hidden; reveal in b1 shows it
    expect(objectStateAt(s, 1, 0.6).get("a")!.visible).toBe(true);
  });

  it("obj_move in a prior beat persists as the entry snapshot for the next beat", () => {
    const s = scn([obj("a")], [[{ kind: "obj_move", target: "a", to: { x: 0.8 } }], []]);
    expect(objectStateAt(s, 1, 0).get("a")!.x).toBeCloseTo(0.8, 5);
  });

  it("is pure — identical inputs give an equal map", () => {
    const s = scn([obj("a")], [[{ kind: "obj_move", target: "a", to: { x: 0.5 } }]]);
    expect(objectStateAt(s, 0, 0.4).get("a")).toEqual(objectStateAt(s, 0, 0.4).get("a"));
  });

  it("handles tLocal past the last window (clamps at settled state)", () => {
    const s = scn([obj("a")], [[{ kind: "obj_reveal", target: "a" }]]);
    expect(objectStateAt(s, 0, 999).get("a")!.opacity).toBeCloseTo(1, 5);
  });
});
