// @vitest-environment jsdom
// Camera moves, Task 3 (spec §3): world layers take a camera transform; text stays fixed.
// ArtStage's art layers live in `.artstage__world` (the glow stays on the fixed root); media tiles
// live in CinematicSlide's `.cin__world` beneath the text stage; BeatStage wraps NoteField and
// ObjectStage in `.beat__world`. Each layer paints the framing at its own paint time.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { CinematicSlide, type CinematicRuntime, type SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import { BeatStage } from "@/engine/authoring/BeatStage";
import { cameraTransform, FULL_FRAME, type CameraEvent } from "@/engine/authoring/camera-clock";
import type { ArtLayerState } from "@/engine/authoring/art-clock";
import type { Beat, Framing, Scene } from "@/engine/deck/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const noopRuntime: CinematicRuntime = {
  art: () => {}, applyArt: () => {}, setNightlight: () => {}, arrows: () => {}, pulse: () => {},
  resolveEntry: () => [], resolveEnd: () => [], onGate: () => {}, onWaiting: () => {},
} as unknown as CinematicRuntime;

/** Attribute writes on `el` since the observer started (synchronous, via takeRecords). */
function watchStyle(el: HTMLElement) {
  const mo = new MutationObserver(() => {});
  mo.observe(el, { attributes: true, attributeFilter: ["style"] });
  return { count: () => mo.takeRecords().length, stop: () => mo.disconnect() };
}

const isFull = (s: string) => s === "none" || s === "";

describe("ArtStage world", () => {
  function setup() {
    const ref = createRef<ArtStageHandle>();
    const { container } = render(<ArtStage ref={ref} nightlight={0} reduced={false} />);
    const root = container.querySelector<HTMLElement>(".artstage")!;
    const world = root.querySelector<HTMLElement>(":scope > .artstage__world")!;
    return { ref, root, world };
  }
  const layers: ArtLayerState[] = [
    { asset: "1.01", opacity: 1, scale: 1, z: 1, overlay: false, since: 0 },
    { asset: "media:a.mp4", opacity: 1, scale: 1, z: 2, overlay: false, since: 0 },
  ];

  it("art layers (img and video) live in .artstage > .artstage__world; the glow is a direct child of the root", () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    const { ref, root, world } = setup();
    expect(world).not.toBeNull();
    ref.current!.renderState(layers, 0);
    const els = Array.from(root.querySelectorAll<HTMLElement>(".artstage__layer"));
    expect(els.map((e) => e.tagName)).toEqual(["IMG", "VIDEO"]);
    for (const el of els) expect(el.parentElement).toBe(world);
    const glow = root.querySelector<HTMLElement>(".artstage__glow")!;
    expect(glow.parentElement).toBe(root);
    expect(world.contains(glow)).toBe(false);
  });

  it("with no camera the world carries no transform", () => {
    const { ref, world } = setup();
    ref.current!.renderState(layers.slice(0, 1), 0);
    expect(isFull(world.style.transform)).toBe(true);
    expect(world.style.transformOrigin).toBe("0 0");
  });

  it("setCamera writes the world's transform (origin 0 0), and only when it changes", () => {
    const { ref, world } = setup();
    ref.current!.setCamera("translate(0%, -100%) scale(2)");
    expect(world.style.transform).toBe("translate(0%, -100%) scale(2)");
    expect(world.style.transformOrigin).toBe("0 0");
    const w = watchStyle(world);
    ref.current!.setCamera("translate(0%, -100%) scale(2)");
    expect(w.count()).toBe(0);
    ref.current!.setCamera("none");
    expect(w.count()).toBe(1);
    expect(isFull(world.style.transform)).toBe(true);
    w.stop();
  });

  it("renderState and show still reconcile layers inside the world", () => {
    const { ref, root, world } = setup();
    ref.current!.renderState([layers[0]], 0);
    expect(world.querySelectorAll(".artstage__layer")).toHaveLength(1);
    ref.current!.show(["2.01", "3.01"], "cut");
    const els = Array.from(root.querySelectorAll<HTMLElement>(".artstage__layer"));
    expect(els.map((e) => e.dataset.asset)).toEqual(["2.01", "3.01"]);
    for (const el of els) expect(el.parentElement).toBe(world);
    ref.current!.renderState([{ ...layers[0], asset: "3.01" }], 0);
    expect(Array.from(world.querySelectorAll<HTMLElement>(".artstage__layer")).map((e) => e.dataset.asset)).toEqual(["3.01"]);
  });
});

const tileBeat: Beat = { id: "tiles", timeline: [
  { kind: "text", value: "Fixed words", in: "fade" },
  { kind: "media", id: "m", pos: { x: 0.3, y: 0.4 }, label: "tile" },
  { kind: "wait", ms: 1000 },
] };

describe("CinematicSlide world", () => {
  function mount(props: Partial<React.ComponentProps<typeof CinematicSlide>> = {}) {
    const transport = createRef<SlideTransport>();
    const { container } = render(
      <CinematicSlide slots={{ sceneId: "s", beat: tileBeat }} animate runtime={noopRuntime} transport={transport} autoplay={false} {...props} />,
    );
    const cin = container.querySelector<HTMLElement>(".cin")!;
    return { transport, cin, world: cin.querySelector<HTMLElement>(".cin__world")!, stage: cin.querySelector<HTMLElement>(".cin__stage")! };
  }

  it("media tiles are appended to .cin__world; text stays in .cin__stage; the world sits beneath the stage", () => {
    const { transport, cin, world, stage } = mount();
    transport.current!.seek(1.2);
    const tile = cin.querySelector<HTMLElement>(".cin__media")!;
    expect(tile.parentElement).toBe(world);
    expect(stage.contains(tile)).toBe(false);
    expect(stage.textContent).toContain("Fixed words");
    expect(world.textContent).not.toContain("Fixed words");
    // DOM order: world before stage; and a lower z-index, so text paints above tiles.
    expect(world.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cin.firstElementChild).toBe(world);
    const z = (el: Element) => Number(getComputedStyle(el).zIndex);
    expect(z(world)).toBeLessThan(z(stage));
    expect(getComputedStyle(world).pointerEvents).toBe("none");
  });

  it("with no camera, the world carries no transform", () => {
    const { transport, world } = mount();
    transport.current!.seek(0.5);
    expect(isFull(world.style.transform)).toBe(true);
  });

  it("a cameraRef is read at paint time: seek paints cameraTransform(current) on .cin__world", () => {
    const cameraRef = { current: { x: 0.25, y: 0.75, zoom: 2 } } as React.RefObject<Framing>;
    const { transport, world, stage } = mount({ cameraRef });
    transport.current!.seek(0.5);
    expect(world.style.transform).toBe(cameraTransform({ x: 0.25, y: 0.75, zoom: 2 }));
    expect(isFull(stage.style.transform)).toBe(true); // the text layer never moves
    cameraRef.current = FULL_FRAME;
    transport.current!.seek(0.6);
    expect(isFull(world.style.transform)).toBe(true);
  });

  it("an unchanged framing causes no write", () => {
    const cameraRef = { current: { x: 0.25, y: 0.75, zoom: 2 } } as React.RefObject<Framing>;
    const { transport, world } = mount({ cameraRef });
    transport.current!.seek(0.5);
    const w = watchStyle(world);
    transport.current!.seek(0.7);
    expect(w.count()).toBe(0);
    w.stop();
  });
});

const scene: Scene = { id: "s", beats: [tileBeat] };

describe("BeatStage world", () => {
  it("wraps NoteField and ObjectStage in .beat__world; stacking vs the text wrapper is unchanged", () => {
    const { container } = render(<BeatStage sceneId="s" beat={tileBeat} scene={scene} autoplay={false} contained />);
    const world = container.querySelector<HTMLElement>(".beat__world")!;
    const notes = container.querySelector<HTMLElement>(".notefield")!;
    const objs = container.querySelector<HTMLElement>(".ed__objstage")!;
    expect(notes.parentElement).toBe(world);
    expect(objs.parentElement).toBe(world);
    expect(notes.compareDocumentPosition(objs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // mount order kept
    const cinWrapper = container.querySelector<HTMLElement>(".cin")!.parentElement!;
    expect(world.compareDocumentPosition(cinWrapper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(notes).zIndex).toBe("2");
    expect(getComputedStyle(objs).zIndex).toBe("6");
    expect(cinWrapper.style.zIndex).toBe("");
    expect(world.style.zIndex).toBe("");
    expect(getComputedStyle(container.querySelector(".cin__stage")!).zIndex).toBe("2");
    expect(world.style.transformOrigin).toBe("0 0");
    expect(world.style.pointerEvents).toBe("none");
  });

  it("the wrapper's transform follows cameraRef on each onTime (and the text never moves)", () => {
    const transport = createRef<SlideTransport>();
    const cameraRef = { current: FULL_FRAME } as React.RefObject<Framing>;
    const { container } = render(<BeatStage sceneId="s" beat={tileBeat} scene={scene} autoplay={false} transport={transport} cameraRef={cameraRef} contained />);
    const world = container.querySelector<HTMLElement>(".beat__world")!;
    transport.current!.seek(0.2);
    expect(isFull(world.style.transform)).toBe(true);
    cameraRef.current = { x: 0.25, y: 0.75, zoom: 2 };
    transport.current!.seek(0.4);
    expect(world.style.transform).toBe(cameraTransform({ x: 0.25, y: 0.75, zoom: 2 }));
    expect(container.querySelector<HTMLElement>(".cin__world")!.style.transform).toBe(cameraTransform({ x: 0.25, y: 0.75, zoom: 2 }));
    expect(isFull(container.querySelector<HTMLElement>(".cin__stage")!.style.transform)).toBe(true);
  });

  it("with no camera, every world transform is none or empty", () => {
    const transport = createRef<SlideTransport>();
    const { container } = render(<BeatStage sceneId="s" beat={tileBeat} scene={scene} autoplay={false} transport={transport} contained />);
    transport.current!.seek(0.8);
    for (const sel of [".beat__world", ".cin__world", ".artstage__world"]) {
      expect(isFull(container.querySelector<HTMLElement>(sel)!.style.transform)).toBe(true);
    }
  });

  it("autoplay with a camera prop paints the framing at beatStart + t", async () => {
    const events: CameraEvent[] = [{ start: 0, duration: 0, to: { zoom: 2 }, ease: "linear" }];
    const { container } = render(<BeatStage sceneId="s" beat={tileBeat} scene={scene} camera={{ events, beatStart: 0 }} contained />);
    await waitFor(() => {
      expect(container.querySelector<HTMLElement>(".cin__world")!.style.transform).toContain("scale(2)");
      expect(container.querySelector<HTMLElement>(".beat__world")!.style.transform).toContain("scale(2)");
    });
  });
});
