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

test("host-driven mode ignores a hidden tab at mount: no static end state, and it never issues art/nightlight", () => {
  const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const add = vi.spyOn(gsap.ticker, "add");
  const transport = createRef<SlideTransport>();
  const { container } = render(<BeatStage sceneId="s" beat={midArt} autoplay={false} transport={transport}
    entryLayers={["1.01"]} endLayers={["3.01"]} contained />);
  // Not the static end state (which would cut to 3.01 at glow 0.6): host-driven, the host owns
  // art + nightlight, so the slide issues none — at mount or on any seek.
  expect(layersOf(container)).toEqual([]);
  expect(glowOf(container)).toBeCloseTo(0.15);
  act(() => { transport.current!.seek(3); });
  expect(layersOf(container)).toEqual([]);
  expect(glowOf(container)).toBeCloseTo(0.15);
  expect(add).not.toHaveBeenCalled();
  add.mockRestore();
  vis.mockRestore();
});

test("autoplay mode still goes static (end state, no ticker) in a hidden tab", () => {
  const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const add = vi.spyOn(gsap.ticker, "add");
  const { container } = render(<BeatStage sceneId="s" beat={midArt}
    entryLayers={["1.01"]} endLayers={["3.01"]} contained />);
  expect(layersOf(container)).toEqual(["3.01"]);
  expect(glowOf(container)).toBeCloseTo(0.6);
  expect(add).not.toHaveBeenCalled();
  add.mockRestore();
  vis.mockRestore();
});

test("art={false} mounts no ArtStage of its own", () => {
  const { container } = render(<BeatStage sceneId="s" beat={midArt} autoplay={false} art={false} contained />);
  expect(container.querySelector(".artstage")).toBeNull();
  expect((container.querySelector("[data-testid=beatstage]") as HTMLElement).style.background).toBe("transparent");
});
