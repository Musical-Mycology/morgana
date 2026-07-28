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

// Review round 1, Finding 1 (Critical): foldAt recomputes ALL reached actions from index 0 on
// every renderAt call — a `clear` at or before t is re-folded on every forward frame, not just
// once. The `clear` branch calls resetFrom(0) every time it is re-folded; a prior (buggy) version
// of the art/nightlight diffing guard nulled appliedArt/appliedNight inside resetFrom itself,
// which meant ANY beat with an art/nightlight action after a `clear` re-issued on every single
// forward frame — exactly the crossfade-restart-per-frame bug this task exists to prevent.
// Clearing text has no bearing on what art is on screen; only an actual backward seek should
// invalidate already-issued art/nightlight state.
test("art/nightlight after a `clear` are issued once, not re-issued on every forward frame", () => {
  const calls: string[] = [];
  const runtime = { ...noopRuntime, applyArt: () => calls.push("art"), setNightlight: () => calls.push("night") };
  const tl: Action[] = [
    { kind: "text", value: "x", in: "fade" },                    // [0, 0.8)
    { kind: "clear" },                                            // at 0.8
    { kind: "art", art: { to: "3.02", mode: "fade" } },           // at 0.8
    { kind: "nightlight", to: 0.4 },                              // at 0.8
    { kind: "wait", ms: 2000 },                                   // [0.8, 2.8)
  ];
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "a3", timeline: tl } }} animate runtime={runtime} />,
  );
  const host = container.querySelector<HTMLElement & { __renderAt?: (t: number) => void }>(".cin")!;
  // Every one of these frames re-folds the `clear` at 0.8 (it is at-or-before every t here).
  for (const t of [1.0, 1.2, 1.4, 1.6, 1.8, 2.0]) host.__renderAt!(t);
  expect(calls).toEqual(["art", "night"]);   // once each, not once per frame past the clear
});

// Review round 1, Finding 3: the same unconditional resetFrom(0) call in the `clear` branch
// tears down EVERY entry in the `built` text cache (not just art/nightlight refs) on every
// forward frame that re-folds a `clear` — which is every frame from the clear onward, for the
// rest of the beat. That makes the `built` cache (the whole point of which is to avoid rebuilding
// a text action's GSAP timeline / SplitText instance every frame — design spec §7b §4.2) inert
// for any beat containing a `clear`. Confirmed empirically before this fix: with instrumentation,
// two consecutive renderAt calls landing in the SAME text action's in-flight window (after a
// clear) produced two DIFFERENT <p> DOM node instances — a fresh rebuild each call. This test
// pins that down via DOM node identity (not text content, which would be identical either way).
test("BUILD CACHE: text after a `clear` is built once, not rebuilt on every re-fold of the clear", () => {
  const tl: Action[] = [
    { kind: "text", value: "before", in: "fade" }, // [0, 0.8)
    { kind: "clear" },                              // at 0.8
    { kind: "text", value: "after", in: "fade" },  // [0.8, 1.6)
  ];
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "cache1", timeline: tl } }} animate runtime={noopRuntime} />,
  );
  const host = container.querySelector<HTMLElement & { __renderAt?: (t: number) => void }>(".cin")!;
  const renderAt = (t: number) => host.__renderAt!(t);

  renderAt(1.0);                                   // inside "after"'s in-flight window
  const first = host.querySelector("p.cin__line");
  renderAt(1.05);                                  // still inside the SAME window — no new action reached
  const second = host.querySelector("p.cin__line");
  expect(second).toBe(first); // same DOM node instance: the cached build survived the re-fold
});

// Review round 1, Finding 2: the diffing key must not depend on the ArtTransition object's own
// property INSERTION ORDER. `lib/editor/paths.ts`'s `setPath()` shallow-spreads `{...obj}` then
// assigns the edited field, so a field set for the first time lands at the END of key order —
// two value-identical transitions authored via a different edit sequence can end up with
// different insertion order despite having identical field values. A raw
// `JSON.stringify(transition)` key would treat those as "different" and spuriously re-fire.
// Simulate that here with two `art` actions holding the SAME values but built with `to`/`mode`
// declared in reversed order (mimicking two different edit histories reaching the same value).
test("art diffing key is independent of the transition object's own key insertion order", () => {
  const calls: string[] = [];
  const runtime = { ...noopRuntime, applyArt: () => calls.push("art") };
  const naturalOrder: Action = { kind: "art", art: { to: "3.02", mode: "fade" } };     // to, mode
  const reversedOrder: Action = { kind: "art", art: { mode: "fade", to: "3.02" } };    // mode, to — same values
  const tl: Action[] = [
    naturalOrder,                    // at 0
    { kind: "wait", ms: 500 },       // [0, 0.5)
    reversedOrder,                   // at 0.5 — value-identical to naturalOrder, different key order
    { kind: "wait", ms: 500 },       // [0.5, 1.0)
  ];
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "a4", timeline: tl } }} animate runtime={runtime} />,
  );
  const host = container.querySelector<HTMLElement & { __renderAt?: (t: number) => void }>(".cin")!;
  host.__renderAt!(0.1);  // reaches naturalOrder
  host.__renderAt!(0.6);  // reaches reversedOrder — same VALUE as naturalOrder, must be a no-op
  expect(calls).toEqual(["art"]); // fired once, not once per differently-key-ordered-but-equal action
});
