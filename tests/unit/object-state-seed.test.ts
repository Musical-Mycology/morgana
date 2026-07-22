import { describe, it, expect } from "vitest";
import { objectStateAt } from "@/lib/editor/object-state";
import type { Scene, SceneObject } from "@/engine/deck/types";

const obj = (id: string, over: Partial<SceneObject> = {}): SceneObject =>
  ({ id, kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, ...over } as SceneObject);

const scene = (objects: SceneObject[], timelines: import("@/engine/deck/types").Action[][]): Scene => ({
  id: "s1", objects, beats: timelines.map((tl, i) => ({ id: `b${i}`, timeline: tl })),
});

describe("objectStateAt — seed & gating at t=0", () => {
  it("seeds a non-gated object visible at its declared transform/opacity", () => {
    const s = scene([obj("a", { opacity: 0.5 })], [[]]);
    const st = objectStateAt(s, 0, 0).get("a")!;
    expect(st).toMatchObject({ x: 0.1, y: 0.2, w: 0.3, h: 0.4, rot: 0, scale: 1, opacity: 0.5, visible: true });
  });

  it("seeds a gated object (targeted by an obj_reveal anywhere) hidden at t=0 before its reveal", () => {
    const s = scene([obj("a")], [[{ kind: "obj_reveal", target: "a" }]]);
    expect(objectStateAt(s, 0, 0).get("a")!.visible).toBe(false);
  });

  it("defaults rot=0, scale=1, opacity=1 when unset", () => {
    const s = scene([obj("a")], [[]]);
    expect(objectStateAt(s, 0, 0).get("a")).toMatchObject({ rot: 0, scale: 1, opacity: 1, visible: true });
  });

  it("includes nested group children in the map", () => {
    const child = obj("kid");
    const grp: SceneObject = { id: "g", kind: "group", transform: { x: 0, y: 0, w: 1, h: 1 }, children: [child] };
    const s = scene([grp], [[]]);
    const m = objectStateAt(s, 0, 0);
    expect(m.has("g")).toBe(true);
    expect(m.has("kid")).toBe(true);
  });
});
