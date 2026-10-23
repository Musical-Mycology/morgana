// @vitest-environment jsdom
// Camera moves, Task 3 (spec §3): world layers take a camera transform; text stays fixed.
// ArtStage's art layers live in `.artstage__world` (the glow stays on the fixed root); media tiles
// live in CinematicSlide's `.cin__world`, after the text stage at the same z-index (tiles keep their
// pre-camera stacking: above notes and the shared text box); BeatStage wraps NoteField and
// ObjectStage in one `.beat__world` each, carrying the child's old z-index (2 and 6), so stacking is
// the same with or without a camera transform. Each layer paints the framing at its own paint time.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createRef, forwardRef, useImperativeHandle } from "react";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { CinematicSlide, type CinematicRuntime, type SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import { BeatStage } from "@/engine/authoring/BeatStage";
import { cameraTransform, FULL_FRAME, type CameraEvent } from "@/engine/authoring/camera-clock";
import type { ArtLayerState } from "@/engine/authoring/art-clock";
import type { Beat, Framing, Scene } from "@/engine/deck/types";
import { useDeckStage, type DeckStageHandle } from "@/components/player/DeckStage";
import type { DeckDoc } from "@/engine/deck-doc";

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

  it("media tiles are appended to .cin__world; text stays in .cin__stage; the world keeps the pre-camera stacking", () => {
    const { transport, cin, world, stage } = mount();
    transport.current!.seek(1.2);
    const tile = cin.querySelector<HTMLElement>(".cin__media")!;
    expect(tile.parentElement).toBe(world);
    expect(stage.contains(tile)).toBe(false);
    expect(stage.textContent).toContain("Fixed words");
    expect(world.textContent).not.toContain("Fixed words");
    // Pre-camera stacking (tiles were appended into the z-2 stage after the text box): the world
    // follows the stage in DOM order at the same z-index, so tiles paint above the shared text box.
    expect(stage.compareDocumentPosition(world) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stage.nextElementSibling).toBe(world);
    const z = (el: Element) => getComputedStyle(el).zIndex;
    expect(z(world)).toBe("2");
    expect(z(stage)).toBe("2");
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
  /** Each layer as it participates in the BeatStage root's stacking context: [z-index, tree order].
   *  A world wrapper carries its own z-index, so its stacking context sits exactly where the
   *  child's z used to, whether or not a transform is active. */
  function stacking(container: HTMLElement) {
    const root = container.querySelector<HTMLElement>("[data-testid=beatstage]")!;
    const notesW = container.querySelector<HTMLElement>(".notefield")!.parentElement!;
    const objsW = container.querySelector<HTMLElement>(".ed__objstage")!.parentElement!;
    const cinWrapper = container.querySelector<HTMLElement>(".cin")!.parentElement!;
    const kids = Array.from(root.children);
    const at = (el: Element) => kids.indexOf(el);
    return { root, notesW, objsW, cinWrapper, at, z: (el: Element) => getComputedStyle(el).zIndex };
  }
  function expectPreCameraStacking(container: HTMLElement) {
    const { notesW, objsW, cinWrapper, at, z } = stacking(container);
    // Mount order kept (notes, objects, then the CinematicSlide wrapper): see BeatStage's comment.
    expect(at(notesW)).toBeGreaterThanOrEqual(0);
    expect(at(notesW)).toBeLessThan(at(objsW));
    expect(at(objsW)).toBeLessThan(at(cinWrapper));
    expect(z(notesW)).toBe("2");
    expect(z(objsW)).toBe("6");
    expect(z(container.querySelector(".notefield")!)).toBe("2");
    expect(z(container.querySelector(".ed__objstage")!)).toBe("6");
    // The CinematicSlide wrapper is unchanged (no z, no stacking context): its stage and world
    // stack at z 2 in the root context — above notes (z 2, earlier in tree order), below objects (6).
    expect(cinWrapper.style.zIndex).toBe("");
    expect(isFull(cinWrapper.style.transform)).toBe(true);
    expect(z(container.querySelector(".cin__stage")!)).toBe("2");
    expect(z(container.querySelector(".cin__world")!)).toBe("2");
  }

  it("wraps NoteField and ObjectStage in one .beat__world each, carrying their z (2 and 6)", () => {
    const { container } = render(<BeatStage sceneId="s" beat={tileBeat} scene={scene} autoplay={false} contained />);
    const worlds = Array.from(container.querySelectorAll<HTMLElement>(".beat__world"));
    expect(worlds).toHaveLength(2);
    const { notesW, objsW } = stacking(container);
    expect(worlds).toEqual([notesW, objsW]);
    for (const w of worlds) {
      expect(w.style.transformOrigin).toBe("0 0");
      expect(w.style.pointerEvents).toBe("none");
    }
    expectPreCameraStacking(container);
  });

  it("stacking relative to the text wrapper holds with an active camera too", () => {
    const transport = createRef<SlideTransport>();
    const cameraRef = { current: { x: 0.25, y: 0.75, zoom: 2 } } as React.RefObject<Framing>;
    const { container } = render(<BeatStage sceneId="s" beat={tileBeat} scene={scene} autoplay={false} transport={transport} cameraRef={cameraRef} contained />);
    transport.current!.seek(0.4);
    for (const w of container.querySelectorAll<HTMLElement>(".beat__world")) expect(w.style.transform).toBe(cameraTransform(cameraRef.current));
    expectPreCameraStacking(container);
  });

  it("the wrappers' transform follows cameraRef on each onTime (and the text never moves)", () => {
    const transport = createRef<SlideTransport>();
    const cameraRef = { current: FULL_FRAME } as React.RefObject<Framing>;
    const { container } = render(<BeatStage sceneId="s" beat={tileBeat} scene={scene} autoplay={false} transport={transport} cameraRef={cameraRef} contained />);
    const worlds = Array.from(container.querySelectorAll<HTMLElement>(".beat__world"));
    transport.current!.seek(0.2);
    for (const w of worlds) expect(isFull(w.style.transform)).toBe(true);
    cameraRef.current = { x: 0.25, y: 0.75, zoom: 2 };
    transport.current!.seek(0.4);
    for (const w of worlds) expect(w.style.transform).toBe(cameraTransform({ x: 0.25, y: 0.75, zoom: 2 }));
    expect(container.querySelector<HTMLElement>(".cin__world")!.style.transform).toBe(cameraTransform({ x: 0.25, y: 0.75, zoom: 2 }));
    expect(isFull(container.querySelector<HTMLElement>(".cin__stage")!.style.transform)).toBe(true);
  });

  it("with no camera, every world transform is none or empty", () => {
    const transport = createRef<SlideTransport>();
    const { container } = render(<BeatStage sceneId="s" beat={tileBeat} scene={scene} autoplay={false} transport={transport} contained />);
    transport.current!.seek(0.8);
    for (const sel of [".beat__world", ".cin__world", ".artstage__world"]) {
      const els = container.querySelectorAll<HTMLElement>(sel);
      expect(els.length).toBeGreaterThan(0);
      for (const el of els) expect(isFull(el.style.transform)).toBe(true);
    }
  });

  // A cut to zoom 2 at deck time 3. The beat's own clock starts at 0, so only beatStart decides
  // whether the move has happened: a beat starting at 3 shows zoom 2 from t ≈ 0; one starting at 0
  // never reaches deck time 3 (the beat is ~1-2 s long) and stays at full frame.
  const cutAt3: CameraEvent[] = [{ start: 3, duration: 0, to: { zoom: 2 }, ease: "linear" }];

  it("autoplay with a camera prop paints the framing at beatStart + t (every world, art included)", async () => {
    const { container } = render(<BeatStage sceneId="s" beat={tileBeat} scene={scene} camera={{ events: cutAt3, beatStart: 3 }} contained />);
    await waitFor(() => {
      expect(container.querySelector<HTMLElement>(".cin__world")!.style.transform).toContain("scale(2)");
      for (const w of container.querySelectorAll<HTMLElement>(".beat__world")) expect(w.style.transform).toContain("scale(2)");
      expect(container.querySelector<HTMLElement>(".artstage__world")!.style.transform).toContain("scale(2)");
    });
  });

  it("autoplay: the same events with beatStart 0 stay at full frame (zoom 1)", async () => {
    const { container } = render(<BeatStage sceneId="s" beat={tileBeat} scene={scene} camera={{ events: cutAt3, beatStart: 0 }} contained />);
    // Wait until the slide has painted (its text is in), so "full frame" is a painted state, not a pre-paint one.
    await waitFor(() => expect(container.querySelector(".cin__stage")!.textContent).toContain("Fixed words"));
    for (const sel of [".beat__world", ".cin__world", ".artstage__world"]) {
      for (const el of container.querySelectorAll<HTMLElement>(sel)) expect(isFull(el.style.transform), sel).toBe(true);
    }
  });

  it("an unchanged framing causes no write to either .beat__world wrapper", () => {
    const transport = createRef<SlideTransport>();
    const cameraRef = { current: { x: 0.25, y: 0.75, zoom: 2 } } as React.RefObject<Framing>;
    const { container } = render(<BeatStage sceneId="s" beat={tileBeat} scene={scene} autoplay={false} transport={transport} cameraRef={cameraRef} contained />);
    transport.current!.seek(0.4);
    const worlds = Array.from(container.querySelectorAll<HTMLElement>(".beat__world"));
    expect(worlds).toHaveLength(2);
    for (const w of worlds) expect(w.style.transform).toBe(cameraTransform(cameraRef.current));
    const watches = worlds.map(watchStyle);
    transport.current!.seek(0.6);
    transport.current!.seek(0.8);
    expect(watches.map((w) => w.count())).toEqual([0, 0]);
    watches.forEach((w) => w.stop());
  });
});

describe("DeckStage frame", () => {
  const Host = forwardRef<DeckStageHandle, { doc: DeckDoc }>(function Host({ doc }, ref) {
    const { apply, T, layout, stage } = useDeckStage(doc, 0);
    useImperativeHandle(ref, () => ({ apply, total: layout.total, current: () => T.current }), [apply, layout.total, T]);
    return <div data-testid="host" style={{ position: "relative", width: 1920, height: 1080 }}>{stage}</div>;
  });

  it("the stage wrapper clips, so zoomed world layers never spill outside the frame", () => {
    const doc: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [scene] };
    const { getByTestId } = render(<Host ref={createRef<DeckStageHandle>()} doc={doc} />);
    const wrapper = getByTestId("host").firstElementChild as HTMLElement;
    expect(wrapper.contains(wrapper.querySelector(".artstage"))).toBe(true);
    expect(wrapper.contains(wrapper.querySelector("[data-testid=beatstage]"))).toBe(true);
    expect(wrapper.style.overflow).toBe("hidden");
  });
});
