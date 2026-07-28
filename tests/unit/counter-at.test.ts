import { expect, test } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { counterValueAt, formatCounterValue } from "@/engine/deck/counter";
import { CinematicSlide } from "@/engine/components/layouts/CinematicSlide";
import type { Action, Beat } from "@/engine/deck/types";

test("counterValueAt eases from `from` to `to` across local progress", () => {
  expect(counterValueAt(0, 100, 0)).toBeCloseTo(0);
  expect(counterValueAt(0, 100, 1)).toBeCloseTo(100);
  // power2.out: fast start, so the midpoint is past halfway.
  expect(counterValueAt(0, 100, 0.5)).toBeGreaterThan(50);
});

test("counterValueAt is exact at the endpoints regardless of easing", () => {
  expect(counterValueAt(42, 42, 0.37)).toBeCloseTo(42);
});

// --- renderAt integration: counters are fold-derived state, not a wall-clock tween --------
//
// No JSX here deliberately — this file is a .ts module (not .tsx), so CinematicSlide is
// mounted via React.createElement rather than JSX syntax.

const noopRuntime = {
  art: () => {}, applyArt: () => {}, setNightlight: () => {}, onGate: () => {},
  revealArrows: () => {}, pulseArrow: () => {}, onWaiting: () => {},
  resolveEntry: () => [], resolveEnd: () => [], jumpTo: () => {},
};

/** Mount and return a handle that exposes renderAt via the test-only `__renderAt` escape
 *  hatch on the DOM node (same pattern as tests/unit/slide-render-at.test.tsx). */
function mountCounterSlide(timeline: Action[]) {
  const beat: Beat = { id: "counter-beat", timeline };
  const { container } = render(
    createElement(CinematicSlide, { slots: { sceneId: "s", beat }, animate: true, runtime: noopRuntime }),
  );
  const host = container.querySelector<HTMLElement & { __renderAt?: (t: number) => void }>(".cin")!;
  return { host, renderAt: (t: number) => host.__renderAt!(t) };
}

const counterValueText = (host: HTMLElement) =>
  host.querySelector(".cin__counter-value")?.textContent ?? null;

// counter_show's actionDuration is 0.4s → window [0, 0.4). counter_to defaults to 800ms →
// window [0.4, 1.2), starting from counter_show's value (0).
const counting: Action[] = [
  { kind: "counter_show", pos: { x: 0.5, y: 0.5 }, value: 0 },
  { kind: "counter_to", value: 100 },
];

test("renderAt paints the counter's settled value exactly, from the fold — not a tween", () => {
  const { host, renderAt } = mountCounterSlide(counting);
  renderAt(1.2); // past counter_to's window: settled
  expect(counterValueText(host)).toBe(formatCounterValue(100));
});

test("renderAt paints an in-flight counter_to eased partway between `from` and `to`", () => {
  const { host, renderAt } = mountCounterSlide(counting);
  renderAt(0.8); // inside counter_to's [0.4, 1.2) window: local p = (0.8 - 0.4) / 0.8 = 0.5
  const expected = formatCounterValue(counterValueAt(0, 100, 0.5));
  expect(counterValueText(host)).toBe(expected);
  expect(counterValueText(host)).not.toBe(formatCounterValue(100));
  expect(counterValueText(host)).not.toBe(formatCounterValue(0));
});

// BACKWARD SEEK (ambiguity resolution #4): because the counter is recomputed from the fold
// on every renderAt call rather than carried as tween state, seeking backward past a settled
// counter_to must land back on the earlier, still-eased value — not stay stuck at the target.
test("BACKWARD SEEK: scrubbing back past a settled counter_to returns the earlier value", () => {
  const { host, renderAt } = mountCounterSlide(counting);

  renderAt(1.2); // forward, past counter_to — settled at 100
  expect(counterValueText(host)).toBe(formatCounterValue(100));

  renderAt(0.5); // BACK into counter_to's own in-flight window: local p = (0.5 - 0.4) / 0.8 = 0.125
  const expected = formatCounterValue(counterValueAt(0, 100, 0.125));
  expect(counterValueText(host)).toBe(expected);
  expect(counterValueText(host)).not.toBe(formatCounterValue(100));
});
