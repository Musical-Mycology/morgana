import { describe, it, expect } from "vitest";
import { objectStateAt } from "@/lib/editor/object-state";
import type { Scene, SceneObject, Action } from "@/engine/deck/types";

const obj = (id: string, over: Partial<SceneObject> = {}): SceneObject =>
  ({ id, kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, ...over } as SceneObject);
const scene = (objects: SceneObject[], tl: Action[]): Scene => ({ id: "s1", objects, beats: [{ id: "b0", timeline: tl }] });

describe("objectStateAt — current beat leaf verbs", () => {
  it("obj_reveal fades opacity 0→1 across its window and is visible once started", () => {
    const s = scene([obj("a")], [{ kind: "obj_reveal", target: "a" }]); // default 600ms → [0,0.6)
    expect(objectStateAt(s, 0, 0).get("a")!.opacity).toBeCloseTo(0, 5);
    expect(objectStateAt(s, 0, 0).get("a")!.visible).toBe(true);
    expect(objectStateAt(s, 0, 0.3).get("a")!.opacity).toBeCloseTo(0.5, 2);
    expect(objectStateAt(s, 0, 0.6).get("a")!.opacity).toBeCloseTo(1, 5);
  });

  it("obj_move interpolates present axes from current→to, holding absent axes", () => {
    const s = scene([obj("a")], [{ kind: "obj_move", target: "a", to: { x: 0.5 } }]); // 800ms → [0,0.8)
    expect(objectStateAt(s, 0, 0).get("a")!).toMatchObject({ x: 0.1, y: 0.1 });
    expect(objectStateAt(s, 0, 0.4).get("a")!.x).toBeCloseTo(0.3, 2);
    expect(objectStateAt(s, 0, 0.8).get("a")!).toMatchObject({ x: 0.5, y: 0.1 });
  });

  it("obj_out fades to opacity 0 and visible=false at end", () => {
    const s = scene([obj("a")], [{ kind: "obj_out", target: "a" }]); // 500ms → [0,0.5)
    expect(objectStateAt(s, 0, 0.25).get("a")!.opacity).toBeCloseTo(0.5, 2);
    const end = objectStateAt(s, 0, 0.5).get("a")!;
    expect(end.opacity).toBeCloseTo(0, 5);
    expect(end.visible).toBe(false);
  });

  it("an action whose window has not started yet does not apply", () => {
    const s = scene([obj("a")], [{ kind: "wait", ms: 1000 }, { kind: "obj_move", target: "a", to: { x: 0.9 } }]);
    expect(objectStateAt(s, 0, 0.5).get("a")!.x).toBeCloseTo(0.1, 5); // still before the move window (starts at 1.0)
  });
});
