// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createElement, createRef, forwardRef, useImperativeHandle } from "react";
import { useDeckStage, type DeckStageHandle } from "@/components/player/DeckStage";
import { nightAt, nightEvents, power2InOut } from "@/engine/authoring/art-clock";
import type { DeckDoc } from "@/engine/deck-doc";
import type { Beat, Scene } from "@/engine/deck/types";
import { cameraAt, cameraEvents, cameraTransform } from "@/engine/authoring/camera-clock";
import type { ClipMode } from "@/engine/components/video-sync";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// Counts BeatStage renders (the memoised Stage's only child) without changing what it renders.
const beatStageRenders = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/engine/authoring/BeatStage", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/engine/authoring/BeatStage")>();
  const Counted = (p: React.ComponentProps<typeof m.BeatStage>) => { beatStageRenders.n++; return createElement(m.BeatStage, p); };
  return { ...m, BeatStage: Counted };
});

const doc = (scenes: Scene[]): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes });

/** A tiny host: the hook's stage, with apply/T exposed through a ref. */
const Host = forwardRef<DeckStageHandle, { doc: DeckDoc; initialT?: number }>(function Host({ doc, initialT = 0 }, ref) {
  const { apply, T, layout, stage } = useDeckStage(doc, initialT);
  useImperativeHandle(ref, () => ({ apply, total: layout.total, current: () => T.current }), [apply, layout.total, T]);
  return <div style={{ position: "relative", width: 1920, height: 1080 }}>{stage}</div>;
});

function setup(d: DeckDoc, initialT = 0) {
  const ref = createRef<DeckStageHandle>();
  const { container } = render(<Host ref={ref} doc={d} initialT={initialT} />);
  const layer = (asset: string) => container.querySelector<HTMLElement>(`.artstage__layer[data-asset="${asset}"]`);
  const layers = () => Array.from(container.querySelectorAll<HTMLElement>(".artstage__layer")).map((e) => e.dataset.asset);
  const glow = () => Number(container.querySelector<HTMLElement>(".artstage__glow")!.style.opacity);
  const apply = (t: number) => act(() => { ref.current!.apply(t); });
  return { ref, container, layer, layers, glow, apply };
}

// The Task 2 fixture: beat a fades to 1.01 (700 ms) and waits 2 s; beat b crossfades to 1.02 at 0.5 s (900 ms).
const D = doc([{ id: "s0", beats: [
  { id: "a", art: { to: "1.01", mode: "fade" }, timeline: [{ kind: "wait", ms: 2000 }] },
  { id: "b", timeline: [{ kind: "wait", ms: 500 }, { kind: "art", art: { to: "1.02", mode: "crossfade" } }, { kind: "wait", ms: 2000 }] },
] }]);

test("apply paints the art stack as a function of deck time (mid-beat crossfade)", () => {
  const { layer, apply } = setup(D);
  apply(2.95); // crossfade started at 2.5, 900 ms → p = 0.5
  expect(Number(layer("1.01")!.style.opacity)).toBeCloseTo(1 - power2InOut(0.5), 6);
  expect(Number(layer("1.02")!.style.opacity)).toBeCloseTo(power2InOut(0.5), 6);
});

test("mount paints the art at initialT (a deep link mid-crossfade)", () => {
  const { layer } = setup(D, 2.95);
  expect(Number(layer("1.01")!.style.opacity)).toBeCloseTo(1 - power2InOut(0.5), 6);
  expect(Number(layer("1.02")!.style.opacity)).toBeCloseTo(power2InOut(0.5), 6);
});

test("backward scrub across an art change shows only the earlier art", () => {
  const { layer, layers, apply } = setup(D);
  apply(4);
  expect(layers()).toEqual(["1.02"]);
  apply(1);
  expect(layers()).toEqual(["1.01"]);
  expect(layer("1.01")!.style.opacity).toBe("1");
  expect(layer("1.02")).toBeNull();
});

test("backward scrub within a beat, to before its mid-beat art, shows only the entry art", () => {
  const { layer, layers, apply } = setup(D);
  apply(4); // beat b, after its crossfade to 1.02 (2.5 s → 3.4 s)
  expect(layers()).toEqual(["1.02"]);
  apply(2.2); // still beat b, before the crossfade starts
  expect(layers()).toEqual(["1.01"]);
  expect(layer("1.01")!.style.opacity).toBe("1");
  expect(layer("1.02")).toBeNull();
});

// Beat a: nightlight → 1 over 400 ms at 0.5 s. Beat b (starts at 2 s) has entry nightlight 0 → a 200 ms
// beat-entry transition back down.
const N = doc([{ id: "s", beats: [
  { id: "a", timeline: [{ kind: "wait", ms: 500 }, { kind: "nightlight", to: 1, durationMs: 400 }, { kind: "wait", ms: 1500 }] },
  { id: "b", nightlight: 0, timeline: [{ kind: "wait", ms: 1000 }] },
] }]);
const tl = nightEvents(N);

test("nightlight: the glow follows nightAt mid-transition", () => {
  const { glow, apply } = setup(N);
  apply(0.7);
  expect(nightAt(tl, 0.7)).toBeCloseTo(0.5, 6); // genuinely mid-transition
  expect(glow()).toBeCloseTo(0.15 + 0.45 * nightAt(tl, 0.7), 6);
});

test("glow/filter still match nightAt after a beat-change re-render (regression check)", () => {
  const { glow, apply, container } = setup(N);
  apply(0.7);
  expect(glow()).toBeCloseTo(0.15 + 0.45 * nightAt(tl, 0.7), 6);
  apply(2.1); // a different beat: loc changes → the host re-renders (ArtStage included)
  expect(nightAt(tl, 2.1)).toBeCloseTo(0.5, 6);
  expect(glow()).toBeCloseTo(0.15 + 0.45 * nightAt(tl, 2.1), 6);
  apply(2.05); // same beat, a plain T change (displayT re-render)
  expect(glow()).toBeCloseTo(0.15 + 0.45 * nightAt(tl, 2.05), 6);
  const root = container.querySelector<HTMLElement>(".artstage")!;
  const g = nightAt(tl, 2.05);
  expect(root.style.filter).toBe(`saturate(${0.85 + 0.3 * g}) brightness(${0.9 + 0.15 * g})`);
});

test("backward scrub across a nightlight action shows the earlier nightlight", () => {
  const { glow, apply } = setup(N);
  apply(1.5);
  expect(glow()).toBeCloseTo(0.6, 6);
  apply(0.2);
  expect(glow()).toBeCloseTo(0.15, 6);
});

test("exactly one ArtStage: BeatStage's own is not mounted", () => {
  const { container } = setup(D, 1);
  expect(container.querySelectorAll(".artstage")).toHaveLength(1);
  expect(container.querySelector("[data-testid=beatstage]")).not.toBeNull();
});

// --- clips as art layers (video-clips Task 7) ----------------------------------------------

/** A host that also exposes the hook's clipMode ref. */
const ClipHost = forwardRef<DeckStageHandle & { clipMode: React.MutableRefObject<ClipMode> }, { doc: DeckDoc }>(function ClipHost({ doc }, ref) {
  const { apply, T, layout, stage, clipMode } = useDeckStage(doc, 0);
  useImperativeHandle(ref, () => ({ apply, total: layout.total, current: () => T.current, clipMode }), [apply, layout.total, T, clipMode]);
  return <div style={{ position: "relative", width: 1920, height: 1080 }}>{stage}</div>;
});

const V = doc([{ id: "s", beats: [{ id: "a", art: { to: "media:a.mp4", mode: "cut" }, timeline: [{ kind: "wait", ms: 3000 }] }] }]);

function setupClip(d: DeckDoc = V) {
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(2); // a decoded frame: seeks apply at once (a fresh element defers to its preroll frame)
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(10);
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const ref = createRef<DeckStageHandle & { clipMode: React.MutableRefObject<ClipMode> }>();
  const { container } = render(<ClipHost ref={ref} doc={d} />);
  const video = () => container.querySelector<HTMLVideoElement>('video.artstage__layer[data-asset="media:a.mp4"]')!;
  const apply = (t: number) => act(() => { ref.current!.apply(t); });
  return { ref, play, video, apply };
}

test("clip art: apply(T) seeks the art video to deck time (seek mode by default)", () => {
  const { ref, play, video, apply } = setupClip();
  expect(ref.current!.clipMode.current).toBe("seek");
  apply(1.25);
  expect(video().currentTime).toBeCloseTo(1.25, 9);
  expect(play).not.toHaveBeenCalled();
});

test("clip art: clipMode 'play' makes apply play the clip; a scrub back seeks", () => {
  const { ref, play, video, apply } = setupClip();
  apply(1.25);
  ref.current!.clipMode.current = "play";
  apply(1.3);
  expect(play).toHaveBeenCalled();
  expect(play.mock.contexts).toContain(video());
  ref.current!.clipMode.current = "seek";
  apply(0.5);
  expect(video().currentTime).toBeCloseTo(0.5, 9);
});

// The clip enters with the SECOND beat (deck time 3): its clip time is deck time since entry,
// not beat-local time or deck time itself.
const V2 = doc([{ id: "s", beats: [
  { id: "a", art: { to: "1.01", mode: "cut" }, timeline: [{ kind: "wait", ms: 3000 }] },
  { id: "b", art: { to: "media:a.mp4", mode: "cut" }, timeline: [{ kind: "wait", ms: 3000 }] },
] }]);

test("clip art entering at a later beat: clip time counts from its entry in deck time", () => {
  const { video, apply } = setupClip(V2);
  apply(4.25);
  expect(video().currentTime).toBeCloseTo(1.25, 9);
  apply(5.5);
  expect(video().currentTime).toBeCloseTo(2.5, 9);
});

// --- deck-time camera (camera moves Task 4) -------------------------------------------------

// Beat a: art 1.01, then at t=0.5 a 2 s camera move to {zoom 3, x 0.3, y 0.4}, a text line and a
// media tile; a long wait so deck time 10 is still inside the beat.
const camBeat = (id: string, wait: number): Beat => ({ id, art: { to: "1.01", mode: "cut" }, timeline: [
  { kind: "wait", ms: 500 },
  { kind: "camera", to: { zoom: 3, x: 0.3, y: 0.4 }, durationMs: 2000 },
  { kind: "text", value: "Fixed words", in: "fade" },
  { kind: "media", id: "m", pos: { x: 0.3, y: 0.4 }, label: "tile" },
  { kind: "wait", ms: wait },
] });
const CAM = doc([{ id: "s1", beats: [camBeat("a", 10000)] }]);
// Two scenes: the move happens in scene 1 (4 s, pinned); scene 2 has no camera action.
const CAM2 = doc([
  { id: "s1", durationSec: 4, beats: [camBeat("a", 1000)] },
  { id: "s2", beats: [{ id: "b", timeline: [{ kind: "text", value: "Later words", in: "fade" }, { kind: "wait", ms: 3000 }] }] },
]);

function worlds(container: HTMLElement) {
  const one = (sel: string) => container.querySelector<HTMLElement>(sel)!;
  return {
    art: one(".artstage__world").style.transform,
    cin: one(".cin__world").style.transform,
    beat: Array.from(container.querySelectorAll<HTMLElement>(".beat__world")).map((w) => w.style.transform),
    stage: one(".cin__stage").style.transform,
    text: Array.from(container.querySelectorAll<HTMLElement>(".cin__text")).map((t) => t.style.transform),
  };
}
const expectFraming = (container: HTMLElement, tf: string) => {
  const w = worlds(container);
  expect(w.art).toBe(tf);
  expect(w.cin).toBe(tf);
  expect(w.beat).toEqual([tf, tf]);
  expect(w.stage).toBe(""); // the text layer never moves
  expect(w.text.length).toBeGreaterThan(0);
  for (const t of w.text) expect(t).toBe("");
};

test("camera: apply(T) paints the art world, tiles and notes/objects with the same framing; text stays fixed", () => {
  const ev = cameraEvents(CAM);
  const { container, apply } = setup(CAM);
  apply(1.5); // mid-move (0.5 → 2.5)
  const tf = cameraTransform(cameraAt(ev, 1.5));
  expect(tf).toContain("scale(");
  expect(tf).not.toContain("scale(3)"); // genuinely mid-move
  expectFraming(container, tf);
  expect(container.querySelector(".cin__world .cin__media")).not.toBeNull();
});

test("camera: apply past the move holds the end framing", () => {
  const { container, apply } = setup(CAM);
  apply(10);
  expectFraming(container, cameraTransform({ zoom: 3, x: 0.3, y: 0.4 }));
  apply(0.2); // a backward scrub to before the move: full frame everywhere
  const w = worlds(container);
  expect(w.art).toBe("none");
  expect(w.cin).toBe("none");
  expect(w.beat).toEqual(["none", "none"]);
});

test("camera: mount paints the framing at initialT", () => {
  const { container } = setup(CAM, 1.5);
  expectFraming(container, cameraTransform(cameraAt(cameraEvents(CAM), 1.5)));
});

test("camera: the framing persists across a cut into a scene with no camera action", () => {
  const { container, apply } = setup(CAM2);
  apply(3); // scene 1, after the move
  const end = cameraTransform({ zoom: 3, x: 0.3, y: 0.4 });
  expect(worlds(container).art).toBe(end);
  apply(5); // scene 2 (starts at 4)
  expect(container.textContent).toContain("Later words");
  const w = worlds(container);
  expect(w.art).toBe(end);
  expect(w.cin).toBe(end);
  expect(w.beat).toEqual([end, end]);
  expect(w.stage).toBe("");
});

test("camera: a framing change alone never re-renders Stage", () => {
  const { container, apply } = setup(CAM);
  apply(0.6); // settle on the beat
  const before = beatStageRenders.n;
  expect(before).toBeGreaterThan(0); // the counter sees Stage's BeatStage
  const seen = new Set<string>();
  for (const t of [0.8, 1.0, 1.5, 2.0, 2.4]) { apply(t); seen.add(worlds(container).art); }
  expect(seen.size).toBe(5); // the framing really changed every step
  expect(beatStageRenders.n).toBe(before);
});

test("camera: a doc change at the same T repaints every world with the new doc's framing", () => {
  // Same timing as CAM, a different target: the paint-camera layout effect must run before the
  // re-seek effect, so the beat's worlds read the new doc's framing, not the stale ref.
  const CAM_B = doc([{ id: "s1", beats: [{ ...camBeat("a", 10000), timeline: camBeat("a", 10000).timeline.map((a) =>
    a.kind === "camera" ? { ...a, to: { zoom: 2, x: 0.7, y: 0.6 } } : a) }] }]);
  const ref = createRef<DeckStageHandle>();
  const { container, rerender } = render(<Host ref={ref} doc={CAM} />);
  act(() => { ref.current!.apply(1.5); });
  expectFraming(container, cameraTransform(cameraAt(cameraEvents(CAM), 1.5)));
  rerender(<Host ref={ref} doc={CAM_B} />);
  expect(ref.current!.current()).toBe(1.5);
  const want = cameraTransform(cameraAt(cameraEvents(CAM_B), 1.5));
  expect(want).not.toBe(cameraTransform(cameraAt(cameraEvents(CAM), 1.5)));
  expectFraming(container, want);
});

test("camera: mid-move inside a pinned scene's hold, every world follows deck time", () => {
  // The beat ends at 1.4 s (text + tile; localT clamps there); the scene is pinned to 4 s and the 3 s move runs on
  // through the hold, so successive applies seek the beat to the SAME clamped localT.
  const HOLD = doc([{ id: "s1", durationSec: 4, beats: [{ id: "a", art: { to: "1.01", mode: "cut" }, timeline: [
    { kind: "camera", to: { zoom: 3, x: 0.3, y: 0.4 }, durationMs: 3000 },
    { kind: "text", value: "Held words", in: "fade" },
    { kind: "media", id: "m", pos: { x: 0.3, y: 0.4 }, label: "tile" },
  ] }] }]);
  const ev = cameraEvents(HOLD);
  const { container, apply } = setup(HOLD);
  const seen = new Set<string>();
  for (const T of [2, 2.5]) {
    apply(T);
    const tf = cameraTransform(cameraAt(ev, T));
    expect(tf).not.toBe(cameraTransform({ zoom: 3, x: 0.3, y: 0.4 })); // genuinely mid-move
    expectFraming(container, tf);
    seen.add(tf);
  }
  expect(seen.size).toBe(2);
});

// Final review I1: Chromium keeps the raster scale of a `will-change: transform` layer, so under a
// zooming world its pixels depended on render history. A deck with camera events flags its stage
// root (static, per deck) and a CSS rule drops those hints; a camera-less deck carries no flag.
test("camera: a deck with camera events flags the stage root data-camera; a deck without has none", () => {
  const stageRoot = (c: HTMLElement) => c.querySelector<HTMLElement>(".artstage")!.parentElement!;
  const withCam = setup(CAM);
  expect(stageRoot(withCam.container).dataset.camera).toBe("1");
  const css = Array.from(withCam.container.querySelectorAll("style")).map((s) => s.textContent).join("\n");
  expect(css).toMatch(/\[data-camera\] \.artstage__layer/);
  expect(css).toMatch(/\[data-camera\] \.notefield__stage > \*/);
  cleanup();
  const without = setup(D);
  expect(stageRoot(without.container).hasAttribute("data-camera")).toBe(false);
});

// The note-deck full raster lives in RenderStage (/render only): /play's and the editor's stage for a
// camera-less note deck carries no flag and no hint-dropping style.
test("a camera-less note deck: the deck stage gets no data-camera and no will-change override", () => {
  const notes = doc([{ id: "s0", beats: [{ id: "a", timeline: [
    { kind: "note_emitter", color: "#fff", pos: { x: 0.5, y: 0.5 }, dir: 0, decay: 1000, freq: 2 }, { kind: "wait", ms: 2000 },
  ] }] }]);
  const { container } = setup(notes);
  const stageRoot = container.querySelector<HTMLElement>(".artstage")!.parentElement!;
  expect(stageRoot.hasAttribute("data-camera")).toBe(false);
  expect(container.querySelector("[data-camera]")).toBeNull();
  const css = Array.from(container.querySelectorAll("style")).map((s) => s.textContent).join("\n");
  expect(css).not.toMatch(/will-change: auto/);
});
