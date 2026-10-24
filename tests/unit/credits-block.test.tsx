import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { CinematicSlide, type CinematicRuntime, type SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import { buildCreditsBlock } from "@/engine/components/credits-block";
import { renderBeatAt } from "@/engine/authoring/seek";
import { textSourceIdx, type TextSource } from "@/engine/components/effects/note-state";
import type { Action, Beat } from "@/engine/deck/types";

const runtime = { art() {}, applyArt() {}, setNightlight() {}, onGate() {}, revealArrows() {}, pulseArrow() {}, onWaiting() {}, resolveEntry: () => [], resolveEnd: () => [], jumpTo() {} } as CinematicRuntime;
const STAGE = { left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON() {} } as DOMRect;
type Credits = Extract<Action, { kind: "credits" }>;
const credits: Credits = { kind: "credits", items: [{ role: "Directed by", names: ["Ann Lee"] }, { names: ["Bo Chen", "Cy Diaz"] }], durationMs: 4000 };
let rollH = 400;
beforeEach(() => {
  rollH = 400;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(STAGE);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("cin__credits-roll") ? rollH : 0; });
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) { return this.classList.contains("cin__credits") ? 200 : 0; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** Calls to `el.style[prop]`'s setter since watching started, same-value writes included (jsdom
 *  queues no MutationObserver record for a same-value write). */
function watchStyle(el: HTMLElement, prop: "transform" | "opacity" | "display") {
  let desc: PropertyDescriptor | undefined;
  for (let p: object | null = el.style; p && !desc; p = Object.getPrototypeOf(p)) desc = Object.getOwnPropertyDescriptor(p, prop);
  if (!desc?.set || !desc.get) throw new Error(`style.${prop} has no accessor descriptor`);
  const { get, set } = desc;
  let n = 0;
  Object.defineProperty(el.style, prop, { set(v: string) { n++; set.call(this, v); }, get() { return get.call(this); }, configurable: true });
  return { count: () => n, stop: () => { delete (el.style as unknown as Record<string, unknown>)[prop]; } };
}

function mount(timeline: Action[], withSources = false) {
  const transport = createRef<SlideTransport>();
  const sources = { current: [] as TextSource[] };
  const beat: Beat = { id: "c", timeline };
  const { container } = render(<CinematicSlide slots={{ sceneId: "s", beat }} animate runtime={runtime} transport={transport} autoplay={false} textSourcesRef={withSources ? sources : undefined} />);
  return { transport, container, sources };
}
const roll = (c: HTMLElement) => c.querySelector<HTMLElement>(".cin__credits-roll");

test("buildCreditsBlock: area box, edge mask, role then name lines with wrapped words, gaps after the first item", () => {
  const { block, lines } = buildCreditsBlock({ ...credits, area: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 } });
  expect([block.style.left, block.style.top, block.style.width, block.style.height]).toEqual(["10%", "20%", "50%", "60%"]);
  expect(block.style.overflow).toBe("hidden");
  expect(lines.map((l) => [l.className, l.textContent])).toEqual([
    ["cin__credits-role", "Directed by"], ["cin__credits-name", "Ann Lee"], ["cin__credits-name", "Bo Chen"], ["cin__credits-name", "Cy Diaz"],
  ]);
  expect(lines[1].querySelectorAll(".cin__mw")).toHaveLength(2);
  const items = block.querySelectorAll<HTMLElement>(".cin__credits-item");
  expect(items[0].style.marginTop).toBe("");
  expect(items[1].style.marginTop).not.toBe("");
  expect(buildCreditsBlock(credits).block.style.left).toBe("20%"); // the default area
});

test("the roll lives in the fixed text stage and scrolls by creditsOffset at beat-local time, either direction", () => {
  const { transport, container } = mount([{ kind: "wait", ms: 1000 }, credits, { kind: "wait", ms: 500 }]);
  act(() => transport.current!.seek(2));                          // local 1 of 4: 200 − 600·0.25
  const block = container.querySelector<HTMLElement>(".cin__credits")!;
  expect(block.closest(".cin__stage")).not.toBeNull();
  expect(block.closest(".cin__world")).toBeNull();
  expect(roll(container)!.style.transform).toBe("translateY(50px)");
  act(() => transport.current!.seek(5));
  expect(roll(container)!.style.transform).toBe("translateY(-400px)");
  act(() => transport.current!.seek(1.5));
  expect(roll(container)!.style.transform).toBe("translateY(125px)");
  const w = watchStyle(roll(container)!, "transform");
  act(() => transport.current!.seek(1.5));
  expect(w.count()).toBe(0);                                       // written only when it changes
  w.stop();
});

test("a measurement pass re-reads the block height and repaints the roll without a re-fold (no sources ref)", async () => {
  const { transport, container } = mount([{ kind: "wait", ms: 1000 }, credits, { kind: "wait", ms: 500 }]);
  act(() => transport.current!.seek(2));
  expect(roll(container)!.style.transform).toBe("translateY(50px)");
  rollH = 1000;                                                    // fonts loaded: the roll grew
  await act(async () => { await transport.current!.sourcesReady(); });
  expect(roll(container)!.style.transform).toBe("translateY(-100px)"); // 200 − 1200·0.25
});

test("a clear removes the block; a fade_out fades it with the text", () => {
  const a = mount([credits, { kind: "clear" }, { kind: "wait", ms: 500 }]);
  act(() => a.transport.current!.seek(4.2));
  expect(a.container.querySelector(".cin__credits")).toBeNull();
  cleanup();
  const b = mount([credits, { kind: "fade_out", durationMs: 1000 }, { kind: "wait", ms: 500 }]);
  act(() => b.transport.current!.seek(4.5));
  expect(Number(b.container.querySelector<HTMLElement>(".cin__credits")!.style.opacity)).toBeCloseTo(0.5, 6);
});

test("with particles, each credit line is a source with the roll's scroll, emitting only while its top is in the area", async () => {
  const { transport, sources } = mount([{ kind: "wait", ms: 1000 }, { ...credits, particles: { color: "lime" } }, { kind: "clear" }, { kind: "wait", ms: 100 }], true);
  act(() => transport.current!.seek(2));
  await act(async () => { await transport.current!.sourcesReady(); });
  // Stage 1000×500; area top 0 (stubbed rect), areaH 200 → 0.4; blockH 400 → 0.8. Every line's top is
  // the block top (offsets are 0 in jsdom), so each emits from t0 = 1 until it leaves the area top.
  expect(sources.current.map((s) => s.idx)).toEqual([0, 1, 2, 3].map((k) => textSourceIdx(1, k)));
  for (const s of sources.current) {
    expect(s.scroll).toEqual({ t0: 1, dur: 4, from: 0.4, to: -0.8 });
    expect(s.start).toBeCloseTo(1, 9);
    expect(s.end).toBeCloseTo(1 + 0.4 / 0.3, 9);
    expect(s.color).toBe("#E3F84F");
  }
  // A jump straight to a later frame (roll translated elsewhere) publishes the same sources: rects
  // are measured with the roll at offset 0 and the scroll is added analytically.
  const first = JSON.stringify(sources.current);
  cleanup();
  const j = mount([{ kind: "wait", ms: 1000 }, { ...credits, particles: { color: "lime" } }, { kind: "clear" }, { kind: "wait", ms: 100 }], true);
  act(() => j.transport.current!.seek(3.5));
  await act(async () => { await j.transport.current!.sourcesReady(); });
  expect(JSON.stringify(j.sources.current)).toBe(first);
});

test("credits without particles publish no sources", async () => {
  const { transport, sources } = mount([credits, { kind: "wait", ms: 100 }], true);
  act(() => transport.current!.seek(1));
  await act(async () => { await transport.current!.sourcesReady(); });
  expect(sources.current).toEqual([]);
});

test("seek.ts (editor canvas) paints the roll into the text host at the same offset", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  renderBeatAt([credits, { kind: "wait", ms: 100 }], 1, { textHost: host, art: null });
  expect(host.querySelector(".cin__credits")).not.toBeNull();
  expect(host.querySelector<HTMLElement>(".cin__credits-roll")!.style.transform).toBe("translateY(50px)");
  renderBeatAt([credits, { kind: "clear" }], 4.1, { textHost: host, art: null });
  expect(host.querySelector(".cin__credits")).toBeNull();
  host.remove();
});

// I2: a /play resize (the stage's layout size changes) re-measures the roll and the text sources.
// jsdom has no ResizeObserver: this stand-in records each observer so a test can fire it.
class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(private cb: ResizeObserverCallback) { FakeResizeObserver.all.push(this); }
  observe(el: Element) { this.observed.push(el); }
  unobserve() {}
  disconnect() { this.disconnected = true; this.observed = []; }
  /** Deliver one callback whose entry reports the observed element's content size. */
  fire(w = 1000, h = 500) {
    if (this.disconnected) return;
    const entry = { target: this.observed[0], contentRect: { width: w, height: h } } as unknown as ResizeObserverEntry;
    this.cb([entry], this as unknown as ResizeObserver);
  }
}
const live = () => FakeResizeObserver.all.filter((o) => !o.disconnected);

describe("resize", () => {
  beforeEach(() => {
    FakeResizeObserver.all = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const timeline = (): Action[] => [{ kind: "wait", ms: 1000 }, { ...credits, particles: { color: "lime" } }, { kind: "clear" }, { kind: "wait", ms: 100 }];

  test("a stage size change re-reads blockH, repaints the roll and republishes the sources; an unchanged size does not", async () => {
    const { transport, container, sources } = mount(timeline(), true);
    expect(live()).toHaveLength(1);
    expect(live()[0].observed).toEqual([container.querySelector(".cin__stage")]);
    act(() => transport.current!.seek(2));
    await act(async () => { await transport.current!.sourcesReady(); });
    expect(roll(container)!.style.transform).toBe("translateY(50px)");
    const before = JSON.stringify(sources.current);
    rollH = 1000;                                   // the roll would measure taller now…
    act(() => live()[0].fire(1000, 500));           // …but this is the observer's first callback: it only records the size
    await act(async () => { await transport.current!.sourcesReady(); });
    expect(roll(container)!.style.transform).toBe("translateY(50px)");
    expect(JSON.stringify(sources.current)).toBe(before);
    act(() => live()[0].fire(1000, 500));           // the same size again: still nothing
    await act(async () => { await transport.current!.sourcesReady(); });
    expect(roll(container)!.style.transform).toBe("translateY(50px)");
    expect(JSON.stringify(sources.current)).toBe(before);
    act(() => live()[0].fire(1200, 500));           // a resize
    await act(async () => { await transport.current!.sourcesReady(); });
    expect(roll(container)!.style.transform).toBe("translateY(-100px)"); // 200 − 1200·0.25
    expect(sources.current[0].scroll).toEqual({ t0: 1, dur: 4, from: 0.4, to: -2 });
  });

  test("a beat with neither particles nor credits builds a line without reading the stage's size or rect", async () => {
    const stage = (el: Element) => el.classList.contains("cin__stage");
    const reads: string[] = [];
    for (const prop of ["clientWidth", "clientHeight"] as const) {
      vi.spyOn(Element.prototype, prop, "get").mockImplementation(function (this: Element) { if (stage(this)) reads.push(prop); return 0; });
    }
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) { if (stage(this)) reads.push("rect"); return STAGE; });
    const { transport, container } = mount([{ kind: "text", value: "hello", in: "fade" }, { kind: "wait", ms: 500 }]);
    act(() => transport.current!.seek(0.3));
    await act(async () => { await transport.current!.sourcesReady(); });  // the measurement pass has run
    act(() => live()[0].fire(1000, 500));
    expect(container.querySelector(".cin__text")!.textContent).toContain("hello");
    expect(reads).toEqual([]);
  });

  test("the observer is disconnected on unmount and on a beat change (static and live)", () => {
    for (const animate of [true, false]) {
      FakeResizeObserver.all = [];
      const transport = createRef<SlideTransport>();
      const { rerender, unmount } = render(<CinematicSlide slots={{ sceneId: "s", beat: { id: "a", timeline: timeline() } }} animate={animate} runtime={runtime} transport={transport} autoplay={false} />);
      expect(live()).toHaveLength(1);
      const first = live()[0];
      rerender(<CinematicSlide slots={{ sceneId: "s", beat: { id: "b", timeline: timeline() } }} animate={animate} runtime={runtime} transport={transport} autoplay={false} />);
      expect(first.disconnected).toBe(true);
      expect(live()).toHaveLength(1);
      unmount();
      expect(live()).toHaveLength(0);
    }
  });

  test("without ResizeObserver the slide still mounts and measures", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { transport, container } = mount(timeline(), true);
    act(() => transport.current!.seek(2));
    await act(async () => { await transport.current!.sourcesReady(); });
    expect(roll(container)!.style.transform).toBe("translateY(50px)");
  });
});

// M2: a face that starts loading after fonts.ready resolved (/play, editor: nothing is preloaded)
// gets one more measurement behind the new ready.
describe("late fonts", () => {
  const fonts = { status: "loaded" as FontFaceSetLoadStatus, ready: Promise.resolve() as Promise<unknown> };
  beforeEach(() => Object.defineProperty(document, "fonts", { value: fonts, configurable: true }));
  afterEach(() => { delete (document as unknown as { fonts?: unknown }).fonts; });
  const timeline = (): Action[] => [{ kind: "wait", ms: 1000 }, credits, { kind: "wait", ms: 500 }];

  test("still loading after the measurement: re-measure behind the new fonts.ready", async () => {
    fonts.status = "loading";
    fonts.ready = Promise.resolve();
    const { transport, container } = mount(timeline());
    act(() => transport.current!.seek(2));
    let release!: () => void;
    fonts.ready = new Promise<void>((r) => { release = r; });  // the late face's ready
    await act(async () => { await transport.current!.sourcesReady(); });
    expect(roll(container)!.style.transform).toBe("translateY(50px)");
    rollH = 1000;                                                // the late face loads: the roll grows
    fonts.status = "loaded";
    release();
    await act(async () => { await transport.current!.sourcesReady(); });
    expect(roll(container)!.style.transform).toBe("translateY(-100px)");
  });

  test("a non-conforming FontFaceSet (status stuck at loading, ready never swapped) measures once, with no chain", async () => {
    let reads = 0;
    const stuck = Promise.resolve();
    Object.defineProperty(document, "fonts", {
      value: { status: "loading", get ready() { if (++reads > 50) throw new Error("re-measure chain"); return stuck; } },
      configurable: true,
    });
    const { transport, container } = mount(timeline());
    act(() => transport.current!.seek(2));
    await act(async () => { await transport.current!.sourcesReady(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });  // let any chained pass run
    expect(roll(container)!.style.transform).toBe("translateY(50px)");
    expect(reads).toBeLessThanOrEqual(3);                       // one pass: its schedule + the guard's comparison
  });

  test("loaded (every face preloaded, as on /render): no second measurement", async () => {
    fonts.status = "loaded";
    fonts.ready = Promise.resolve();
    const { transport, container } = mount(timeline());
    act(() => transport.current!.seek(2));
    const first = transport.current!.sourcesReady();
    await act(async () => { await first; });
    expect(transport.current!.sourcesReady()).toBe(first);       // nothing queued after it
    rollH = 1000;
    await act(async () => { await transport.current!.sourcesReady(); });
    expect(roll(container)!.style.transform).toBe("translateY(50px)");
  });
});
