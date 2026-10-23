// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef, forwardRef, useImperativeHandle } from "react";
import { useDeckStage, type DeckStageHandle } from "@/components/player/DeckStage";
import { nightAt, nightEvents, power2InOut } from "@/engine/authoring/art-clock";
import type { DeckDoc } from "@/engine/deck-doc";
import type { Scene } from "@/engine/deck/types";
import type { ClipMode } from "@/engine/components/video-sync";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
