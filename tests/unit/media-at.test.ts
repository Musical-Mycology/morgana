import { expect, test } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { mediaStateAt } from "@/engine/deck/media-state";
import { CinematicSlide } from "@/engine/components/layouts/CinematicSlide";
import type { Action, Beat } from "@/engine/deck/types";

const show: Extract<Action, { kind: "media" }> = { kind: "media", id: "m", pos: { x: 0.2, y: 0.3 } };
const move: Extract<Action, { kind: "media_move" }> = { kind: "media_move", id: "m", to: { x: 0.8, y: 0.3 }, durationMs: 1000 };

test("a shown tile fades in over its duration", () => {
  expect(mediaStateAt([{ action: show, p: 0 }], 0).get("m")!.opacity).toBeCloseTo(0);
  expect(mediaStateAt([{ action: show, p: 1 }], 0).get("m")!.opacity).toBeCloseTo(1);
});

test("media_move interpolates position at local progress", () => {
  const s = mediaStateAt([{ action: show, p: 1 }, { action: move, p: 0.5 }], 0).get("m")!;
  expect(s.x).toBeGreaterThan(0.2);
  expect(s.x).toBeLessThan(0.8);
});

// moveMedia uses ease "power3.inOut", which is SYMMETRIC — exactly half-way at p=0.5.
// An ease-out curve would put the midpoint well past halfway, so this pins the shape,
// not just the endpoints, and would catch the power2/power3 off-by-one in GSAP's naming.
test("media_move's ease is symmetric in-out, matching playback", () => {
  const s = mediaStateAt([{ action: show, p: 1 }, { action: move, p: 0.5 }], 0).get("m")!;
  expect(s.x).toBeCloseTo(0.5, 4);
});

test("media_out drives opacity to zero", () => {
  const out: Extract<Action, { kind: "media_out" }> = { kind: "media_out", id: "m" };
  expect(mediaStateAt([{ action: show, p: 1 }, { action: out, p: 1 }], 0).get("m")!.opacity).toBeCloseTo(0);
});

// --- media_move chaining (ambiguity resolution #2) -----------------------------------------
//
// A second media_move on the same tile must start from where the FIRST one ended, not from
// the original `media` pos. An endpoint-only assertion can't distinguish "chains off the
// running position" from "chains off the original pos" — both converge on the same settled
// endpoint for x once move1 has fully played out. Only a MID-FLIGHT assertion inside move2's
// own window, checking that x does NOT drift back toward the original pos, pins it down.
test("media_move chains off the running position: two consecutive moves compose", () => {
  const show2: Extract<Action, { kind: "media" }> = { kind: "media", id: "m2", pos: { x: 0, y: 0 } };
  const move1: Extract<Action, { kind: "media_move" }> = { kind: "media_move", id: "m2", to: { x: 1, y: 0 }, durationMs: 1000 };
  const move2: Extract<Action, { kind: "media_move" }> = { kind: "media_move", id: "m2", to: { x: 1, y: 1 }, durationMs: 1000 };

  const afterFirst = mediaStateAt([{ action: show2, p: 1 }, { action: move1, p: 1 }], 0).get("m2")!;
  expect(afterFirst.x).toBeCloseTo(1);

  // move2 only moves y (0 -> 1); x must STAY at 1 throughout. A "wrong origin" bug (chaining
  // off the original pos, x=0) would instead interpolate x partway back toward 0.
  const midSecond = mediaStateAt(
    [{ action: show2, p: 1 }, { action: move1, p: 1 }, { action: move2, p: 0.5 }], 0,
  ).get("m2")!;
  expect(midSecond.x).toBeCloseTo(1);
  expect(midSecond.y).toBeCloseTo(0.5);
});

// --- renderAt integration: media is fold-derived state, not a wall-clock tween -------------
//
// No JSX here deliberately — this file is a .ts module, so CinematicSlide is mounted via
// React.createElement rather than JSX syntax (same pattern as tests/unit/counter-at.test.ts).

const noopRuntime = {
  art: () => {}, applyArt: () => {}, setNightlight: () => {}, onGate: () => {},
  revealArrows: () => {}, pulseArrow: () => {}, onWaiting: () => {},
  resolveEntry: () => [], resolveEnd: () => [], jumpTo: () => {},
};

function mountMediaSlide(timeline: Action[]) {
  const beat: Beat = { id: "media-beat", timeline };
  const { container } = render(
    createElement(CinematicSlide, { slots: { sceneId: "s", beat }, animate: true, runtime: noopRuntime }),
  );
  const host = container.querySelector<HTMLElement & { __renderAt?: (t: number) => void }>(".cin")!;
  return { host, renderAt: (t: number) => host.__renderAt!(t) };
}

// media(600ms default) [0, 0.6) -> media_move(1000ms) [0.6, 1.6)
const showThenMove: Action[] = [
  { kind: "media", id: "m", pos: { x: 0.2, y: 0.3 } },
  { kind: "media_move", id: "m", to: { x: 0.8, y: 0.3 }, durationMs: 1000 },
];

test("BACKWARD SEEK: scrubbing back into an in-flight media_move returns the earlier eased position", () => {
  const { host, renderAt } = mountMediaSlide(showThenMove);
  const tile = () => host.querySelector<HTMLElement>(".cin__media")!;

  renderAt(2.0); // forward, well past media_move's window: settled at the target
  expect(tile().style.left).toBe("80%");

  renderAt(1.1); // BACK into media_move's own in-flight window: local p = (1.1 - 0.6) / 1.0 = 0.5
  expect(parseFloat(tile().style.left)).toBeCloseTo(50, 4); // symmetric in-out: exactly the midpoint of 0.2..0.8
  expect(tile().style.left).not.toBe("80%");
});

// wait(500ms) [0, 0.5) -> media(600ms default) [0.5, 1.1)
const waitThenShow: Action[] = [
  { kind: "wait", ms: 500 },
  { kind: "media", id: "m", pos: { x: 0.2, y: 0.3 } },
];

test("BACKWARD SEEK: scrubbing back before a tile's `media` action tears it down", () => {
  const { host, renderAt } = mountMediaSlide(waitThenShow);

  renderAt(0.8); // inside media's window: tile built
  expect(host.querySelector(".cin__media")).not.toBeNull();

  renderAt(0.2); // BACK before media's own start (0.5): not yet reached
  expect(host.querySelector(".cin__media")).toBeNull();
});
