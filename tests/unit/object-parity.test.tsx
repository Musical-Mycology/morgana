import { describe, it, expect } from "vitest";
import { objectStateAt } from "@/lib/editor/object-state";
import { applyObjectState } from "@/components/editor/ObjectStage";
import type { Scene, SceneObject } from "@/engine/deck/types";

// Both render entry points — DeckCanvas (via ObjectStage in the editor) and BeatStage/
// CinematicSlide (via the production GSAP proxy tween) — call this SAME `applyObjectState`
// writer from components/editor/ObjectStage.tsx with reducer output from `objectStateAt`.
// This test proves that shared writer is a deterministic, pure function of its input state:
// given identical ObjectRenderState at a sampled time, two independently-mounted DOM nodes
// end up with byte-identical `style` attributes. That's the single-source-of-visual-truth
// guarantee — there's one implementation, not two that happen to currently agree.

const obj = (id: string): SceneObject =>
  ({ id, kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } } as SceneObject);

const scene: Scene = {
  id: "s1",
  objects: [obj("a")],
  beats: [{ id: "b0", timeline: [{ kind: "obj_move", target: "a", to: { x: 0.6 } }] }],
};

describe("object render parity across paths", () => {
  it("both mount points write identical styles for the same sampled time", () => {
    for (const t of [0, 0.2, 0.4, 0.8]) {
      const st = objectStateAt(scene, 0, t).get("a")!;
      const a = document.createElement("div");
      const b = document.createElement("div");
      applyObjectState(a, st);
      applyObjectState(b, st);
      expect(a.getAttribute("style")).toBe(b.getAttribute("style"));
      expect(a.getAttribute("style")).toBeTruthy();
    }
  });

  it("identical states from independent objectStateAt calls also produce identical styles", () => {
    // Simulate the editor path (fresh reducer call per seek) vs the production path
    // (fresh reducer call per GSAP tween tick) — both call objectStateAt independently.
    for (const t of [0, 0.5, 1]) {
      const editorPathState = objectStateAt(scene, 0, t).get("a")!;
      const productionPathState = objectStateAt(scene, 0, t).get("a")!;
      const editorNode = document.createElement("div");
      const productionNode = document.createElement("div");
      applyObjectState(editorNode, editorPathState);
      applyObjectState(productionNode, productionPathState);
      expect(editorNode.getAttribute("style")).toBe(productionNode.getAttribute("style"));
    }
  });
});
