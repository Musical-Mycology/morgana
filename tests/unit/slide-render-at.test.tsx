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

const clearing: Action[] = [
  { kind: "text", value: "before", in: "fade" },   // [0, 0.8)
  { kind: "clear" },                                // at 0.8
  { kind: "text", value: "after", in: "fade" },    // [0.8, 1.6)
];

// Structural (text-content-only) check for the clear/rebuild test below: it asserts WHICH
// lines exist after a seek, not their exact in-flight style — style legitimately differs
// between the forward pass and the post-rebuild pass (a freshly built tween restarts its
// own progress ramp), so pinning exact opacity here would over-constrain an otherwise
// correct rebuild. (The shared textAt above intentionally stays style-sensitive — it backs
// the seek-symmetry tests, whose whole point is comparing in-flight tween state.)
const lineTextAt = (host: HTMLElement) =>
  [...host.querySelectorAll("p.cin__line")].map((p) => p.textContent);

test("SEEK SYMMETRY across a clear: seeking back re-shows the cleared line", () => {
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "c", timeline: clearing } }} animate runtime={noopRuntime} />,
  );
  const host = container.querySelector<HTMLElement & { __renderAt?: (t: number) => void }>(".cin")!;
  const renderAt = (t: number) => host.__renderAt!(t);

  renderAt(0.4);
  expect(lineTextAt(host)).toEqual(["before"]);

  renderAt(1.2);                       // past the clear
  expect(lineTextAt(host)).toEqual(["after"]);

  renderAt(0.4);                       // BACK past the clear — must rebuild
  expect(lineTextAt(host)).toEqual(["before"]);
});

// A `pos`-bearing text action gets its OWN wrapper box (via makeLineBox), separate from the
// <p> that buildText's `el` points at. resetFrom must tear down that box too, or every
// backward seek past a boundary strands an empty positioned box in `.cin__stage` — and leaves
// a detached node in lineBoxes.current besides. A scrub bar drags backward constantly, so this
// is the common path, not an edge case.
//
// This must seek back to a t that lands INSIDE an in-flight fade_out (not yet settled): the
// settled fade_out/clear branches call clearLineBoxes() themselves, which would incidentally
// wipe any leaked box and mask the bug. The in-flight branch only sets opacity — it never
// calls clearLineBoxes() — so it is the one path where resetFrom's own box teardown is load-
// bearing, not merely redundant with an unconditional wipe elsewhere.
const posFading: Action[] = [
  { kind: "text", value: "before", in: "fade", pos: { x: 0.1, y: 0.1 } }, // [0, 0.8)
  { kind: "fade_out" },                                                   // [0.8, 1.3)
  { kind: "text", value: "after", in: "fade", pos: { x: 0.1, y: 0.1 } },  // [1.3, 2.1)
];

test("backward seek into an in-flight fade_out does not leak positioned line boxes", () => {
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "pf", timeline: posFading } }} animate runtime={noopRuntime} />,
  );
  const host = container.querySelector<HTMLElement & { __renderAt?: (t: number) => void }>(".cin")!;
  const renderAt = (t: number) => host.__renderAt!(t);
  const stage = container.querySelector<HTMLElement>(".cin__stage")!;
  // Every `.cin__text` box directly under the stage: the one persistent shared box (always
  // present) plus one per still-live `pos`-bearing line box. Should never grow across seeks.
  const boxCount = () => stage.querySelectorAll(".cin__text").length;

  renderAt(2.5);                // forward, past the fade_out, settled into "after"'s window
  expect(boxCount()).toBe(2);   // shared box + "after"'s own box

  renderAt(1.0);                // BACK, landing INSIDE the fade_out's own [0.8, 1.3) window —
                                 // rebuildBoundary finds the fade_out itself (not -1), and the
                                 // fold replays it as in-flight, which never calls clearLineBoxes.
  expect(boxCount()).toBe(2);   // shared box + rebuilt "before" box — no leaked "after" box
});

// --- art / nightlight diffing (Task 7) ------------------------------------------------------
//
// ArtStage.show() runs its own crossfade side effect, so calling applyArt/setNightlight on
// every scrub frame would restart that crossfade continuously. renderAt must issue them only
// when the folded value actually changes across a run of frames — this is the load-bearing
// property this whole task exists to add; see ambiguity resolution #4 in the brief for the
// mutation check that proves this test actually bites.
test("scrubbing within one art window issues no repeated runtime calls", () => {
  const calls: string[] = [];
  const runtime = { ...noopRuntime, applyArt: () => calls.push("art"), setNightlight: () => calls.push("night") };
  const tl: Action[] = [
    { kind: "text", value: "x", in: "fade" },
    { kind: "art", art: { to: "3.02", mode: "fade" } },
    { kind: "nightlight", to: 0.4 },
    { kind: "wait", ms: 2000 },
  ];
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "a", timeline: tl } }} animate runtime={runtime} />,
  );
  const host = container.querySelector<HTMLElement & { __renderAt?: (t: number) => void }>(".cin")!;
  for (const t of [1.0, 1.2, 1.4, 1.6, 1.8, 2.0]) host.__renderAt!(t);
  expect(calls).toEqual(["art", "night"]);   // once each, not once per frame
});

// A backward seek across the destructive boundary (index 0, via resetFrom) must re-issue art
// and nightlight — otherwise ArtStage keeps showing state from a time already left behind
// (ambiguity resolution #3). This is the part the brief's own pseudocode can't verify by
// inspection: it proves resetFrom's ref-clearing actually fires on a real backward seek, not
// just that the diffing guard exists.
test("backward seek past the reset boundary re-issues art and nightlight", () => {
  const calls: string[] = [];
  const runtime = { ...noopRuntime, applyArt: () => calls.push("art"), setNightlight: () => calls.push("night") };
  const tl: Action[] = [
    { kind: "art", art: { to: "3.02", mode: "fade" } },
    { kind: "nightlight", to: 0.4 },
    { kind: "wait", ms: 2000 },
  ];
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "a2", timeline: tl } }} animate runtime={runtime} />,
  );
  const host = container.querySelector<HTMLElement & { __renderAt?: (t: number) => void }>(".cin")!;
  host.__renderAt!(1.0);
  expect(calls).toEqual(["art", "night"]);
  host.__renderAt!(0.0); // BACK to before the art/nightlight actions — resetFrom(0) must clear refs
  host.__renderAt!(1.0); // forward again: must re-issue, not skip on a stale "already applied" ref
  expect(calls).toEqual(["art", "night", "art", "night"]);
});
