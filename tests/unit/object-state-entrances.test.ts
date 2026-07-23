import { describe, it, expect } from "vitest";
import { objectStateAt, FLY_DY, SIDE_DX, POP_FROM } from "@/lib/editor/object-state";
import type { Scene, SceneObject, MediaIn } from "@/engine/deck/types";

const obj = (id: string): SceneObject =>
  ({ id, kind: "shape", shape: "rect", transform: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 } } as SceneObject);
const revealScene = (inKind: MediaIn): Scene =>
  ({ id: "s1", objects: [obj("a")], beats: [{ id: "b0", timeline: [{ kind: "obj_reveal", target: "a", in: inKind }] }] });

describe("objectStateAt — entrance variants", () => {
  it("flyUp offsets y by (1-p)*FLY_DY and settles at p=1", () => {
    expect(objectStateAt(revealScene("flyUp"), 0, 0).get("a")!.y).toBeCloseTo(0.2 + FLY_DY, 5);
    expect(objectStateAt(revealScene("flyUp"), 0, 0.6).get("a")!.y).toBeCloseTo(0.2, 5);
  });
  it("fadeSide offsets x by (1-p)*SIDE_DX and settles at p=1", () => {
    expect(objectStateAt(revealScene("fadeSide"), 0, 0).get("a")!.x).toBeCloseTo(0.2 + SIDE_DX, 5);
    expect(objectStateAt(revealScene("fadeSide"), 0, 0.7).get("a")!.x).toBeCloseTo(0.2, 5);
  });
  it("pop scales from POP_FROM to 1", () => {
    expect(objectStateAt(revealScene("pop"), 0, 0).get("a")!.scale).toBeCloseTo(POP_FROM, 5);
    expect(objectStateAt(revealScene("pop"), 0, 0.6).get("a")!.scale).toBeCloseTo(1, 5);
  });
  it("fade leaves x/y/scale unchanged", () => {
    const st = objectStateAt(revealScene("fade"), 0, 0).get("a")!;
    expect(st).toMatchObject({ x: 0.2, y: 0.2, scale: 1 });
  });
});
