import { createRef } from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { SlideTransport } from "@/engine/components/layouts/CinematicSlide";
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

  // Design spec §7b Task 10: the object stage (and NoteField) are painted from CinematicSlide's
  // single time axis — its `onTime` callback, fired at the end of every renderAt — rather than
  // an independent proxy clock of BeatStage's own. `transport.seek(t)` is the production entry
  // point onto that axis (an editor scrubber, or this test): it must synchronously repaint the
  // object stage to exactly `t`, including across a click_gate — nothing here should require
  // advancing gsap's ticker or wall-clock time, because there is only ever one clock now.
  it("paints the object stage from the transport's single clock — including across a click_gate", () => {
    const gatedScene: Scene = {
      id: "s2",
      objects: [{ id: "a", kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }],
      beats: [{
        id: "b0",
        timeline: [
          { kind: "text", value: "hi", in: "fade" },       // [0, 0.8)
          { kind: "click_gate" },                           // @0.8
          { kind: "obj_reveal", target: "a", durationMs: 400 }, // [0.8, 1.2)
        ],
      }],
    };
    const transport = createRef<SlideTransport>();
    const { container } = render(
      <BeatStage sceneId="s2" beat={gatedScene.beats[0]} scene={gatedScene} beatIndex={0} transport={transport} />,
    );
    const node = container.querySelector('[data-testid="object-stage"] [data-obj-id="a"]') as HTMLElement;

    // Before anything is painted, the object is in its initial (gated/hidden) DOM state.
    expect(node.style.display).toBe("none");

    // Seeking to before the gate leaves the object untouched (obj_reveal not reached yet).
    transport.current!.seek(0.5);
    expect(node.style.display).toBe("none");

    // Seeking to just past the gate, mid-reveal: opacity tracks the SAME `t` text painted at.
    transport.current!.seek(1.0);
    expect(node.style.display).toBe("block");
    expect(Number(node.style.opacity)).toBeCloseTo(0.5); // (1.0 - 0.8) / 0.4

    // Seeking to the reveal's settled end.
    transport.current!.seek(1.2);
    expect(Number(node.style.opacity)).toBeCloseTo(1);
  });
});
