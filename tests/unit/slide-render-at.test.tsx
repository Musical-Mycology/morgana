import { expect, test } from "vitest";
import { render } from "@testing-library/react";
import { CinematicSlide } from "@/engine/components/layouts/CinematicSlide";
import type { Action, Beat } from "@/engine/deck/types";

const noopRuntime = {
  art: () => {}, applyArt: () => {}, setNightlight: () => {}, onGate: () => {},
  revealArrows: () => {}, pulseArrow: () => {}, onWaiting: () => {},
  resolveEntry: () => [], resolveEnd: () => [], jumpTo: () => {},
};

const timeline: Action[] = [
  { kind: "text", value: "first", in: "fade" },
  { kind: "text", value: "second", in: "fade" },
];
const beat: Beat = { id: "b", timeline };

/** Mount and return a handle that exposes renderAt via the transport ref (Task 9)
 *  — until then, via the test-only `__renderAt` escape hatch on the DOM node. */
function mountSlide() {
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat }} animate runtime={noopRuntime} />,
  );
  const host = container.querySelector<HTMLElement & { __renderAt?: (t: number) => void }>(".cin")!;
  return { host, renderAt: (t: number) => host.__renderAt!(t) };
}

// Compares text content AND the inline style GSAP writes as it seeks (opacity, transform,
// etc.) — text-only would still pass if every .time()/.progress() call were a no-op, as
// long as element order matched. That's exactly the divergence seek symmetry must rule out.
const textAt = (host: HTMLElement) =>
  [...host.querySelectorAll("p.cin__line")].map((p) => [p.textContent, p.getAttribute("style")]);

test("renderAt is deterministic: the same t twice yields the same DOM", () => {
  const { host, renderAt } = mountSlide();
  renderAt(1.0);
  const once = host.innerHTML;
  renderAt(1.0);
  expect(host.innerHTML).toBe(once);
});

test("SEEK SYMMETRY: forward play, backward seek, and direct jump agree at the same t", () => {
  const target = 1.0;

  const fwd = mountSlide();
  for (const t of [0, 0.25, 0.5, 0.75, target]) fwd.renderAt(t);

  const back = mountSlide();
  back.renderAt(1.8);
  back.renderAt(target);

  const jump = mountSlide();
  jump.renderAt(target);

  expect(textAt(back.host)).toEqual(textAt(fwd.host));
  expect(textAt(jump.host)).toEqual(textAt(fwd.host));
});

// A pure path-symmetry check can pass even if seeking is a total no-op: if every render
// converges on the same (wrong, un-advanced) DOM regardless of path, "they all agree" is
// true but vacuous. This test pins down that renderAt actually moves the paused timeline
// by comparing two different in-flight times *within the same action's window* (both calls
// land on "first" only — its [0, 0.8) window — so no new element ever appears between them;
// the only thing that can make the two snapshots differ is the tween's progress).
test("renderAt actually advances the paused timeline (not a no-op)", () => {
  const { host, renderAt } = mountSlide();
  renderAt(0.1);
  const early = textAt(host);
  renderAt(0.7);
  const late = textAt(host);
  expect(late).not.toEqual(early);
});
