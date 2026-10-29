import { afterEach, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { CinematicSlide, type CinematicRuntime, type SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import { flashGlowAt } from "@/engine/components/effects/cinematic-anim";
import type { Action, Beat } from "@/engine/deck/types";

// `flash: true` on a text action: a brief warm glow that rises and falls while the line comes in, ending
// with the intro so it never outlasts the action's beat-clock slot (seek, playback and render agree).
afterEach(cleanup);
const runtime = { art() {}, applyArt() {}, setNightlight() {}, onGate() {}, revealArrows() {}, pulseArrow() {}, onWaiting() {}, resolveEntry: () => [], resolveEnd: () => [], jumpTo() {} } as CinematicRuntime;

function mount(timeline: Action[]) {
  const transport = createRef<SlideTransport>();
  const beat: Beat = { id: "f", timeline: [...timeline, { kind: "wait", ms: 2000 }] };
  const { container } = render(<CinematicSlide slots={{ sceneId: "s", beat }} animate runtime={runtime} transport={transport} autoplay={false} />);
  return { container, seek: (t: number) => transport.current!.seek(t) };
}

test("flashGlowAt rises from nothing to a peak and is gone again by the end", () => {
  expect(flashGlowAt(0)).toBe(0);
  expect(flashGlowAt(1)).toBe(0);
  const peak = Math.max(...Array.from({ length: 101 }, (_, i) => flashGlowAt(i / 100)));
  expect(peak).toBeCloseTo(1, 2);
  expect(flashGlowAt(0.2)).toBeGreaterThan(0);
  expect(flashGlowAt(0.8)).toBeGreaterThan(0);
  expect(flashGlowAt(-1)).toBe(0);
  expect(flashGlowAt(2)).toBe(0);
});

test("a flashing line glows mid-intro and has no glow once settled, by seek in either direction", () => {
  // fade intro: 0.8 s
  const { container, seek } = mount([{ kind: "text", value: "Glow", in: "fade", flash: true, pos: { x: 0.5, y: 0.5 } }]);
  const line = () => container.querySelector<HTMLElement>(".cin__line")!;
  seek(0.35);
  expect(line().style.filter).toContain("drop-shadow");
  seek(1.5);
  expect(line().style.filter).toBe("");
  seek(0.35);                                     // backward into the intro: the glow comes back
  expect(line().style.filter).toContain("drop-shadow");
});

test("a line without flash never gets a glow filter", () => {
  const { container, seek } = mount([{ kind: "text", value: "Plain", in: "fade", pos: { x: 0.5, y: 0.5 } }]);
  seek(0.35);
  expect(container.querySelector<HTMLElement>(".cin__line")!.style.filter).toBe("");
});
