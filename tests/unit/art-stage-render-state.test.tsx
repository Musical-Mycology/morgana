// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRef } from "react";
import { render, cleanup } from "@testing-library/react";
import gsap from "gsap";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import type { ArtLayerState } from "@/engine/authoring/art-clock";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup() {
  const ref = createRef<ArtStageHandle>();
  const { container } = render(<ArtStage ref={ref} nightlight={0} reduced={false} />);
  const root = container.querySelector<HTMLElement>(".artstage")!;
  const layers = () => Array.from(root.querySelectorAll<HTMLImageElement>(".artstage__layer"));
  return { ref, root, layers };
}

const two: ArtLayerState[] = [
  { asset: "1.01", opacity: 0.4, scale: 1, z: 1, overlay: false },
  { asset: "MusicScore", opacity: 0.8, scale: 0.95, z: 2, overlay: true },
];

describe("ArtStage.renderState", () => {
  it("paints exactly the given layers in array order with opacity/scale/z", () => {
    const { ref, layers } = setup();
    ref.current!.renderState(two, 1);
    const els = layers();
    expect(els.map((e) => e.dataset.asset)).toEqual(["1.01", "MusicScore"]);
    expect(els.map((e) => e.style.opacity)).toEqual(["0.4", "0.8"]);
    expect(els.map((e) => e.style.zIndex)).toEqual(["1", "2"]);
    expect(els[0].style.transform).toBe("none");
    expect(els[1].style.transform).toBe("scale(0.95)");
    expect(els[1].style.mixBlendMode).toBe("screen");
    expect(els[1].dataset.overlay).toBe("1");
  });

  it("reuses matching elements and removes layers no longer present", () => {
    const { ref, layers } = setup();
    ref.current!.renderState(two, 1);
    const first = layers()[0];
    ref.current!.renderState([{ asset: "1.01", opacity: 1, scale: 1, z: 1, overlay: false }], 1);
    const els = layers();
    expect(els).toHaveLength(1);
    expect(els[0]).toBe(first);
    expect(els[0].style.opacity).toBe("1");
  });

  it("z is authoritative for stacking while DOM order follows the array", () => {
    const { ref, layers } = setup();
    ref.current!.renderState([
      { asset: "1.01", opacity: 0.5, scale: 1, z: 3, overlay: false },
      { asset: "1.02", opacity: 1, scale: 1, z: 1, overlay: false },
    ], 0);
    expect(layers().map((e) => [e.dataset.asset, e.style.zIndex])).toEqual([["1.01", "3"], ["1.02", "1"]]);
  });

  it("applies night to the glow (no transition) and the root filter", () => {
    const { ref, root } = setup();
    ref.current!.renderState([], 0.5);
    const glow = root.querySelector<HTMLElement>(".artstage__glow")!;
    expect(glow.style.transition).toBe("none");
    expect(parseFloat(glow.style.opacity)).toBeCloseTo(0.15 + 0.45 * 0.5, 6);
    expect(root.style.filter).toBe(`saturate(${0.85 + 0.3 * 0.5}) brightness(${0.9 + 0.15 * 0.5})`);
    ref.current!.renderState([], 3); // clamps at 1
    expect(parseFloat(glow.style.opacity)).toBeCloseTo(0.6, 6);
  });

  it("creates no GSAP tweens", () => {
    const to = vi.spyOn(gsap, "to");
    const fromTo = vi.spyOn(gsap, "fromTo");
    const { ref } = setup();
    ref.current!.renderState(two, 1);
    ref.current!.renderState([], 0);
    expect(to).not.toHaveBeenCalled();
    expect(fromTo).not.toHaveBeenCalled();
  });
});
