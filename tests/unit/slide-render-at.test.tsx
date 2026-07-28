import { afterEach, expect, test } from "vitest";
import { createRef } from "react";
import { render, cleanup, act } from "@testing-library/react";
import { CinematicSlide, type SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import { ROTATE_STEP, rotateItemAt } from "@/engine/components/effects/cinematic-anim";
import type { Action, Beat } from "@/engine/deck/types";

const noopRuntime = {
  art: () => {}, applyArt: () => {}, setNightlight: () => {}, onGate: () => {},
  revealArrows: () => {}, pulseArrow: () => {}, onWaiting: () => {},
  resolveEntry: () => [], resolveEnd: () => [], jumpTo: () => {},
};

// CinematicSlide now autoplays (via SlideTransport.play()) as soon as it mounts, driven by a
// REAL gsap.ticker listener — unlike the old escape hatch, that ticker is genuinely live and
// keeps calling renderAt on wall-clock time until paused. Every mounted instance must be
// unmounted between tests (which runs the effect's cleanup → pause()) or its ticker leaks into
// later tests (ambiguity res. #1) — see the mutation check in the task report for proof this
// actually matters.
afterEach(cleanup);

const timeline: Action[] = [
  { kind: "text", value: "first", in: "fade" },
  { kind: "text", value: "second", in: "fade" },
];
const beat: Beat = { id: "b", timeline };

/** Mount and return a handle that exposes renderAt via the real SlideTransport ref (Task 9
 *  replaced the test-only `__renderAt` escape hatch with this). */
function mountSlide() {
  const transport = createRef<SlideTransport>();
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat }} animate runtime={noopRuntime} transport={transport} />,
  );
  const host = container.querySelector<HTMLElement>(".cin")!;
  return { host, transport, renderAt: (t: number) => transport.current!.seek(t) };
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

// --- SlideTransport surface (Task 9) -----------------------------------------------------

test("duration() is the canonical beatDuration, not a GSAP reading", () => {
  const ref = createRef<SlideTransport>();
  render(<CinematicSlide slots={{ sceneId: "s", beat }} animate runtime={noopRuntime} transport={ref} />);
  expect(ref.current!.duration()).toBeCloseTo(1.6, 1);   // two fade lines at 0.8
});

test("seek clamps to [0, duration]", () => {
  const ref = createRef<SlideTransport>();
  render(<CinematicSlide slots={{ sceneId: "s", beat }} animate runtime={noopRuntime} transport={ref} />);
  ref.current!.seek(-5);
  ref.current!.seek(999);              // must not throw
  expect(lineTextAt(document.querySelector(".cin")!)).toEqual(["first", "second"]);
});

test("seek does not throw on a zero-duration/empty beat", () => {
  const ref = createRef<SlideTransport>();
  render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "empty", timeline: [] } }} animate runtime={noopRuntime} transport={ref} />,
  );
  expect(ref.current!.duration()).toBe(0);
  expect(() => ref.current!.seek(5)).not.toThrow();
  expect(() => ref.current!.seek(-5)).not.toThrow();
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
  const transport = createRef<SlideTransport>();
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "c", timeline: clearing } }} animate runtime={noopRuntime} transport={transport} />,
  );
  const host = container.querySelector<HTMLElement>(".cin")!;
  const renderAt = (t: number) => transport.current!.seek(t);

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
  const transport = createRef<SlideTransport>();
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "pf", timeline: posFading } }} animate runtime={noopRuntime} transport={transport} />,
  );
  const renderAt = (t: number) => transport.current!.seek(t);
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

  // Review round 2, test requirement 3: the Task 4 version of this test stopped here — it never
  // scrubbed forward again after the backward seek, so it could not see the round-2 critical bug
  // (stale pre-fade boxes surviving a backward-then-forward round trip across an in-flight
  // fade_out). Extend it, without weakening the assertions above, to close that gap.
  renderAt(2.6);                // FORWARD again, past the fade_out's settlement, into "after"'s window
  expect(boxCount()).toBe(2);   // shared box + rebuilt "after" box — "before"'s box must be gone
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
  const transport = createRef<SlideTransport>();
  render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "a", timeline: tl } }} animate runtime={runtime} transport={transport} />,
  );
  for (const t of [1.0, 1.2, 1.4, 1.6, 1.8, 2.0]) transport.current!.seek(t);
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
  const transport = createRef<SlideTransport>();
  render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "a2", timeline: tl } }} animate runtime={runtime} transport={transport} />,
  );
  transport.current!.seek(1.0);
  expect(calls).toEqual(["art", "night"]);
  transport.current!.seek(0.0); // BACK to before the art/nightlight actions — resetFrom(0) must clear refs
  transport.current!.seek(1.0); // forward again: must re-issue, not skip on a stale "already applied" ref
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
  const transport = createRef<SlideTransport>();
  render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "a3", timeline: tl } }} animate runtime={runtime} transport={transport} />,
  );
  // Every one of these frames re-folds the `clear` at 0.8 (it is at-or-before every t here).
  for (const t of [1.0, 1.2, 1.4, 1.6, 1.8, 2.0]) transport.current!.seek(t);
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
  const transport = createRef<SlideTransport>();
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "cache1", timeline: tl } }} animate runtime={noopRuntime} transport={transport} />,
  );
  const host = container.querySelector<HTMLElement>(".cin")!;
  const renderAt = (t: number) => transport.current!.seek(t);

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
  const transport = createRef<SlideTransport>();
  render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "a4", timeline: tl } }} animate runtime={runtime} transport={transport} />,
  );
  transport.current!.seek(0.1);  // reaches naturalOrder
  transport.current!.seek(0.6);  // reaches reversedOrder — same VALUE as naturalOrder, must be a no-op
  expect(calls).toEqual(["art"]); // fired once, not once per differently-key-ordered-but-equal action
});

// --- review round 2: destructive-boundary round trip ----------------------------------------
//
// The round-1 fix (lastDestructive, a one-way "already torn down" flag) over-corrected: it
// marked a destructive action's teardown "done" the moment it was FIRST reached, even if it was
// still in-flight (not yet settled) at that t. A backward seek landing INSIDE an in-flight
// fade_out's own window then set that stale "done" marker regardless — so a later forward
// re-seek past the fade_out's actual settlement saw "already done" and skipped the real
// teardown, permanently stranding the pre-fade text. review round 2, test requirement 1.
const roundTripFade: Action[] = [
  { kind: "text", value: "before", in: "fade" }, // [0, 0.8)
  { kind: "fade_out" },                           // [0.8, 1.3)
  { kind: "text", value: "after", in: "fade" },  // [1.3, 2.1)
];

test("ROUND TRIP: backward seek into an in-flight fade_out, then forward past settlement, leaves only the post-fade text", () => {
  const transport = createRef<SlideTransport>();
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "rtf", timeline: roundTripFade } }} animate runtime={noopRuntime} transport={transport} />,
  );
  const host = container.querySelector<HTMLElement>(".cin")!;
  const renderAt = (t: number) => transport.current!.seek(t);
  const textAtNow = () => [...host.querySelectorAll("p.cin__line")].map((p) => p.textContent);

  renderAt(2.5);                // forward, past the fade_out, settled into "after"
  expect(textAtNow()).toEqual(["after"]);

  renderAt(1.0);                // BACK, landing INSIDE the fade_out's in-flight window [0.8, 1.3)
  expect(textAtNow()).toEqual(["before"]);

  renderAt(2.6);                // FORWARD again, past the fade_out's actual settlement
  expect(textAtNow()).toEqual(["after"]); // NOT ["before", "after"] — "before" must not survive
});

// Symmetric check for `clear`: since a `clear` is always instantaneous (0 duration), it is
// always "settled" the moment it's reached — there is no in-flight window to land inside, so
// this class of bug cannot manifest for `clear` the same way. Verify rather than assume (review
// round 2, test requirement 2).
const roundTripClear: Action[] = [
  { kind: "text", value: "before", in: "fade" }, // [0, 0.8)
  { kind: "clear" },                              // at 0.8
  { kind: "text", value: "after", in: "fade" },  // [0.8, 1.6)
];

test("ROUND TRIP: backward seek across a `clear`, then forward again, leaves only the post-clear text", () => {
  const transport = createRef<SlideTransport>();
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "rtc", timeline: roundTripClear } }} animate runtime={noopRuntime} transport={transport} />,
  );
  const host = container.querySelector<HTMLElement>(".cin")!;
  const renderAt = (t: number) => transport.current!.seek(t);
  const textAtNow = () => [...host.querySelectorAll("p.cin__line")].map((p) => p.textContent);

  renderAt(1.4);                // forward, past the clear, into "after"
  expect(textAtNow()).toEqual(["after"]);

  renderAt(0.5);                // BACK, to before the clear (clear can only be reached or not — no in-flight state)
  expect(textAtNow()).toEqual(["before"]);

  renderAt(1.5);                // FORWARD again, past the clear once more
  expect(textAtNow()).toEqual(["after"]); // NOT ["before", "after"]
});

// Review round 3: the two ROUND TRIP tests above both involve a backward seek — neither pins
// down the SECOND, independently-discovered variant of the same defect class, which needs no
// backward seek at all. Once a `clear`'s one-time wipe fires, `foldAt` still re-emits the
// pre-clear text action on every LATER forward-only frame (it recomputes from index 0 every
// call); without the `f.index < wipeBoundary` skip-guard, that text gets rebuilt from scratch —
// and, since the wipe already fired once and won't fire again for the same boundary, is never
// removed again, leaking back into the DOM as a second stray line alongside the post-clear text.
// This is a DISTINCT scenario from the ROUND TRIP tests (no `renderAt` call here ever decreases
// t), named accordingly so the two are not mistaken for duplicates.
//
// Uses querySelectorAll (the FULL set of rendered lines), not querySelector (first match only):
// "after" was built first (on the very first forward frame) and stays the first DOM child even
// after "before" leaks back in as a second, later-appended sibling — a first-match assertion
// would keep passing while the bug was live, which is exactly how it escaped round 2's tests.
test("FORWARD-ONLY (no backward seek): scrubbing forward across several frames past a `clear` never re-shows the pre-clear text", () => {
  const tl: Action[] = [
    { kind: "text", value: "before", in: "fade" }, // [0, 0.8)
    { kind: "clear" },                              // at 0.8
    { kind: "text", value: "after", in: "fade" },  // [0.8, 1.6)
  ];
  const transport = createRef<SlideTransport>();
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "fwd-only", timeline: tl } }} animate runtime={noopRuntime} transport={transport} />,
  );
  const host = container.querySelector<HTMLElement>(".cin")!;
  const renderAt = (t: number) => transport.current!.seek(t);
  const allTexts = () => [...host.querySelectorAll("p.cin__line")].map((p) => p.textContent);

  // Every one of these is STRICTLY greater than the previous — never a backward seek.
  for (const t of [1.0, 1.05, 1.1, 1.15, 1.2]) {
    renderAt(t);
    expect(allTexts()).toEqual(["after"]); // NOT ["after", "before"] — "before" must never reappear
  }
});

// --- rotateList: phase is relative to its own start, not absolute t (Task 8/9) --------------
//
// `actionDuration` returns 0 for `rotateList` — it occupies no time on the axis, so `f.p` is
// always 1 the instant it's reached. Its visible item must therefore be derived from
// `t - f.start` (elapsed since ITS OWN start), never from absolute `t` — the design spec (§5)
// says so explicitly, but until now no COMMITTED test pinned it down: task 8's own coverage of
// this was an uncommitted mutation check only, because this file was off-limits at the time.
// It is not off-limits now (task 9 brief, required check 2).
test("rotateList's visible item is measured from its own start, not from absolute t", () => {
  const items = ["alpha", "beta", "gamma"];
  const tl: Action[] = [
    { kind: "wait", ms: 2000 },      // [0, 2.0) — pushes rotateList's own start well past 0
    { kind: "rotateList", items },    // at 2.0 (0 duration — occupies no time on the axis)
    // rotateList contributes 0 duration, so beatDuration (and therefore seek()'s clamp) would
    // otherwise stop at exactly 2.0 — this trailing wait gives the axis room to seek well past
    // rotateList's own start without being clamped back onto it.
    { kind: "wait", ms: 5000 },      // [2.0, 7.0)
  ];
  const transport = createRef<SlideTransport>();
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "rot", timeline: tl } }} animate runtime={noopRuntime} transport={transport} />,
  );
  const host = container.querySelector<HTMLElement>(".cin")!;

  const elapsedSinceStart = ROTATE_STEP * 1.5;   // -> "beta" (see rotate-list-at.test.ts)
  const t = 2.0 + elapsedSinceStart;
  transport.current!.seek(t);
  const slot = host.querySelector<HTMLElement>(".cin__rotslot")!;

  // Sanity: the two candidate elapsed values must actually diverge in which item they pick,
  // or this test would pass regardless of which one renderAt actually uses.
  expect(rotateItemAt(items, t)).not.toBe(rotateItemAt(items, elapsedSinceStart));

  expect(slot.textContent).toBe(rotateItemAt(items, elapsedSinceStart)); // relative — correct
  expect(slot.textContent).not.toBe(rotateItemAt(items, t));             // NOT absolute t
});

// --- gate semantics (Task 9, required check 3 + ambiguity res. #2) --------------------------
//
// These exercise the REAL ticker (gsap.ticker), not a manual renderAt seek — the whole point is
// to prove playback actually pauses at a gate and actually resumes via runtime.onGate, exactly
// as the old per-segment machinery did. That means real wall-clock waits; the timelines below
// use tiny `wait` durations (tens of ms) so the tests stay fast.

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(cond: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: timed out waiting for condition");
    await sleep(5);
  }
}

test("playback pauses at a gate and resumes via the runtime.onGate callback", async () => {
  let resumeFn: (() => void) | null = null;
  let gateCalls = 0;
  let waitingCalls = 0;
  const runtime = {
    ...noopRuntime,
    onGate: (resume: () => void) => { gateCalls++; resumeFn = resume; },
    // The setup effect also calls onWaiting(false) once at mount (before the gate is ever
    // reached) — only count the TRUE call that means "reached the end of the axis".
    onWaiting: (w: boolean) => { if (w) waitingCalls++; },
  };
  const tl: Action[] = [
    { kind: "wait", ms: 20 },   // [0, 0.02)
    { kind: "click_gate" },      // at 0.02
    { kind: "wait", ms: 20 },   // [0.02, 0.04)
  ];
  render(<CinematicSlide slots={{ sceneId: "s", beat: { id: "g1", timeline: tl } }} animate runtime={runtime} />);

  // Autoplay is running (no manual play() call needed) — wait for it to reach and pause at the gate.
  await waitUntil(() => gateCalls === 1);
  expect(waitingCalls).toBe(0); // not yet reached the end

  // Prove it's genuinely PAUSED, not still ticking toward the end — give it more real time.
  await sleep(60);
  expect(gateCalls).toBe(1);
  expect(waitingCalls).toBe(0);

  // Resume via the callback runtime.onGate was handed, exactly as the segment machinery did.
  resumeFn!();
  await waitUntil(() => waitingCalls === 1);
  expect(gateCalls).toBe(1); // never re-triggered
});

test("seeking to a gate's exact time then calling play() does not immediately re-trigger that gate", async () => {
  let gateCalls = 0;
  let waitingCalls = 0;
  const runtime = {
    ...noopRuntime,
    onGate: () => { gateCalls++; },
    // The setup effect also calls onWaiting(false) once at mount (before the gate is ever
    // reached) — only count the TRUE call that means "reached the end of the axis".
    onWaiting: (w: boolean) => { if (w) waitingCalls++; },
  };
  const tl: Action[] = [
    { kind: "wait", ms: 20 },   // [0, 0.02)
    { kind: "click_gate" },      // at 0.02
    { kind: "wait", ms: 20 },   // [0.02, 0.04)
  ];
  const transport = createRef<SlideTransport>();
  render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "g3", timeline: tl } }} animate runtime={runtime} transport={transport} />,
  );
  // Cancel the autoplay ticker before it ticks (no real time has passed yet — this all runs
  // synchronously right after render()), then simulate "paused exactly on the gate": a seek
  // straight to the gate's own start, followed by resuming play() from there.
  transport.current!.pause();
  transport.current!.seek(0.02);
  transport.current!.play();

  // If the "next gate" search used lastT.current >= gate.start instead of >, play() would
  // immediately re-pause on the very gate it just resumed from and deadlock forever — this
  // waitUntil would time out instead of ever seeing waitingCalls reach 1 (ambiguity res. #2).
  await waitUntil(() => waitingCalls === 1);
  expect(gateCalls).toBe(0); // must not pause again on the gate it was already sitting on
});

// --- one-shot side effects: reveal_arrows / pulse_arrow / reveal_again (review round 1) ----
//
// These three were handled by scheduleAction before this task and had NO replacement after it
// deleted — a false premise in the plan's own self-review assumed the forward ticker gave them
// "for free," which is only true of DERIVABLE state (reveal_again), not of genuinely one-shot
// external calls (reveal_arrows/pulse_arrow) that have no readable value to fold over.

test("reveal_arrows and pulse_arrow fire once on a forward scrub across many frames, not once per frame", () => {
  const calls: string[] = [];
  const runtime = {
    ...noopRuntime,
    revealArrows: () => calls.push("arrows"),
    pulseArrow: (which: "next" | "prev", scale: number) => calls.push(`pulse:${which}:${scale}`),
  };
  const tl: Action[] = [
    { kind: "text", value: "x", in: "fade" },          // [0, 0.8)
    { kind: "reveal_arrows" },                          // at 0.8
    { kind: "pulse_arrow", which: "next", scale: 3 },   // at 0.8
    { kind: "wait", ms: 2000 },                         // [0.8, 2.8)
  ];
  const transport = createRef<SlideTransport>();
  render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "arrows1", timeline: tl } }} animate runtime={runtime} transport={transport} />,
  );
  // Every one of these frames re-folds reveal_arrows/pulse_arrow (both at-or-before every t here) —
  // foldAt re-emits every reached action on every call, so without the issued-guard this would
  // fire once PER FRAME, not once total.
  for (const t of [1.0, 1.2, 1.4, 1.6, 1.8, 2.0]) transport.current!.seek(t);
  expect(calls).toEqual(["arrows", "pulse:next:3"]);
});

test("backward seek past reveal_arrows/pulse_arrow, then forward re-crossing, re-fires both", () => {
  const calls: string[] = [];
  const runtime = {
    ...noopRuntime,
    revealArrows: () => calls.push("arrows"),
    pulseArrow: (which: "next" | "prev", scale: number) => calls.push(`pulse:${which}:${scale}`),
  };
  const tl: Action[] = [
    { kind: "reveal_arrows" },                          // at 0
    { kind: "pulse_arrow", which: "next", scale: 3 },   // at 0
    { kind: "wait", ms: 2000 },                         // [0, 2.0)
  ];
  const transport = createRef<SlideTransport>();
  render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "arrows2", timeline: tl } }} animate runtime={runtime} transport={transport} />,
  );
  transport.current!.seek(1.0);
  expect(calls).toEqual(["arrows", "pulse:next:3"]);
  transport.current!.seek(0.0); // BACK to before them — the SAME mechanism appliedArt/appliedNight use
  transport.current!.seek(1.0); // forward again: must re-fire, not skip on a stale "already issued" guard
  expect(calls).toEqual(["arrows", "pulse:next:3", "arrows", "pulse:next:3"]);
});

// reveal_again's effect renders only on the `fin` beat (design: the ending CTA block). Unlike
// reveal_arrows/pulse_arrow, its state IS derivable from the fold (whether reveal_again has been
// reached), so it needs no issued-guard at all — this is demonstrated directly, not assumed:
// hiding on a backward seek and reappearing on forward re-crossing falls out "for free" from
// recomputing it every renderAt call, the same discipline that fixed Task 7's art/nightlight
// round-trip bug. State updates go through React (setAgainRevealed), so each seek is wrapped in
// act() to flush the resulting re-render synchronously before the DOM assertion.
const revealAgainTl: Action[] = [
  { kind: "text", value: "the end", in: "fade" }, // [0, 0.8)
  { kind: "reveal_again" },                        // at 0.8
  { kind: "wait", ms: 2000 },                      // [0.8, 2.8)
];

test("reveal_again is derived fold state: stable across forward frames, hides on backward seek, reshows on forward re-crossing", () => {
  const transport = createRef<SlideTransport>();
  const { container } = render(
    <CinematicSlide slots={{ sceneId: "s", beat: { id: "fin", timeline: revealAgainTl } }} animate runtime={noopRuntime} transport={transport} />,
  );
  const ending = () => container.querySelector(".cin__ending");

  // Forward, past reveal_again: the ending block appears, and stays the SAME DOM node across
  // several later frames — foldAt re-emits reveal_again every call, but React bails out of
  // re-rendering when setAgainRevealed(true) is called with the value already true.
  act(() => { transport.current!.seek(1.0); });
  const first = ending();
  expect(first).not.toBeNull();
  act(() => { transport.current!.seek(1.2); });
  act(() => { transport.current!.seek(1.4); });
  expect(ending()).toBe(first);

  // BACK to before reveal_again: hidden again, with no issued-guard to keep in sync.
  act(() => { transport.current!.seek(0.4); });
  expect(ending()).toBeNull();

  // FORWARD again, re-crossing reveal_again: reappears.
  act(() => { transport.current!.seek(1.0); });
  expect(ending()).not.toBeNull();
});
