import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRef } from "react";
import { ObjectStage, type ObjectStageHandle, applyObjectState } from "@/components/editor/ObjectStage";
import type { Scene, SceneObject } from "@/engine/deck/types";

const obj = (id: string): SceneObject =>
  ({ id, kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } } as SceneObject);
const scene: Scene = { id: "s1", objects: [obj("a")], beats: [{ id: "b0", timeline: [{ kind: "obj_reveal", target: "a" }] }] };

describe("ObjectStage", () => {
  it("renders one node per object with data-obj-id", () => {
    const { container } = render(<ObjectStage scene={scene} />);
    expect(container.querySelector('[data-obj-id="a"]')).toBeTruthy();
  });

  it("renderAt applies the reducer state: gated object hidden at t=0", () => {
    const ref = createRef<ObjectStageHandle>();
    const { container } = render(<ObjectStage scene={scene} ref={ref} />);
    ref.current!.renderAt(scene, 0, 0);
    const node = container.querySelector('[data-obj-id="a"]') as HTMLElement;
    expect(node.style.display).toBe("none"); // gated, opacity 0, not yet revealed enough to paint
  });

  it("applyObjectState writes left/top/width/height/opacity and rotate", () => {
    const el = document.createElement("div");
    applyObjectState(el, { x: 0.25, y: 0.5, w: 0.2, h: 0.1, rot: 30, scale: 1, opacity: 0.7, visible: true });
    expect(el.style.left).toBe("25%");
    expect(el.style.top).toBe("50%");
    expect(el.style.width).toBe("20%");
    expect(el.style.opacity).toBe("0.7");
    expect(el.style.transform).toContain("rotate(30deg)");
  });
});
