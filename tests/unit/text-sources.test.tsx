import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { CinematicSlide, type CinematicRuntime, type SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import { NoteField, type NoteFieldHandle } from "@/engine/components/NoteField";
import { BeatStage } from "@/engine/authoring/BeatStage";
import { drawLineRects, htmlLineRects, wrapWords } from "@/engine/components/text-sources";
import { textSourceIdx, type TextSource } from "@/engine/components/effects/note-state";
import type { Beat, Scene } from "@/engine/deck/types";

const runtime = { art() {}, applyArt() {}, setNightlight() {}, onGate() {}, revealArrows() {}, pulseArrow() {}, onWaiting() {}, resolveEntry: () => [], resolveEnd: () => [], jumpTo() {} } as CinematicRuntime;
const STAGE = { left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON() {} } as DOMRect;
beforeEach(() => { vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(STAGE); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete (document as unknown as { fonts?: unknown }).fonts; });

// Line 0 has particles; line 1 does not; a clear at 2.1 s ends line 0's births and wipes both.
const beat: Beat = { id: "b", timeline: [
  { kind: "text", value: "Hello world", in: "fade", particles: { color: "cyan" } },
  { kind: "text", value: "Plain", in: "fade" },
  { kind: "wait", ms: 500 }, { kind: "clear" }, { kind: "wait", ms: 500 },
] };
function mount(b: Beat = beat) {
  const transport = createRef<SlideTransport>();
  const sources = { current: [] as TextSource[] };
  const onTime = vi.fn();
  const r = render(<CinematicSlide slots={{ sceneId: "s", beat: b }} animate runtime={runtime} transport={transport} autoplay={false} textSourcesRef={sources} onTime={onTime} />);
  return { ...r, transport, sources, onTime };
}
const ready = (tr: React.RefObject<SlideTransport | null>) => act(async () => { await tr.current!.sourcesReady(); });

test("wrapWords wraps each non-space run (nested markup too) and keeps whitespace", () => {
  const el = document.createElement("p");
  el.innerHTML = "Hello  <strong>big</strong> world";
  wrapWords(el);
  expect(Array.from(el.querySelectorAll(".cin__mw")).map((w) => w.textContent)).toEqual(["Hello", "big", "world"]);
  expect(el.textContent).toBe("Hello  big world");
});

test("htmlLineRects: one box per word from layout offsets, on a clone that is removed again", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const p = document.createElement("p");
  p.textContent = "Hello world";
  host.appendChild(p);
  const word = (el: HTMLElement, a: number, b: number) => (el.classList.contains("cin__mw") ? (el.textContent === "Hello" ? a : b) : 0);
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) { return word(this, 10, 70); });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return word(this, 50, 50); });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return word(this, 20, 20); });
  expect(htmlLineRects(p, (c) => { c.textContent = "Hello world"; }, STAGE))
    .toEqual([{ x: 0.01, y: 0, w: 0.05, h: 0.04 }, { x: 0.07, y: 0, w: 0.05, h: 0.04 }]);
  expect(host.children).toHaveLength(1);
  expect(document.body.children).toHaveLength(1); // the at-rest replica is gone again
  host.remove();
});

test("drawLineRects: one box per word from the SVG glyph extents, offset by the draw wrap", () => {
  const proto = SVGElement.prototype as unknown as { getExtentOfChar?: (k: number) => DOMRect };
  proto.getExtentOfChar = (k: number) => ({ x: k * 10, y: 0, width: 10, height: 20 }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("cin__draw-wrap") ? 100 : 0; });
  try {
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.innerHTML = '<p class="cin__line cin__line--draw"><span class="cin__draw-wrap"><span class="cin__draw-ghost">Hi there</span>'
      + '<svg class="cin__draw"><text><tspan>H</tspan></text></svg></span></p>';
    expect(drawLineRects(host.querySelector("p")!, "Hi there", STAGE))
      .toEqual([{ x: 0.1, y: 0, w: 0.02, h: 0.04 }, { x: 0.13, y: 0, w: 0.05, h: 0.04 }]);
    expect(document.body.children).toHaveLength(1);
    host.remove();
  } finally {
    delete proto.getExtentOfChar;
  }
});

test("a particle line publishes one source after sourcesReady; a line without particles publishes none", async () => {
  const { transport, sources } = mount();
  act(() => transport.current!.seek(1.7));
  await ready(transport);
  expect(sources.current).toHaveLength(1);
  const s = sources.current[0];
  expect(s).toMatchObject({ key: "a0", idx: textSourceIdx(0), start: 0, color: "#3FFBFF", rate: 6, rise: 1 });
  expect(s.end).toBeCloseTo(2.1, 9);
  expect(s.rects).toHaveLength(2);
  expect(s.scroll).toBeUndefined();
});

test("measuring re-notifies the host with the same t; a settled-but-unchanged frame does not re-measure", async () => {
  const { transport, onTime } = mount();
  act(() => transport.current!.seek(1.7));
  const before = onTime.mock.calls.length;
  await ready(transport);
  expect(onTime.mock.calls.length).toBe(before + 1);
  expect(onTime.mock.calls.at(-1)![0]).toBe(1.7);
  act(() => transport.current!.seek(1.8)); // nothing built or wiped
  await ready(transport);
  expect(onTime.mock.calls.length).toBe(before + 2); // the seek's own onTime only
});

test("Review Focus #4: after the clear, the wiped line's source is gone — stepped or jumped", async () => {
  const stepped = mount();
  for (const t of [0.5, 1.2, 1.7, 2.3]) act(() => stepped.transport.current!.seek(t));
  await ready(stepped.transport);
  expect(stepped.sources.current).toEqual([]);
  cleanup();
  const jumped = mount();
  act(() => jumped.transport.current!.seek(2.3));
  await ready(jumped.transport);
  expect(jumped.sources.current).toEqual([]);
});

test("Review Focus #4: births stop at the clear — the source published before the wipe already ends there", async () => {
  const { transport, sources } = mount();
  for (const t of [0.5, 1.2, 1.7]) act(() => transport.current!.seek(t));
  await ready(transport);
  expect(sources.current.map((s) => s.end)).toEqual([expect.closeTo(2.1, 9)]);
  act(() => transport.current!.seek(2.0)); // still before the clear: same source, no re-measure
  await ready(transport);
  expect(sources.current).toHaveLength(1);
  act(() => transport.current!.seek(2.1)); // the clear itself wipes the line
  await ready(transport);
  expect(sources.current).toEqual([]);
  act(() => transport.current!.seek(1.0)); // and a backward scrub rebuilds it
  await ready(transport);
  expect(sources.current.map((s) => s.key)).toEqual(["a0"]);
});

test("Review Focus #1: a beat swap while a measurement is pending never publishes the old beat's sources", async () => {
  let release!: () => void;
  Object.defineProperty(document, "fonts", { value: { ready: new Promise<void>((r) => { release = r; }) }, configurable: true });
  const { transport, sources, rerender } = mount();
  act(() => transport.current!.seek(1.7));           // queues beat b's measurement behind fonts.ready
  const other: Beat = { id: "c", timeline: [{ kind: "text", value: "No notes here", in: "fade" }, { kind: "wait", ms: 500 }] };
  rerender(<CinematicSlide slots={{ sceneId: "s", beat: other }} animate runtime={runtime} transport={transport} autoplay={false} textSourcesRef={sources} />);
  release();
  await ready(transport);
  await act(async () => { await Promise.resolve(); });
  expect(sources.current).toEqual([]);
});

test("Review Focus #1: the new beat publishes only its own sources once the stale measurement is dropped", async () => {
  let release!: () => void;
  Object.defineProperty(document, "fonts", { value: { ready: new Promise<void>((r) => { release = r; }) }, configurable: true });
  const { transport, sources, rerender, onTime } = mount();
  act(() => transport.current!.seek(1.7));
  const other: Beat = { id: "c", timeline: [{ kind: "wait", ms: 300 }, { kind: "text", value: "One two three", in: "fade", particles: { color: "lime" } }, { kind: "wait", ms: 500 }] };
  rerender(<CinematicSlide slots={{ sceneId: "s", beat: other }} animate runtime={runtime} transport={transport} autoplay={false} textSourcesRef={sources} onTime={onTime} />);
  act(() => transport.current!.seek(1.0));
  const before = onTime.mock.calls.length;
  release();
  await ready(transport);
  await act(async () => { await Promise.resolve(); });
  expect(sources.current.map((s) => [s.key, s.rects.length])).toEqual([["a1", 3]]);
  expect(onTime.mock.calls.length).toBe(before + 1); // only the live beat's measurement re-notifies
});

test("F10: a dotted particle line measures only its line's words — the dots never emit", async () => {
  const { transport, sources } = mount({ id: "d", timeline: [
    { kind: "text", value: "Loading world...", in: "fade", dots: true, particles: {} }, { kind: "wait", ms: 500 },
  ] });
  act(() => transport.current!.seek(2));
  await ready(transport);
  expect(sources.current).toHaveLength(1);
  expect(sources.current[0].rects).toHaveLength(2);
});

test("F11: an append fragment is not measured — not as its own source, nor as words of its line", async () => {
  const { transport, sources } = mount({ id: "e", timeline: [
    { kind: "text", value: "Hello world", in: "fade", particles: {} },
    { kind: "text", value: " and more", in: "fade", append: true, particles: {} },
    { kind: "wait", ms: 500 },
  ] });
  act(() => transport.current!.seek(3));
  await ready(transport);
  expect(sources.current.map((s) => [s.key, s.rects.length])).toEqual([["a0", 2]]);
});

test("F3: boxes come from an at-rest replica — a mid-split stepped frame and a settled jumped frame publish the same sources", async () => {
  // Word offsets depend on the word's DOM context: inside a split line (SplitText's char/word divs)
  // they would differ. The at-rest replica never contains split pieces, and the live line is never
  // wrapped or measured.
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains("cin__mw")) return 0;
    const split = this.closest(".cin__line")?.querySelector("div") ? 500 : 0;
    return split + (this.textContent === "Hello" ? 10 : 70);
  });
  // A split line also sits elsewhere (SplitText's masks change its box): reading the live line's
  // own offsets would put a stepped frame's boxes 100px lower than a jumped frame's.
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("cin__line") && this.querySelector("div") ? 100 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("cin__mw") ? 50 : 0; });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("cin__mw") ? 20 : 0; });
  const b: Beat = { id: "f", timeline: [
    { kind: "text", value: "Hello world", in: "letterFly", particles: {} }, { kind: "wait", ms: 3000 },
  ] };
  const stepped = mount(b);
  act(() => stepped.transport.current!.seek(0.05)); // built and mid-reveal: the live line is split
  const live = stepped.container.querySelector<HTMLElement>(".cin__line")!;
  expect(live.querySelector("div")).not.toBeNull();
  await ready(stepped.transport);
  expect(live.querySelector(".cin__mw")).toBeNull();
  act(() => stepped.transport.current!.seek(3)); // settled; nothing built or wiped → no re-measure
  await ready(stepped.transport);
  const a = stepped.sources.current;
  cleanup();
  const jumped = mount(b);
  act(() => jumped.transport.current!.seek(3));
  await ready(jumped.transport);
  expect(a).toHaveLength(1);
  expect(a[0].rects).toEqual([{ x: 0.01, y: 0, w: 0.05, h: 0.04 }, { x: 0.07, y: 0, w: 0.05, h: 0.04 }]);
  expect(jumped.sources.current).toEqual(a);
});

test("a draw line is measured from its SVG glyph geometry, one box per word", async () => {
  const proto = SVGElement.prototype as unknown as { getExtentOfChar?: (k: number) => DOMRect };
  proto.getExtentOfChar = (k: number) => ({ x: k * 10, y: 0, width: 10, height: 20 }) as DOMRect;
  try {
    const { transport, sources } = mount({ id: "g", timeline: [
      { kind: "text", value: "Hi there", in: "draw", particles: {} }, { kind: "wait", ms: 500 },
    ] });
    act(() => transport.current!.seek(3));
    await ready(transport);
    expect(sources.current).toHaveLength(1);
    expect(sources.current[0].rects).toEqual([{ x: 0, y: 0, w: 0.02, h: 0.04 }, { x: 0.03, y: 0, w: 0.05, h: 0.04 }]);
  } finally {
    delete proto.getExtentOfChar;
  }
});

test("a beat without particle lines never publishes sources and leaves the stage DOM as it was", async () => {
  const { transport, sources, container, onTime } = mount({ id: "h", timeline: [{ kind: "text", value: "Plain", in: "fade" }, { kind: "wait", ms: 500 }] });
  act(() => transport.current!.seek(1));
  const html = container.innerHTML;
  const calls = onTime.mock.calls.length;
  await ready(transport);
  expect(sources.current).toEqual([]);
  expect(container.innerHTML).toBe(html);
  expect(onTime.mock.calls.length).toBe(calls); // nothing changed: no extra repaint (Review Focus #2)
});

test("NoteField paints text-keyed sprites into textHost and emitter sprites into its own stage", () => {
  const ref = createRef<NoteFieldHandle>();
  const hostRef = createRef<HTMLDivElement>();
  render(<><NoteField ref={ref} textHost={hostRef} /><div ref={hostRef} className="notefield__text" /></>);
  const scene: Scene = { id: "s", beats: [{ id: "b", timeline: [{ kind: "note_emitter", color: "#fff", pos: { x: 0.5, y: 0.5 }, dir: 0, decay: 1000, freq: 4 }, { kind: "wait", ms: 2000 }] }] };
  const src: TextSource = { key: "a0", idx: textSourceIdx(0), start: 0, rects: [{ x: 0.1, y: 0.2, w: 0.1, h: 0.05 }], color: "#3FFBFF", rate: 6, rise: 1 };
  act(() => ref.current!.renderAt(scene, 0, 1, [src]));
  expect(hostRef.current!.children.length).toBeGreaterThan(0);
  expect(document.querySelector(".notefield__stage")!.children.length).toBeGreaterThan(0);
});

test("BeatStage: .notefield__text is in the fixed stack — outside both worlds, z 2, after them and before the text", () => {
  const scene: Scene = { id: "s", beats: [beat] };
  const { container } = render(<BeatStage sceneId="s" beat={beat} scene={scene} beatIndex={0} autoplay={false} art={false} contained
    camera={{ events: [{ start: 0, duration: 0, to: { zoom: 2 }, ease: "linear" }], beatStart: 0 }} />);
  const nt = container.querySelector<HTMLElement>(".notefield__text")!;
  expect(nt.closest(".beat__world")).toBeNull();
  const wrap = nt.parentElement!;
  expect(wrap.style.zIndex).toBe("2");
  const worlds = container.querySelectorAll<HTMLElement>(".beat__world");
  expect(worlds[1].compareDocumentPosition(wrap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(wrap.compareDocumentPosition(container.querySelector(".cin")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(worlds[0].style.transform).toContain("scale(2)");
  for (let n: HTMLElement | null = nt; n && n !== container; n = n.parentElement) expect(["", "none"]).toContain(n.style.transform);
});
