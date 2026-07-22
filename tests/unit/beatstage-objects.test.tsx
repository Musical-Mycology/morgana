import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { Scene } from "@/engine/deck/types";

const scene: Scene = {
  id: "s1",
  objects: [{ id: "a", kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }],
  beats: [{ id: "b0", timeline: [{ kind: "obj_reveal", target: "a" }] }],
};

describe("BeatStage object rendering", () => {
  it("renders the object stage and paints the object at settled end-state when animate=false", () => {
    const { container } = render(<BeatStage sceneId="s1" beat={scene.beats[0]} scene={scene} beatIndex={0} animate={false} />);
    const node = container.querySelector('[data-testid="object-stage"] [data-obj-id="a"]') as HTMLElement;
    expect(node).toBeTruthy();
    expect(node.style.display).toBe("block"); // gated but settled (p=1) → visible
    expect(node.style.opacity).toBe("1");
  });

  it("renders nothing extra when no scene prop is passed (back-compat)", () => {
    const { container } = render(<BeatStage sceneId="s1" beat={scene.beats[0]} />);
    expect(container.querySelector('[data-testid="object-stage"]')).toBeNull();
  });
});
