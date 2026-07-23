import { describe, it, expect, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import gsap from "gsap";
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // CinematicSlide (rendered inside BeatStage) creates its own `gsap.timeline({...})` for the
  // 2D slide beat, always with a config object. BeatStage's object-stage proxy tween is the only
  // call made with zero arguments (`gsap.timeline().to(proxy, {...})`), so filtering on call
  // arity isolates it without touching BeatStage.tsx.
  function beatStageTimelineCalls(spy: { mock: { calls: unknown[][]; results: { value: unknown }[] } }) {
    return spy.mock.calls
      .map((args, i) => ({ args, result: spy.mock.results[i]!.value as gsap.core.Timeline }))
      .filter(({ args }) => args.length === 0);
  }

  it("creates exactly one proxy tween per render when animate=true, and its onUpdate genuinely drives renderAt", () => {
    const timelineSpy = vi.spyOn(gsap, "timeline");
    const { container } = render(
      <BeatStage sceneId="s1" beat={scene.beats[0]} scene={scene} beatIndex={0} animate />,
    );

    // Exactly one proxy tween created for this render, regardless of object count.
    const calls = beatStageTimelineCalls(timelineSpy);
    expect(calls).toHaveLength(1);
    const tl = calls[0]!.result;

    const node = container.querySelector('[data-testid="object-stage"] [data-obj-id="a"]') as HTMLElement;

    // Before the tween has advanced, the object is still in its initial (gated/hidden) DOM state.
    expect(node.style.display).toBe("none");

    // Fast-forward the real tween synchronously and confirm onUpdate is actually wired to
    // ObjectStage.renderAt (opacity tracks progress through the beat's obj_reveal action).
    tl.progress(0.5);
    expect(node.style.display).toBe("block");
    expect(node.style.opacity).toBe("0.5");

    tl.progress(1);
    expect(node.style.opacity).toBe("1");

    tl.kill();
  });

  it("kills the tween on unmount", () => {
    const timelineSpy = vi.spyOn(gsap, "timeline");
    const { unmount } = render(
      <BeatStage sceneId="s1" beat={scene.beats[0]} scene={scene} beatIndex={0} animate />,
    );

    const calls = beatStageTimelineCalls(timelineSpy);
    expect(calls).toHaveLength(1);
    const tl = calls[0]!.result;
    const killSpy = vi.spyOn(tl, "kill");

    unmount();

    expect(killSpy).toHaveBeenCalledTimes(1);
  });

  it("kills the previous tween when beat/scene deps change on rerender, before creating the next one", () => {
    const timelineSpy = vi.spyOn(gsap, "timeline");
    const { rerender } = render(
      <BeatStage sceneId="s1" beat={scene.beats[0]} scene={scene} beatIndex={0} animate />,
    );

    const firstCalls = beatStageTimelineCalls(timelineSpy);
    expect(firstCalls).toHaveLength(1);
    const tl1 = firstCalls[0]!.result;
    const kill1 = vi.spyOn(tl1, "kill");

    const beat2 = { id: "b1", timeline: [{ kind: "obj_reveal", target: "a" }] } as Scene["beats"][number];
    rerender(<BeatStage sceneId="s1" beat={beat2} scene={scene} beatIndex={0} animate />);

    expect(kill1).toHaveBeenCalledTimes(1);
    expect(beatStageTimelineCalls(timelineSpy)).toHaveLength(2);
  });
});
