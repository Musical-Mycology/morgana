import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import gsap from "gsap";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import type { Beat } from "@/engine/deck/types";

afterEach(cleanup);

const beat: Beat = { id: "b", timeline: [{ kind: "text", value: "hello", in: "fade" }, { kind: "wait", ms: 1000 }] };

test("autoplay={false} never registers a gsap ticker; seek still renders", () => {
  const add = vi.spyOn(gsap.ticker, "add");
  const transport = createRef<SlideTransport>();
  render(<BeatStage sceneId="s" beat={beat} autoplay={false} transport={transport} contained />);
  expect(add).not.toHaveBeenCalled();
  transport.current!.seek(1.5);
  expect(document.body.textContent).toContain("hello");
  add.mockRestore();
});

test("default autoplay still registers the ticker (unchanged behaviour)", () => {
  const add = vi.spyOn(gsap.ticker, "add");
  render(<BeatStage sceneId="s" beat={beat} contained />);
  expect(add).toHaveBeenCalled();
  add.mockRestore();
});

test("entryNight is re-applied when the beat changes", () => {
  // ArtStage renders `.artstage__glow` with opacity 0.15 + 0.45 * min(1, nightlight):
  // nightlight 1 → 0.6, nightlight 0 → 0.15.
  const glow = (c: HTMLElement) => (c.querySelector(".artstage__glow") as HTMLElement).style.opacity;
  const b2: Beat = { id: "b2", timeline: [{ kind: "wait", ms: 500 }] };
  const { rerender, container } = render(<BeatStage sceneId="s" beat={beat} autoplay={false} entryNight={1} contained />);
  expect(Number(glow(container))).toBeCloseTo(0.6);
  rerender(<BeatStage sceneId="s" beat={b2} autoplay={false} entryNight={0} contained />);
  expect(Number(glow(container))).toBeCloseTo(0.15);
  rerender(<BeatStage sceneId="s" beat={beat} autoplay={false} entryNight={1} contained />); // backward swap
  expect(Number(glow(container))).toBeCloseTo(0.6);
});

test("a t=0 nightlight action beats entryNight (mount and beat swap)", () => {
  const glow = (c: HTMLElement) => (c.querySelector(".artstage__glow") as HTMLElement).style.opacity;
  const lit: Beat = { id: "lit", timeline: [{ kind: "nightlight", to: 1 }, { kind: "wait", ms: 500 }] };
  const plain: Beat = { id: "plain", timeline: [{ kind: "wait", ms: 500 }] };
  const first = render(<BeatStage sceneId="s" beat={lit} autoplay={false} entryNight={0} contained />);
  expect(Number(glow(first.container))).toBeCloseTo(0.6);
  first.unmount();
  const { rerender, container } = render(<BeatStage sceneId="s" beat={plain} autoplay={false} entryNight={0} contained />);
  expect(Number(glow(container))).toBeCloseTo(0.15);
  rerender(<BeatStage sceneId="s" beat={lit} autoplay={false} entryNight={0} contained />);
  expect(Number(glow(container))).toBeCloseTo(0.6);
});

// --- Final review fixes: host-driven entry state under seeking -------------------------------

const layersOf = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>(".artstage__layer")).map((el) => el.dataset.asset);
const glowOf = (c: HTMLElement) => Number((c.querySelector(".artstage__glow") as HTMLElement).style.opacity);

// Entry: art 1.01, nightlight 0 (glow 0.15). At t=2: art → 3.01 and nightlight 1 (glow 0.6).
const midArt: Beat = { id: "mid", art: { to: "1.01", mode: "cut" }, timeline: [
  { kind: "wait", ms: 2000 },
  { kind: "art", art: { to: "3.01", mode: "cut" } },
  { kind: "nightlight", to: 1 },
  { kind: "wait", ms: 2000 },
] };

test("a backward seek within a beat restores its entry art and entry nightlight", () => {
  const transport = createRef<SlideTransport>();
  const { container } = render(<BeatStage sceneId="s" beat={midArt} autoplay={false} transport={transport}
    entryLayers={["1.01"]} endLayers={["3.01"]} entryNight={0} contained />);
  act(() => { transport.current!.seek(3); });
  expect(layersOf(container)).toEqual(["3.01"]);
  expect(glowOf(container)).toBeCloseTo(0.6);
  act(() => { transport.current!.seek(1); });
  expect(layersOf(container)).toEqual(["1.01"]);
  expect(glowOf(container)).toBeCloseTo(0.15);
});

test("host-driven mode ignores a hidden tab at mount: seeks still paint entry state", () => {
  const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const add = vi.spyOn(gsap.ticker, "add");
  const transport = createRef<SlideTransport>();
  const { container } = render(<BeatStage sceneId="s" beat={midArt} autoplay={false} transport={transport}
    entryLayers={["1.01"]} endLayers={["3.01"]} entryNight={0} contained />);
  expect(layersOf(container)).toEqual(["1.01"]); // painted at t=0, not the static end state
  expect(glowOf(container)).toBeCloseTo(0.15);
  act(() => { transport.current!.seek(0.5); });
  expect(layersOf(container)).toEqual(["1.01"]);
  expect(glowOf(container)).toBeCloseTo(0.15);
  expect(add).not.toHaveBeenCalled();
  add.mockRestore();
  vis.mockRestore();
});

test("autoplay mode still goes static (end state, no ticker) in a hidden tab", () => {
  const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const add = vi.spyOn(gsap.ticker, "add");
  const { container } = render(<BeatStage sceneId="s" beat={midArt}
    entryLayers={["1.01"]} endLayers={["3.01"]} entryNight={0} contained />);
  expect(layersOf(container)).toEqual(["3.01"]);
  expect(glowOf(container)).toBeCloseTo(0.6);
  expect(add).not.toHaveBeenCalled();
  add.mockRestore();
  vis.mockRestore();
});
