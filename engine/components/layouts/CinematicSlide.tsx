"use client";

import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { ArtAsset, ArtMode, ArtTransition, CinematicSlideSlots, Action, ClipOpts, TextIn, TextSize, TextAlign, StagePoint, SlideTheme, PanelSpec, Framing } from "@/engine/deck/types";
import type { DeckChrome } from "@/engine/deck-doc";
import { isMediaRef, isVideoRef, type MediaRef } from "@/engine/deck/media-ref";
import { clipTimeAt } from "@/engine/deck/clip-clock";
import { createClipVideo, MIN_VIDEO_OPACITY, releaseVideo, syncVideo, type ClipMode } from "@/engine/components/video-sync";
import { renderPanelHTML } from "@/engine/deck/panel";
import { useAssetResolver } from "@/engine/asset-resolver-react";
import { TEXT_SIZES, CURSIVE_SIZE, DEFAULT_TEXT_POS } from "@/engine/deck/cinematic-style";
import { parseInlineLinks, hasInlineMarkup } from "@/engine/deck/inline-links";
import { formatCounterValue, counterValueAt } from "@/engine/deck/counter";
import { mediaStateAt, type MediaFold, type MediaRenderState } from "@/engine/deck/media-state";
import {
  flyUp, fadeIn, fadeSide, dotFade, rotateItemAt, lineAndDots,
  letterFly, letterUp, wordUp, blurIn, typewriter, drawIn,
} from "../effects/cinematic-anim";
import { DRAW_DASH_EM, DRAW_STROKE_EM, DRAW_VARIANT, drawText, isDrawnLine } from "../effects/draw-state";
import { foldAt, rebuildBoundary, beatTimeline, beatDuration } from "@/engine/authoring/beat-clock";
import { cameraAt, cameraTransform, FULL_FRAME, type CameraEvent } from "@/engine/authoring/camera-clock";
import { particleOpts, textSourceEnd, textSourceIdx, type TextRect, type TextSource } from "../effects/note-state";
import { atRestRects, restLine, wrapWords, type RestChild } from "../text-sources";

/**
 * Position a text box at `pos` per its align. Right boxes anchor their RIGHT edge (via the
 * `right` property) rather than left + translateX(-100%) — otherwise `left:pos.x` would cap
 * the auto width at (stage − pos.x), shrinking a right-placed box. This gives right the same
 * usable width as left. (Center keeps left+translate; only `right` needed fixing.)
 */
function boxAnchor(pos: StagePoint, align?: TextAlign): { left: string; right: string; transform: string } {
  if (align === "right") return { left: "", right: `${(1 - pos.x) * 100}%`, transform: "" };
  if (align === "center") return { left: `${pos.x * 100}%`, right: "", transform: "translateX(-50%)" };
  return { left: `${pos.x * 100}%`, right: "", transform: "" };
}

/** Stable dedup key for an ArtTransition, for renderAt's applied-art diffing (below). Built from
 *  an EXPLICIT, fixed field order — NOT `JSON.stringify(transition)` directly, whose output
 *  depends on the object's own property insertion order. Review round 1, finding 2:
 *  `lib/editor/paths.ts`'s `setPath()` shallow-spreads `{...obj}` then assigns the edited field,
 *  so a field set for the first time (e.g. `durationMs`) lands at the END of insertion order —
 *  two value-identical transitions edited in a different order would otherwise serialise
 *  differently and spuriously re-trigger ArtStage's crossfade. `clips` is serialised the same
 *  way: refs sorted, each with a fixed [in, loop] pair.
 *  Nothing checks this list: tsc does NOT flag a new ArtTransition field missing from it. A field
 *  left out makes two transitions that differ only in it dedupe as one, so when ArtTransition
 *  gains a field, add it here. */
function artKey(a: ArtTransition): string {
  const clips = a.clips
    ? (Object.keys(a.clips) as MediaRef[]).sort().map((ref) => [ref, a.clips![ref]?.in ?? null, a.clips![ref]?.loop ?? null])
    : null;
  return JSON.stringify([a.to, a.mode, a.durationMs ?? null, a.keep ?? null, a.out ?? null, clips]);
}


export interface CinematicRuntime {
  /** Cross-fade to an absolute layer set (entry transitions). `clips`: in-points/loop for media
   *  refs the transition brings in. */
  art(layers: ArtAsset[], mode: ArtMode, durationMs?: number, clips?: ArtTransition["clips"]): void;
  /** Fold one transition onto the live stack (mid-timeline art actions). */
  applyArt(transition: ArtTransition, durationMs?: number): void;
  setNightlight(to: number, ms?: number): void;
  /** Beat hit a click_gate: it's paused; `resume` continues this beat's timeline. */
  onGate(resume: () => void): void;
  /** Spawn (fade in) the nav arrows (reveal_arrows action). */
  revealArrows(): void;
  /** One-time pulse of one arrow to `scale`× then back to small (pulse_arrow action). */
  pulseArrow(which: "next" | "prev", scale: number): void;
  onWaiting(waiting: boolean): void;
  /** Entry-state layers for this beat (before its mid-timeline art). */
  resolveEntry(): ArtAsset[];
  /** End-state layers for this beat (after all its art ops) — for PDF/static. */
  resolveEnd(): ArtAsset[];
  /** Jump to a 0-based slide index (inline jump links). */
  jumpTo(index: number): void;
}

/** The public seekable transport over a beat's single time axis (design spec §7b §4.1).
 *  `seek` clamps to `[0, duration()]` and never throws, including on a zero-duration/empty
 *  beat. `duration()` is always `beatDuration(beat.timeline)` — the pure beat-clock reading,
 *  never a GSAP timeline's own `.duration()`. */
export interface SlideTransport {
  /** `clipT` (optional): the UNCLAMPED elapsed beat-local time, used only as media tiles' clip
   *  clock. A host past the beat's end (a pinned scene's hold, where `t` stays at duration())
   *  passes it so tile clips keep running like art layers do. Defaults to the clamped `t`. */
  seek(t: number, clipT?: number): void;
  play(): void;
  pause(): void;
  duration(): number;
  /** Resolves once this beat's text-particle word boxes (and credit block heights) for the current
   *  DOM are measured and the host re-notified (spec §2 "Readiness"). /render awaits it per frame. */
  sourcesReady(): Promise<void>;
}

interface Props {
  slots: CinematicSlideSlots;
  animate: boolean;
  runtime: CinematicRuntime;
  /** Optional host-app chrome (splash, fin CTAs, wordmark). Generic by default (no chrome). */
  chrome?: DeckChrome;
  /** True when rendering for PDF print — suppresses screenOnly text actions. */
  print?: boolean;
  /** Investor deck: render narration text instantly (no per-line entrance animation).
   *  click_gates still step the timeline; only the text-in reveal is suppressed. */
  instantText?: boolean;
  /** Imperative handle onto this beat's transport — seek/play/pause/duration over the single
   *  time axis (design spec §7b §4.1). Optional: most callers just let it autoplay. */
  transport?: Ref<SlideTransport>;
  /** Fired at the end of every renderAt call with the beat-local `t` just painted (design spec
   *  §7b Task 10). This is the single clock: a host that also drives sibling stages (notes,
   *  objects) reads THIS `t` — never a second ticker — so every stage stays paused/playing/
   *  seeked in lockstep, including across click_gate pauses. */
  onTime?: (t: number) => void;
  /** false = never start the autoplay ticker on mount; the host drives time via
   *  `transport.seek` (the timed Player). Host-driven: the host paints art + nightlight from
   *  art-clock, so this slide never calls runtime.art/applyArt/setNightlight. Default true. */
  autoplay?: boolean;
  /** The host's clip mode for this beat's video tiles, read at paint time (a ref, so a mode
   *  change never re-renders the slide). Undefined = autoplay: "play". Consumed by media tiles. */
  clipModeRef?: React.RefObject<ClipMode>;
  /** Host-driven camera: the framing at the deck time being painted, read at paint time (a ref,
   *  so a framing change never re-renders the slide). Painted on `.cin__world` (the media tiles);
   *  the text stage never moves. Wins over `camera`. */
  cameraRef?: React.RefObject<Framing>;
  /** Autoplay camera (no deck clock): the deck's camera events and this beat's deck start, so
   *  the framing at beat-local `t` is `cameraAt(events, beatStart + t)`. Ignored when
   *  `cameraRef` is set; with neither, the world stays at FULL_FRAME. */
  camera?: BeatCamera;
  /** Where measured text-particle sources are published (BeatStage hands NoteField them). Written on
   *  each layout change, after document.fonts.ready; never per frame. */
  textSourcesRef?: React.MutableRefObject<TextSource[]>;
}

/** A beat's view of the deck camera for autoplay: the deck's events and the beat's deck start. */
export interface BeatCamera { events: CameraEvent[]; beatStart: number }

/** The framing to paint at beat-local `t`: the host's ref when given, else the autoplay events. */
export function beatFraming(t: number, cameraRef?: React.RefObject<Framing>, camera?: BeatCamera): Framing {
  return cameraRef?.current ?? (camera ? cameraAt(camera.events, camera.beatStart + t) : FULL_FRAME);
}

export function CinematicSlide({ slots, animate, runtime, chrome, print, instantText, transport, onTime, autoplay = true, clipModeRef, cameraRef, camera, textSourcesRef }: Props) {
  const assets = useAssetResolver();
  const scope = useRef<HTMLDivElement>(null);
  // The single gsap.ticker listener currently driving playback, or null when paused. play()
  // always pause()s first (so re-play never double-registers), and pause() nulls this after
  // removing it — ambiguity res. #1: a leaked ticker keeps calling renderAt against a stale
  // beat after the component moves on, and unlike a leaked tween, nothing else will kill it.
  const ticker = useRef<((time: number, delta: number) => void) | null>(null);
  const lineBoxes = useRef<HTMLElement[]>([]); // free-positioned per-line text boxes (text action `pos`)
  const currentLine = useRef<HTMLElement | null>(null); // last line, for inline `append` fragments
  const fadeRef = useRef<gsap.core.Tween | null>(null); // active fade_out tween, killed on beat change
  // `a` is the counter_show action that built this box — renderAt compares against it (by
  // reference) to know whether the fold's current counter is the one already on screen, or
  // whether it needs to rebuild (design spec §7b §5).
  const counterRef = useRef<{ box: HTMLElement; valueEl: HTMLElement; prefix: string; a: Extract<Action, { kind: "counter_show" }> } | null>(null);
  const mediaTiles = useRef<Map<string, HTMLElement>>(new Map());
  // Autoplay looping tile clips: each one's `ended` listener plus the clip options it loops by
  // (updated every paint). The ticker stops at click_gates / the beat end, so per-frame drift
  // correction alone can't loop a clip there. Host-driven / static tiles never get one.
  const tileLoops = useRef<Map<HTMLVideoElement, { onEnded: () => void; clip?: ClipOpts }>>(new Map());
  // True while this beat is in static mode (no ticker: animate=false / hidden-tab autoplay):
  // tiles are then painted in "seek" mode — one exact frame, never left playing uncorrected.
  const staticRef = useRef(false);
  // Built, PAUSED effect timelines keyed by action index. Nothing here ever runs on
  // wall-clock — renderAt is the only thing that advances them (design spec §7b §4.2).
  // `box` is set only for a `pos`-bearing text action: the separate wrapper div makeLineBox()
  // creates (distinct from `el`, the <p> inside it). resetFrom must tear both down, or a
  // backward seek strands an empty positioned box in the stage (and a detached node in
  // lineBoxes.current) every time it lands inside an in-flight fade_out.
  const built = useRef<Map<number, { el: HTMLElement; tl: gsap.core.Timeline | null; box?: HTMLElement }>>(new Map());
  // Last-issued art transition (JSON of its ArtTransition, since object identity changes every
  // render) and nightlight target. Autoplay only (host-driven stages never call into the runtime
  // for art/nightlight). ArtStage.apply() runs its own crossfade as a side effect on a SIBLING
  // component, and the fold re-emits the reached action on every ticker frame — re-issuing it
  // each frame would restart that crossfade continuously, so renderAt's fold loop below only
  // calls into the runtime when the folded value actually differs from what was last issued
  // (design spec §7b §7, ambiguity res. #1).
  // Cleared ONLY on an actual backward seek (the `t < lastT.current` preamble in renderAt), never
  // by resetFrom / a re-folded `clear` — review round 1 finding 1: `clear` wiping text has no
  // bearing on what art is on screen, and foldAt re-emits every reached action (including
  // `clear`) on EVERY forward frame, so nulling these refs from inside resetFrom re-fired
  // art/nightlight once per frame for any beat with art/nightlight after a `clear`.
  const appliedArt = useRef<string | null>(null);
  const appliedNight = useRef<number | null>(null);
  // Fold indices of already-issued one-shot runtime side effects (reveal_arrows, pulse_arrow —
  // review round: these have no natural "value" to diff against the way art/nightlight do, so
  // they're guarded by INDEX instead of value, but otherwise reuse the exact same mechanism:
  // cleared on a new beat and on any backward seek (never by resetFrom / a re-folded destructive
  // action), so foldAt re-emitting the same reached action on every forward frame fires it only
  // once, while a backward-seek-then-forward-re-crossing correctly re-fires it. `reveal_again` is
  // NOT tracked here — its effect is derivable state (see renderAt), not a one-shot call.
  const firedOnce = useRef<Set<number>>(new Set());
  // The `wipeBoundary` (see renderAt) computed as of the END of the PREVIOUS renderAt call —
  // i.e. the index of the last destructive action (clear / settled fade_out) whose full wipe
  // (resetFrom(0) + host.innerHTML="") is already reflected in the DOM. renderAt recomputes
  // wipeBoundary FRESH from `t` on every call (forward or backward) and compares it against this
  // ref to decide whether a NEW wipe is needed, then unconditionally resyncs it to the fresh
  // value. That resync (not a one-way "mark done and never look back" flag) is what makes a
  // backward-seek-then-forward-again round trip re-trigger the wipe correctly — review round 2's
  // critical finding was exactly a version of this ref that only ever moved forward, which a
  // backward seek into an in-flight `fade_out` (still not settled, so no wipe should have counted
  // as done yet) left stuck past where it should have re-armed.
  const lastDestructive = useRef(-1);
  const lastT = useRef(0);
  // Text-source measurement (sub-project 6). layoutRev bumps on every build/wipe; a renderAt that sees
  // it ahead of measuredRev queues one measurement behind fonts.ready. measureGen invalidates a
  // measurement queued by a previous beat (or before unmount): Review Focus #1.
  const layoutRev = useRef(0);
  const measuredRev = useRef(-1);
  const measureGen = useRef(0);
  const measureQueued = useRef(false);
  const pendingSources = useRef<Promise<void>>(Promise.resolve());
  // The camera's world layer (media tiles) and the last transform written to it ("none" = the
  // initial, untransformed full frame, so a deck with no camera never writes it at all).
  const world = useRef<HTMLDivElement>(null);
  const lastCamera = useRef("none");
  const [againRevealed, setAgainRevealed] = useState(false);

  useGSAP(() => {
    const host = scope.current;
    if (!host) return;
    const textHost = host.querySelector<HTMLElement>(".cin__text")!;
    // useGSAP defers context cleanup to unmount (not dependency change), so stop the
    // previous beat's ticker explicitly to avoid a zombie ticker driving renderAt against
    // stale refs after the new beat's setup below resets them.
    pause();
    fadeRef.current?.kill();
    fadeRef.current = null;
    built.current.forEach((entry) => entry.tl?.kill());
    built.current.clear();
    // A new beat starts with nothing yet issued to the runtime and nothing yet destructively
    // wiped, regardless of what the PREVIOUS beat last applied — otherwise a new beat whose
    // first mid-timeline art/nightlight action happens to match the previous beat's last-issued
    // value would be (wrongly) skipped as a no-op diff.
    appliedArt.current = null;
    appliedNight.current = null;
    firedOnce.current.clear();
    lastDestructive.current = -1;
    lastT.current = 0;
    measureGen.current++;
    measureQueued.current = false;
    layoutRev.current++;
    pendingSources.current = Promise.resolve();
    if (textSourcesRef) textSourcesRef.current = [];
    clearLineBoxes();
    clearCounter();
    clearMedia();
    textHost.innerHTML = "";
    gsap.set(textHost, { clearProps: "opacity" }); // a leaked fade_out must never leave the box invisible
    runtime.onWaiting(false);
    setAgainRevealed(false); // re-hide; an animated reveal_again (or the static path) re-shows it

    // Static end-state — used for PDF, reduced motion, AND a hidden/backgrounded tab
    // (rAF is paused there, so animated tweens — including SplitText letter effects —
    // would be stuck invisible). Show end art + all text at rest, then wait.
    // The hidden-tab case applies ONLY to autoplay: a host-driven stage (the timed Player)
    // paints every frame from transport.seek, so it must keep seek-driven rendering even when
    // it mounts in a background tab — otherwise it would mount at the end state and later
    // seeks would never restore the entry text (design spec §10 "static mode at mount").
    const staticMode = !animate || (autoplay && document.visibilityState !== "visible");
    staticRef.current = staticMode;
    if (staticMode) {
      // Establish the FULL, self-contained end-state art stack directly (design spec §7b §7,
      // ambiguity res. #3): resolveEnd() folds this beat's entry op AND every one of its
      // mid-timeline `art` actions across the WHOLE deck from beat 0 — unlike the non-static
      // path below (which folds incrementally onto ArtStage's own carried-over live stack,
      // valid only because live playback always visits beats in sequence), static mode may be
      // the very first (and only) render of this beat's CinematicSlide instance — e.g. a PDF
      // page for beat 5 with beats 0-4 never mounted in this component tree — so it cannot rely
      // on any prior beat having primed ArtStage's live stack. `renderAt(duration())` below
      // still re-reaches this beat's own mid-timeline `art`/`nightlight` actions and re-issues
      // them through the normal applyArt/setNightlight diffing path — a genuine double-issue,
      // REDUNDANT AND HARMLESS ONLY BECAUSE no mid-timeline `art` action in this codebase today
      // uses `keep`/`out`: applyArt with no `keep`/`out` unconditionally discards its input and
      // resets to exactly `[...to]`, so re-folding it onto the already-resolved stack still
      // converges to the same layers `resolveEnd()` already painted. THE INSTANT a beat's
      // mid-timeline `art` action carries `keep` or `out`, this guarantee breaks: `keep`/`out`
      // filter against whatever stack they're handed, and this redundant call hands them the
      // ALREADY-FULLY-RESOLVED end stack rather than the true pre-transition stack `resolveEnd`'s
      // own fold used — risking duplicate layer entries or a wrong final composition. Revisit
      // this branch (e.g. suppress renderAt's art/nightlight dispatch for this one static call)
      // if/when a `keep`/`out` mid-timeline `art` action is authored anywhere (see task 11
      // report — flagged and deferred, not fixed, per the brief's literal replacement).
      if (autoplay) runtime.art(runtime.resolveEnd(), "cut"); // host-driven: the host paints art + nightlight from art-clock
      // The settled state IS the fold at the end of the axis: every action kind (text, clear,
      // fade_out, counters, media, art, nightlight, rotateList, reveal_again, the one-shot
      // arrows/pulse calls) already renders correctly from renderAt(t) — Tasks 5-8 built exactly
      // that. Folding to `duration()` in one call reaches every action fully settled, so this
      // replaces the old hand-written replay loop with no behaviour left to hand-maintain here.
      renderAt(duration());
      runtime.onWaiting(true);
      // Task 9 review finding 2: `play()` is now externally reachable via `transport` — before
      // this task, nothing outside this effect could ever start a ticker in static mode, so no
      // cleanup was needed here. That's no longer true (even though no production caller does
      // this yet — Task 10 wires one), so this branch needs the same pause()-on-unmount/rerun
      // guarantee the non-static branch has below. renderAt() itself never starts a ticker (only
      // play() does), so this stays synchronous and one-shot; pause() here is just symmetry with
      // the non-static branch's cleanup, guarding against any future caller reaching `transport`.
      return () => { measureGen.current++; pause(); };
    }

    // Entry art: resolveEntry() already folds this beat's entry transition, so show
    // it as an absolute cross-fade using the entry op's mode. Autoplay visits beats strictly in
    // order, so a beat with no `art` op of its own relies on ArtStage's live stack already holding
    // the art it inherits. Host-driven: the host paints art + nightlight from art-clock.
    if (autoplay && slots.beat.art) runtime.art(runtime.resolveEntry(), slots.beat.art.mode, slots.beat.art.durationMs, slots.beat.art.clips);

    // Autoplay from t=0 — observable behaviour is unchanged from the old per-segment
    // machinery (design spec §7b §4.4): a ticker now drives the single time axis instead of
    // N GSAP timelines, pausing at each click_gate and handing `resume` to runtime.onGate,
    // exactly as the segment machinery did. Most callers (today) never touch `transport` at
    // all; the ref just gives a scrubber somewhere to grab onto later.
    if (autoplay) play();
    else renderAt(0); // host-driven: paint t=0 and wait for transport.seek

    // built effect timelines are created here / in deferred callbacks; kill them on unmount
    // (deps re-run also kills them at the top of the effect above). The ticker itself is
    // stopped via pause() — critical: gsap.ticker.add has no other owner, so a beat change or
    // unmount that forgets this leaves a zombie ticker calling renderAt forever (ambiguity
    // res. #1).
    return () => {
      measureGen.current++;
      pause();
      built.current.forEach((entry) => entry.tl?.kill());
      built.current.clear();
      clearLineBoxes();
      clearCounter();
      clearMedia();
    };
    // sceneId is in the deps because beat ids are only unique within a scene.
  }, { scope, dependencies: [slots.sceneId, slots.beat.id, animate, autoplay] });

  /** Render `value` into `host`, converting [label](target) markup into clickable links.
   *  Plain text (no markup) renders as a single text node — identical to the old behavior. */
  function renderLineContent(host: HTMLElement, value: string) {
    const segs = parseInlineLinks(value);
    if (segs.length === 1 && segs[0].kind === "text") { host.textContent = segs[0].text; return; }
    for (const seg of segs) {
      if (seg.kind === "text") { host.appendChild(document.createTextNode(seg.text)); continue; }
      if (seg.kind === "bold") {
        const b = document.createElement("strong");
        b.textContent = seg.text;
        host.appendChild(b);
        continue;
      }
      const link = document.createElement("a");
      link.className = "cin__link";
      link.textContent = seg.label;
      if (seg.link === "jump") {
        link.href = "#";
        link.addEventListener("click", (e) => {
          e.preventDefault();
          if (seg.jumpTo != null) runtime.jumpTo(seg.jumpTo - 1); // jump:N is 1-based
        });
      } else {
        link.href = seg.target;
        if (seg.link === "external") { link.target = "_blank"; link.rel = "noopener noreferrer"; }
      }
      host.appendChild(link);
    }
  }

  function appendText(host: HTMLElement, value: string, size?: TextSize, align?: TextAlign, dots?: boolean, instant = false, tone?: SlideTheme) {
    const sz = size ?? "lg";
    const p = document.createElement("p");
    // font-size per token set in the <style> block from TEXT_SIZES; tone:"dark" → dark ink for light grounds
    p.className = `cin__line cin__line--${sz}${tone === "dark" ? " cin__line--dark" : ""}`;
    if (align) p.style.textAlign = align;
    lineContent(p, value, dots, instant);
    host.appendChild(p);
    currentLine.current = p;
    return p;
  }

  /** Fill a line element with `value` exactly as appendText does (dots split, inline markup). */
  function lineContent(p: HTMLElement, value: string, dots?: boolean, instant = false) {
    if (dots) {
      const { line } = lineAndDots(value);
      p.textContent = line + " ";
      const span = document.createElement("span");
      span.className = "dots";
      span.innerHTML = '<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>';
      if (instant) span.style.opacity = "0"; // dots already faded in end-state
      p.appendChild(span);
    } else {
      renderLineContent(p, value);
    }
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  /** A "draw" line (spec §1): a hidden HTML ghost of the text reserves the line's layout, so boxes,
   *  alignment and `pos` behave exactly as for an HTML line, and an inline SVG <text> over it holds
   *  one <tspan> per glyph for drawIn to trace. One row: newlines become spaces (drawText). */
  function appendDrawLine(host: HTMLElement, a: Extract<Action, { kind: "text" }>): HTMLElement {
    const text = drawText(a.value);
    const p = document.createElement("p");
    p.className = `cin__line cin__line--${a.size ?? "lg"} cin__line--draw${a.tone === "dark" ? " cin__line--dark" : ""}`;
    if (a.align) p.style.textAlign = a.align;
    p.setAttribute("aria-label", text);
    const wrap = document.createElement("span");
    wrap.className = "cin__draw-wrap";
    const ghost = document.createElement("span");
    ghost.className = "cin__draw-ghost";
    ghost.textContent = text;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", DRAW_VARIANT === "mask" ? "cin__draw cin__draw--mask" : "cin__draw");
    svg.setAttribute("aria-hidden", "true");
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", "0");
    t.setAttribute("y", "0.075em"); // the HTML line box's half-leading at line-height 1.15
    t.setAttribute("dominant-baseline", "text-before-edge");
    for (const ch of Array.from(text)) {
      const span = document.createElementNS(SVG_NS, "tspan");
      span.textContent = ch;
      t.appendChild(span);
    }
    svg.appendChild(t);
    wrap.append(ghost, svg);
    p.appendChild(wrap);
    host.appendChild(p);
    currentLine.current = p;
    return p;
  }

  /** Append an inline fragment to the current line (text action `append`); the caller runs
   *  the reveal effect on the returned span. Falls back to a fresh line if none exists. */
  function appendFragment(value: string): HTMLElement {
    const line = currentLine.current
      ?? appendText(scope.current?.querySelector<HTMLElement>(".cin__text") ?? scope.current!, "");
    const span = document.createElement("span");
    span.textContent = value;
    line.appendChild(span);
    return span;
  }

  /** Create + track a free-positioned text box at `pos` (a text action's `pos` override).
   *  Anchored at pos per its align (left edge / center / right edge), like the beat box. */
  function makeLineBox(pos: StagePoint, align?: TextAlign): HTMLElement {
    const box = document.createElement("div");
    box.className = "cin__text"; // same styling as the shared box; its own left/right/transform
    if (align === "center") box.classList.add("cin__text--c"); // wide, no-wrap centered lines (title slide)
    const a = boxAnchor(pos, align);
    box.style.left = a.left;
    box.style.right = a.right;
    box.style.top = `${pos.y * 100}%`;
    box.style.transform = a.transform;
    const parent = scope.current?.querySelector<HTMLElement>(".cin__stage") ?? scope.current;
    parent?.appendChild(box);
    lineBoxes.current.push(box);
    return box;
  }
  function clearLineBoxes() {
    lineBoxes.current.forEach((b) => b.remove());
    lineBoxes.current = [];
    currentLine.current = null;
  }

  /** The 16:9 stage element that free-positioned text overlays (line-boxes, counter) attach to.
   *  It never takes the camera. */
  function stageParent(): HTMLElement | null {
    return scope.current?.querySelector<HTMLElement>(".cin__stage") ?? scope.current;
  }

  /** The 16:9 world layer media tiles attach to: it takes the camera transform and follows the
   *  text stage at the same z-index (tiles keep their pre-camera stacking above the text box). */
  function worldParent(): HTMLElement | null {
    return world.current ?? scope.current;
  }

  /** Build the counter's DOM at rest (opacity 1, no offset) — no entrance animation here;
   *  renderAt's paint step applies the eased entrance itself, driven by fold progress, and
   *  scrubs opacity/offset afterward (design spec §7b §5). */
  function showCounter(a: Extract<Action, { kind: "counter_show" }>) {
    clearCounter();
    const box = document.createElement("div");
    box.className = `cin__counter cin__line--${a.size ?? "lg"}`;
    const anc = boxAnchor(a.pos, "center");
    box.style.left = anc.left;
    box.style.right = anc.right;
    box.style.top = `${a.pos.y * 100}%`;
    box.style.transform = anc.transform;
    if (a.label) {
      const lab = document.createElement("div");
      lab.className = "cin__counter-label";
      lab.textContent = a.label;
      box.appendChild(lab);
    }
    const valueEl = document.createElement("div");
    valueEl.className = "cin__counter-value";
    const prefix = a.prefix ?? "";
    valueEl.textContent = formatCounterValue(a.value ?? 0, prefix);
    box.appendChild(valueEl);
    stageParent()?.appendChild(box);
    counterRef.current = { box, valueEl, prefix, a };
  }

  /** Fade the counter to opacity `1 - p` — a direct write, not a tween (design spec §7b §5,
   *  ambiguity res. #3). At `p >= 1` it is fully hidden, so it is torn down. renderAt's paint
   *  step is the only caller, varying `p` per frame. */
  function hideCounter(p: number) {
    const c = counterRef.current;
    if (!c) return;
    if (p >= 1) { clearCounter(); return; }
    c.box.style.opacity = String(1 - p);
  }

  function clearCounter() {
    counterRef.current?.box.remove();
    counterRef.current = null;
  }

  /** Paint the counter's displayed value + entrance/exit visuals at fold-derived progress —
   *  a pure read of counterValueAt, never a GSAP tween (design spec §7b §5). `counter` is null
   *  when no counter_show has been reached, or the reached one has fully hidden. `valueP` eases
   *  the displayed number between `from`/`to`; `entranceP` eases the counter_show entrance
   *  (opacity 0→1, y 12→0, mirroring the old gsap.from); `hideP` is the in-flight counter_hide's
   *  own progress, or null when no hide is in flight. */
  function paintCounter(
    counter: { a: Extract<Action, { kind: "counter_show" }>; from: number; to: number } | null,
    valueP: number,
    entranceP: number,
    hideP: number | null,
  ) {
    if (!counter) { clearCounter(); return; }
    if (!counterRef.current || counterRef.current.a !== counter.a) showCounter(counter.a);
    const c = counterRef.current!;
    c.valueEl.textContent = formatCounterValue(counterValueAt(counter.from, counter.to, valueP), c.prefix);
    if (hideP != null) { hideCounter(hideP); return; }
    c.box.style.opacity = String(counterValueAt(0, 1, entranceP));
    c.box.style.transform = `translateX(-50%) translateY(${counterValueAt(12, 0, entranceP)}px)`;
  }

  function makeMediaEl(a: { id: string; pos: StagePoint; src?: string; label?: string; width?: number; round?: boolean; panel?: PanelSpec }): HTMLElement {
    const w = a.width ?? 0.18;
    let el: HTMLElement;
    if (a.panel) {
      el = document.createElement("div");
      el.className = `cin__media cin__panel cin__panel--${a.panel.kind}`;
      el.innerHTML = renderPanelHTML(a.panel);
    } else if (a.src) {
      // Photo: a positioned <figure> holding the image, with the label as a caption BELOW it
      // (figcaption is absolute, so it never shifts the image off its `pos`). Omit label = no caption.
      const fig = document.createElement("figure");
      fig.className = "cin__media cin__media--photo";
      // An uploaded media ref resolves through the deck's asset resolver (the one base-path seam);
      // a video ref becomes a muted clip <video> whose time paintMedia drives from the beat clock.
      const src = isMediaRef(a.src) ? assets.media(a.src) : a.src;
      const cls = `cin__media-img${a.round ? " cin__media-img--round" : ""}`;
      if (isVideoRef(a.src)) {
        const video = createClipVideo(src);
        video.className = cls;
        if (a.label) video.setAttribute("aria-label", a.label);
        else video.setAttribute("aria-hidden", "true");
        fig.appendChild(video);
      } else {
        const img = document.createElement("img");
        img.src = src;
        img.alt = a.label ?? "";
        img.className = cls;
        fig.appendChild(img);
      }
      if (a.label) {
        const cap = document.createElement("figcaption");
        cap.className = "cin__media-cap";
        cap.textContent = a.label;
        fig.appendChild(cap);
      }
      el = fig;
    } else {
      el = document.createElement("div");
      el.textContent = a.label ?? a.id; // labeled placeholder box (intentional fallback)
      el.className = "cin__media cin__media--stub";
      if (a.round) el.classList.add("cin__media--round");
    }
    el.style.width = `${w * 100}%`;
    el.style.left = `${a.pos.x * 100}%`;
    el.style.top = `${a.pos.y * 100}%`;
    gsap.set(el, { xPercent: -50, yPercent: -50 }); // center on pos; survives later scale tweens
    el.dataset.mediaSrc = a.src ?? ""; // a re-show with a different src rebuilds the tile (paintMedia)
    return el;
  }

  /** A tile's clip <video>, if it holds one. */
  function tileVideo(el: HTMLElement): HTMLVideoElement | null {
    return el.querySelector("video");
  }

  function stopTileLoop(v: HTMLVideoElement) {
    const rec = tileLoops.current.get(v);
    if (!rec) return;
    v.removeEventListener("ended", rec.onEnded);
    tileLoops.current.delete(v);
  }

  /** Autoplay only: keep a `loop` clip looping through `ended` (seek to its in-point, play). */
  function syncTileLoop(v: HTMLVideoElement, clip: ClipOpts | undefined) {
    const rec = tileLoops.current.get(v);
    if (!clip?.loop) { if (rec) stopTileLoop(v); return; }
    if (rec) { rec.clip = clip; return; }
    const next = { clip, onEnded: () => { v.currentTime = clipTimeAt(0, 0, next.clip, v.duration); v.play().catch(() => {}); } };
    tileLoops.current.set(v, next);
    v.addEventListener("ended", next.onEnded);
  }

  /** Take a tile off the stage for good: drop a clip video's loop listener and release its
   *  decoder first. */
  function removeTile(el: HTMLElement) {
    const v = tileVideo(el);
    if (v) { stopTileLoop(v); releaseVideo(v); }
    el.remove();
  }

  function clearMedia() {
    mediaTiles.current.forEach(removeTile);
    mediaTiles.current.clear();
  }

  /** Paint every media tile's position/scale/opacity at fold-derived progress — a pure read
   *  of mediaStateAt, never a GSAP tween (design spec §7b §6). `fold` is this renderAt call's
   *  full run of reached media actions (in fold order); `state` is mediaStateAt's result keyed
   *  by tile id. A tile tracked in mediaTiles.current with no entry in `state` predates the
   *  current `media` action's reach (a backward seek past it) and is torn down; an id in
   *  `state` with no DOM tile yet is built via makeMediaEl from its `media` show action, found
   *  by scanning `fold`. Because this is recomputed from scratch on every call (not carried as
   *  tween state), backward seek falls out for free. A tile holding a clip video is synced to
   *  its clip time at the beat-local `clipT` (the fold's `t`, or the host's unclamped beat clock
   *  past the beat's end; `since` is beat-local too): "play" in autoplay, "seek" in static mode,
   *  else the host's clip mode (default "seek"). A video tile is painted at no less than
   *  MIN_VIDEO_OPACITY and kept synced through its entrance (p=0 included), so it stays
   *  composited and its first visible frame is the seeked one. A tile whose reached media_out
   *  has settled is fully hidden, so it is removed (its video released); a later re-show of the
   *  same id builds a fresh element — the same path whether the frame was stepped to or jumped
   *  to, so a re-shown clip's first frame never depends on how the render got there. */
  function paintMedia(fold: MediaFold[], state: Map<string, MediaRenderState>, clipT: number) {
    for (const [id, el] of mediaTiles.current) {
      if (!state.has(id)) { removeTile(el); mediaTiles.current.delete(id); }
    }
    if (!state.size) return;
    // The latest reached `media` (show) action per tile id — the one mediaStateAt's state reflects.
    const showActions = new Map<string, Extract<Action, { kind: "media" }>>();
    // Tiles whose latest reached media_out (by id, or id-less = every tile shown so far) has settled.
    const settledOut = new Set<string>();
    for (const { action, p } of fold) {
      if (action.kind === "media") { showActions.set(action.id, action); settledOut.delete(action.id); }
      else if (action.kind === "media_out") {
        for (const id of action.id ? [action.id] : [...showActions.keys()]) {
          if (p >= 1) settledOut.add(id); else settledOut.delete(id);
        }
      }
    }
    const mode: ClipMode = staticRef.current ? "seek" : autoplay ? "play" : (clipModeRef?.current ?? "seek");
    for (const [id, s] of state) {
      const a = showActions.get(id);
      let el = mediaTiles.current.get(id);
      if (settledOut.has(id)) {
        if (el) { removeTile(el); mediaTiles.current.delete(id); }
        continue;
      }
      // Re-shown with a different src (image ↔ clip, another clip): the old element is the wrong media.
      if (el && a && el.dataset.mediaSrc !== (a.src ?? "")) {
        removeTile(el);
        mediaTiles.current.delete(id);
        el = undefined;
      }
      if (!el) {
        if (!a) continue; // no show action reached yet for this id (shouldn't happen: mediaStateAt only emits ids it has seen)
        el = makeMediaEl(a);
        worldParent()?.appendChild(el);
        mediaTiles.current.set(id, el);
      }
      el.style.left = `${s.x * 100}%`;
      el.style.top = `${s.y * 100}%`;
      gsap.set(el, { scale: s.scale });
      const video = tileVideo(el);
      el.style.opacity = String(video ? Math.max(s.opacity, MIN_VIDEO_OPACITY) : s.opacity);
      if (video) {
        const { since, clip } = s;
        if (autoplay && !staticRef.current) syncTileLoop(video, clip);
        else stopTileLoop(video);
        syncVideo(video, (d) => clipTimeAt(since, clipT, clip, d), mode, { loop: clip?.loop });
      }
    }
  }

  /** Shared ease selector: builds the reveal-effect timeline for a text line's (possibly
   *  downgraded) `in` style. buildText's sole caller. */
  function buildTextEffect(el: HTMLElement, effIn: TextIn, a: Extract<Action, { kind: "text" }>): gsap.core.Timeline {
    const dir = a.align === "right" ? "right" : "left"; // letterFly follows justification
    const tl =
      effIn === "draw" ? drawIn(el, a.value.length, a.speed) :
      effIn === "flyUp" ? flyUp(el, a.speed) :
      effIn === "fadeSide" ? fadeSide(el, a.speed) :
      effIn === "cursive" ? typewriter(el, a.speed ?? 0.2) :
      effIn === "letterFly" ? letterFly(el, dir, a.speed) :
      effIn === "letterUp" ? letterUp(el, a.speed) :
      effIn === "wordUp" ? wordUp(el, a.speed, !a.append) :
      effIn === "blurIn" ? blurIn(el, a.speed) :
      effIn === "typewriter" ? typewriter(el, a.speed) : fadeIn(el, a.speed);
    if (a.dots) { const d = el.querySelector<HTMLElement>(".dots"); if (d) tl.add(dotFade(d)); }
    return tl;
  }

  /** Build one text action's element + its real reveal timeline, paused at 0 — the only place
   *  text elements/timelines are built (design spec §7b §4.2). */
  function buildText(a: Extract<Action, { kind: "text" }>, host: HTMLElement): { el: HTMLElement; tl: gsap.core.Timeline | null; box?: HTMLElement } {
    layoutRev.current++;
    const perPiece: TextIn[] = ["letterFly", "letterUp", "wordUp", "blurIn", "typewriter", "cursive", "draw"];
    // Markup, and inline `append` fragments, cannot be drawn glyph-by-glyph: they reveal with "fade".
    // So do dotted and empty draw lines (the dots live in HTML; an empty line has no outline).
    const effIn: TextIn = (hasInlineMarkup(a.value) && perPiece.includes(a.in)) || (a.in === "draw" && (a.append || !isDrawnLine(a))) ? "fade" : a.in;
    // instantText / no-reveal lines have no entrance: they render at rest, and their dots
    // render already-faded-in via `instant`.
    const instant = !!(instantText && !a.reveal);
    // `box` is only created (and only tracked) for a non-append, `pos`-bearing line — capture
    // it so resetFrom can tear it down alongside `el` (see the `built` ref's comment).
    let box: HTMLElement | undefined;
    const parent = () => (a.pos ? (box = makeLineBox(a.pos, a.align)) : host);
    // An instant draw line renders as a plain HTML line (no entrance to trace).
    const el = a.append
      ? appendFragment(a.value)
      : effIn === "draw" && !instant
        ? appendDrawLine(parent(), a)
        : appendText(parent(), a.value, a.size, a.align, a.dots, instant, a.tone);
    if (a.in === "cursive") el.classList.add("cin__line--cursive");
    if (instant) return { el, tl: null, box };
    const tl = buildTextEffect(el, effIn, a);
    tl.pause(0);
    return { el, tl, box };
  }

  /** Drop every cached entry from `index` onward, killing its (paused) tween and removing
   *  its DOM. A rebuild then re-runs those actions from scratch on the next renderAt —
   *  used both for the backward-seek boundary and for a settled clear/fade_out, which
   *  wipe everything built before them (design spec §7b §4.3). */
  function resetFrom(index: number) {
    // Deliberately does NOT touch appliedArt/appliedNight: resetFrom(0) is also called from the
    // forward-fold `clear`/settled-`fade_out` branches below, which are re-run on EVERY forward
    // frame once reached (foldAt re-emits every reached action, every call) — nulling the art
    // refs here would re-issue art/nightlight once per frame for any beat with one after a
    // `clear` (review round 1, finding 1). Clearing text has no bearing on what art is on
    // screen. Only an actual backward seek invalidates already-issued art/nightlight state; see
    // the `t < lastT.current` preamble in renderAt.
    for (const [i, entry] of built.current) {
      if (i < index) continue;
      entry.tl?.kill();
      entry.el.remove();
      // A `pos`-bearing text action's wrapper box is a separate node from `el` (see buildText)
      // — remove it too, and splice it out of lineBoxes.current, or it strands an empty box in
      // the stage and a detached node in that array (design spec §7b §4.3).
      if (entry.box) {
        entry.box.remove();
        const bi = lineBoxes.current.indexOf(entry.box);
        if (bi !== -1) lineBoxes.current.splice(bi, 1);
      }
      built.current.delete(i);
      layoutRev.current++;
    }
  }

  /** Paint the beat's visual state at beat-local time `t` — text, clear/fade_out, counter,
   *  media, art, nightlight, and rotateList actions all render from here now (Tasks 5-8). PAUSED
   *  timelines only; renderAt is the sole thing that ever advances them (design spec §7b §4.2). */
  function renderAt(t: number, clipT: number = t) {
    const host = scope.current?.querySelector<HTMLElement>(".cin__text");
    if (!host) return;
    // Backward seek: rebuild from the last destructive boundary at or before t. Deletion
    // (clear / settled fade_out) can't be undone by rewinding a tween, so everything built
    // at/after that boundary must be torn down; the fold loop below re-runs it from scratch.
    if (t < lastT.current) {
      const boundary = rebuildBoundary(slots.beat.timeline, t);
      resetFrom(boundary + 1);
      if (boundary < 0) { host.innerHTML = ""; clearLineBoxes(); }
      // An actual backward seek — and ONLY a backward seek, never a re-folded `clear` on a
      // forward frame — invalidates already-issued art/nightlight (ambiguity res. #3), and (by
      // the same reasoning) already-fired one-shot side effects (reveal_arrows/pulse_arrow):
      // clearing the whole set means anything still reached at the new `t` fires again this same
      // call, and anything not yet re-reached fires again when forward-crossed later. The
      // art/nightlight refs only matter for an autoplay stage seeked via transport: host-driven
      // stages never issue art/nightlight (the host paints them from art-clock).
      appliedArt.current = null;
      appliedNight.current = null;
      firedOnce.current.clear();
    }
    // Counter state is a fold over the reached actions (design spec §7b §5): counter_show
    // seeds {from,to}; counter_to/counter_add advance it, tracking `from` as the PREVIOUS
    // target so an in-flight counter_to/counter_add still eases from where the counter was,
    // not from 0; counter_hide clears it once settled. Painted once after the loop, at the
    // in-flight entry's own progress — never a GSAP tween. Because this is recomputed from
    // scratch on every call (not carried as tween state), backward seek falls out for free.
    let counter: { a: Extract<Action, { kind: "counter_show" }>; from: number; to: number } | null = null;
    let counterValueP = 1;     // progress for interpolating counter.value (last show/to/add entry)
    let counterEntranceP = 1;  // progress for the counter_show action's own entrance
    let counterHideP: number | null = null; // in-flight counter_hide's own progress, else null
    // Media actions are collected here (in fold order) and handed to the pure mediaStateAt
    // reducer once the loop completes, then painted — same "fold, then paint" shape as the
    // counter above (design spec §7b §6).
    const mediaFold: MediaFold[] = [];
    // reveal_again's effect (show the ending CTA block) is DERIVABLE state, not an event: it is
    // revealed exactly when the fold has reached a reveal_again action, recomputed fresh on
    // every call — review round finding 1. That makes it correct under backward seek for free,
    // with no issued-guard to keep in sync (unlike reveal_arrows/pulse_arrow below, which have
    // no readable state to derive from and so stay genuinely edge-triggered).
    let revealAgain = false;
    // The shared text box's (and any live line box's) opacity is likewise DERIVABLE, not an
    // event: `null` means "no reached, in-flight fade_out" (the default, unset opacity);
    // otherwise it's that fade_out's own local progress, painted below by ONE unconditional
    // write after the loop. This is what final review's Critical finding was missing — every
    // other fold output here (counter, media, revealAgain, wipeBoundary) is recomputed fresh
    // and painted unconditionally every call; opacity used to be the lone exception, written
    // only *while* a fade_out was in flight with no "else, restore the default" branch, so a
    // backward seek landing before that fade_out's start never un-wrote it. Computing the value
    // here and painting it unconditionally (rather than a targeted "clear it on backward seek
    // past a fade_out" special case) removes the class of bug, not just this reproduction.
    let fadeOutP: number | null = null;

    const foldEntries = foldAt(slots.beat.timeline, t);

    // The index of the LAST destructive action (`clear`, or a `fade_out` that has fully
    // SETTLED) among the actions reached by t — recomputed FRESH from `t` on every call,
    // forward or backward, the same way counter/media state is above (never carried forward as
    // incremental "already applied" tween state). Any text action before this index must never
    // render: `clear` and a settled `fade_out` permanently wipe everything built before them
    // (design spec §7b §4.3). `clear` is always settled instantly (0 duration); an in-flight
    // `fade_out` has NOT wiped anything yet — it takes the scrubbable opacity-ramp branch below,
    // not this one — so it must not suppress text still fading through it.
    //
    // Review round 2 critical: computing this FRESH every call (rather than remembering a
    // "highest destructive index already torn down" flag that only ever moves forward) is what
    // fixes the round-trip bug. The previous version marked a destructive index "done" the first
    // time it was reached, including while still in-flight; a backward seek into that in-flight
    // window, followed by a forward re-seek past its settlement, then saw "already done" and
    // skipped the real teardown, stranding the pre-fade text permanently. It also (independently)
    // surfaces on a purely FORWARD multi-frame scrub with no backward seek at all: once `clear`'s
    // one-time wipe ran, the fold loop still re-reaches the pre-clear text action on every later
    // frame (foldAt re-emits every reached action every call) — with no skip-guard, that text
    // gets rebuilt from scratch each frame (wastefully) and, because the wipe was already marked
    // "done", is never removed again, leaking back into the DOM alongside the post-clear text.
    let wipeBoundary = -1;
    for (const f of foldEntries) {
      if (f.action.kind === "clear") wipeBoundary = f.index;
      else if (f.action.kind === "fade_out" && f.phase === "settled") wipeBoundary = f.index;
    }
    // Physically wipe the built text cache/DOM exactly when wipeBoundary has grown past what was
    // already torn down — never on every re-fold of the same settled boundary (review round 1,
    // finding 3: that defeated the `built` cache, and independently kept re-nulling the
    // art/nightlight refs, for any beat with a `clear`/`fade_out`). A backward seek that LOWERS
    // wipeBoundary does not re-wipe here (moving backward destroys nothing new — the preamble
    // above already tore down what a backward seek invalidates); it only resyncs the tracked
    // value below, so a LATER forward re-crossing of the same boundary correctly re-triggers this
    // wipe rather than seeing a stale "already applied" value from before the round trip.
    if (wipeBoundary > lastDestructive.current) {
      resetFrom(0);
      host.innerHTML = "";
      clearLineBoxes();
      gsap.set(host, { clearProps: "opacity" }); // harmless no-op when the boundary was a `clear`, which never touches opacity
    }
    lastDestructive.current = wipeBoundary;

    for (const f of foldEntries) {
      if (f.action.kind === "counter_show") {
        counter = { a: f.action, from: f.action.value ?? 0, to: f.action.value ?? 0 };
        counterValueP = 1;
        counterEntranceP = f.p;
        counterHideP = null;
        continue;
      }
      if (f.action.kind === "counter_to") {
        if (counter) counter = { ...counter, from: counter.to, to: f.action.value };
        counterValueP = f.p;
        continue;
      }
      if (f.action.kind === "counter_add") {
        if (counter) counter = { ...counter, from: counter.to, to: counter.to + f.action.delta };
        counterValueP = f.p;
        continue;
      }
      if (f.action.kind === "counter_hide") {
        counterHideP = f.p;
        if (f.phase === "settled") counter = null; // fully hidden: paintCounter tears it down
        continue;
      }
      if (f.action.kind === "clear") continue; // its (idempotent) teardown already ran above, via wipeBoundary
      if (f.action.kind === "fade_out") {
        // Settled: its teardown already ran above, via wipeBoundary — nothing left to do here.
        if (f.phase === "settled") continue;
        // In-flight: record the opacity ramp's local progress (pure, from beatTimeline — never
        // from a built tween's .duration()). Nothing is deleted yet, so a seek that lands
        // mid-fade can still scrub back out of it without a rebuild. The actual DOM write is
        // unconditional, after the loop (see fadeOutP above) — not here — so there is no
        // incremental write for a later, non-fade_out frame to fail to un-write.
        fadeOutP = f.p;
        continue;
      }
      if (f.action.kind === "media" || f.action.kind === "media_move" || f.action.kind === "media_out") {
        mediaFold.push({ action: f.action, p: f.p, start: f.start });
        continue;
      }
      if (f.action.kind === "art") {
        if (!autoplay) continue; // host-driven: the host paints art + nightlight from art-clock
        // Diff against the last-issued transition, not the fold's own phase: the fold re-emits
        // this same entry on every frame within the action's window (settled or in-flight), and
        // ArtStage.show() runs its own crossfade as a side effect, so re-issuing on every frame
        // would restart that crossfade continuously (design spec §7b §7). Compare by a stable,
        // field-order-independent key (artKey, above) since the action's object identity changes
        // every render and its own key insertion order is not guaranteed stable (finding 2).
        const key = artKey(f.action.art);
        if (appliedArt.current !== key) {
          appliedArt.current = key;
          // Settled → land instantly (duration 0, snap-like). In-flight → let ArtStage run its
          // own crossfade once, over the action's own authored duration (ambiguity res. #2,
          // mirroring seek.ts's applyAt settled/in-flight split for `art`).
          runtime.applyArt(f.action.art, f.phase === "settled" ? 0 : f.action.art.durationMs);
        }
        continue;
      }
      if (f.action.kind === "nightlight") {
        if (!autoplay) continue; // host-driven: the host paints art + nightlight from art-clock
        if (appliedNight.current !== f.action.to) {
          appliedNight.current = f.action.to;
          runtime.setNightlight(f.action.to, f.phase === "settled" ? 0 : f.action.durationMs);
        }
        continue;
      }
      if (f.action.kind === "reveal_again") { revealAgain = true; continue; }
      // Genuinely one-shot external calls with nothing to diff against by value (unlike
      // art/nightlight) — guarded by fold INDEX in `firedOnce` instead, so foldAt re-emitting
      // the same reached action on every forward frame fires it only once, and a backward seek
      // (which clears `firedOnce` wholesale, above) re-fires it on forward re-crossing.
      if (f.action.kind === "reveal_arrows") {
        if (!firedOnce.current.has(f.index)) { firedOnce.current.add(f.index); runtime.revealArrows(); }
        continue;
      }
      if (f.action.kind === "pulse_arrow") {
        if (!firedOnce.current.has(f.index)) { firedOnce.current.add(f.index); runtime.pulseArrow(f.action.which, f.action.scale ?? 3); }
        continue;
      }
      // Permanently wiped by a LATER destructive action (clear / settled fade_out) — never
      // rebuild it. Without this guard, an action before wipeBoundary that isn't (yet, or
      // any longer) in the `built` cache would be rebuilt here every time it's reached, only to
      // rely on the (now idempotent, no-op-after-the-first-time) `clear`/`fade_out` branch above
      // to remove it again — which no longer happens on repeat visits, stranding it in the DOM.
      // Shared by both `built`-cached kinds below (text and rotateList).
      if (f.index < wipeBoundary) continue;
      if (f.action.kind === "rotateList") {
        // No GSAP loop, no `tl` — an infinite `repeat: -1` loop can't be seeked as a tween, so
        // the visible item is derived from elapsed time instead (design spec §7b §5, ambiguity
        // res. #1/#2). `actionDuration` returns 0 for rotateList (it occupies no time on the
        // axis), so `f.p` is always 1 the instant it's reached — phase must be measured from
        // this action's own `start`, i.e. `t - f.start`, not `t` or `f.p`.
        let entry = built.current.get(f.index);
        if (!entry) {
          layoutRev.current++; // it shares the text box with lines, so it moves them
          const slot = document.createElement("span");
          slot.className = `cin__rotslot cin__line--${f.action.size ?? "md"}`;
          host.appendChild(slot);
          entry = { el: slot, tl: null };
          built.current.set(f.index, entry);
        }
        entry.el.textContent = rotateItemAt(f.action.items, t - f.start);
        continue;
      }
      if (f.action.kind !== "text") continue;
      // PDF/print suppresses screen-only lines (design: narration meant for the on-screen
      // reveal, not the printed page) — the action still occupies its own time on the axis
      // (it's still a reached fold entry, still counts toward wipeBoundary/lastDestructive
      // above), only whether it gets BUILT is skipped. Mirrors the old hand-written static
      // loop's `if (print && a.screenOnly) continue`, which this renderAt-based fold replaced;
      // that check lived ONLY in the static loop, so unifying static mode onto renderAt (task
      // 11) had silently dropped it for every caller — restored here, in the one shared fold,
      // so it now also applies to a live/animated `print` render (which never honoured it).
      if (print && f.action.screenOnly) continue;
      let entry = built.current.get(f.index);
      if (!entry) { entry = buildText(f.action, host); built.current.set(f.index, entry); }
      if (!entry.tl) continue; // rendered at rest
      // Settled: jump to end by PROGRESS, not by reading the timeline's own .duration() —
      // that would derive a duration off a built GSAP timeline, which the pure beatTimeline()
      // clock (not GSAP) must remain the sole source of truth for (design spec §7b, Global
      // Constraints). In-flight: map absolute t onto this action's local elapsed time.
      if (f.phase === "settled") entry.tl.progress(1);
      else entry.tl.time(t - f.start);
    }
    // Paint the derived opacity UNCONDITIONALLY, every call — not only while a fade_out is in
    // flight. Default (no reached, in-flight fade_out): clearProps, matching a fresh mount's
    // never-touched inline style exactly (a plain `opacity: 1` would leave a non-empty style
    // attribute a fresh mount never has, which a symmetry check against a fresh mount would
    // catch). Otherwise: that fade_out's own local progress. Using `[host, ...lineBoxes.current]`
    // here (the final, post-loop set) rather than inline mid-loop also means a line box created
    // by a later-in-fold-order text action still gets the same treatment.
    if (fadeOutP == null) gsap.set([host, ...lineBoxes.current], { clearProps: "opacity" });
    else gsap.set([host, ...lineBoxes.current], { opacity: 1 - fadeOutP });
    paintCounter(counter, counterValueP, counterEntranceP, counterHideP);
    paintMedia(mediaFold, mediaStateAt(mediaFold, t), clipT);
    paintCamera(t);
    setAgainRevealed(revealAgain);
    lastT.current = t;
    if (layoutRev.current !== measuredRev.current) scheduleMeasure();
    // The one clock (design spec §7b Task 10, ambiguity res. #1): every renderAt call notifies
    // the host with the exact `t` it just painted, so a host driving sibling stages (notes,
    // objects) off THIS callback — instead of a second ticker of its own — stays in lockstep,
    // including pausing exactly when playback pauses at a click_gate.
    onTime?.(t);
  }

  /** Paint the camera on the world layer at beat-local `t` — only when the transform changes. */
  function paintCamera(t: number) {
    const w = world.current;
    if (!w) return;
    const next = cameraTransform(beatFraming(t, cameraRef, camera));
    if (next === lastCamera.current) return;
    lastCamera.current = next;
    w.style.transform = next;
  }

  /** Queue one measurement of the current DOM behind fonts.ready (coalesced: a queued measurement
   *  reads the DOM when it runs, so later layout changes ride along). */
  function scheduleMeasure() {
    measuredRev.current = layoutRev.current;
    if (measureQueued.current) return;
    measureQueued.current = true;
    const gen = measureGen.current;
    const fonts = typeof document !== "undefined" && document.fonts ? document.fonts.ready : Promise.resolve();
    pendingSources.current = Promise.resolve(fonts).then(() => {
      if (gen !== measureGen.current || !scope.current) return; // a newer beat (or unmount) owns the ref now
      measureQueued.current = false;
      // The host repaints notes with the new sources at the same t. Unchanged sources need no
      // repaint (the host already painted with them), so a deck without particles sees no extra onTime.
      if (publishSources()) onTime?.(lastT.current);
    });
  }

  /** Measure every built particle line AT REST and publish the sources (spec §2); true when the
   *  published sources changed. Ruling F3: lines are never measured live (a live line may be
   *  mid-SplitText, and so may its neighbours); each text box holding a particle line is replicated
   *  with every child rebuilt from its action (atRestRects), so a stepped and a jumped frame with
   *  the same built lines measure the same. */
  function publishSources(): boolean {
    const timeline = slots.beat.timeline;
    const windows = beatTimeline(timeline);
    const sr = scope.current?.querySelector<HTMLElement>(".cin__stage")?.getBoundingClientRect();
    const out: TextSource[] = [];
    const byHost = new Map<HTMLElement, Map<Element, TextRect[]>>(); // each text box replicated once
    for (const i of [...built.current.keys()].sort((x, y) => x - y)) {
      const entry = built.current.get(i)!;
      const a = timeline[i];
      if (!textSourcesRef || !sr || !(sr.width > 0 && sr.height > 0)) continue;
      // Ruling F11: an `append` fragment is not measured — a known limitation (particles on an
      // appended fragment are ignored; its words never emit).
      if (a?.kind !== "text" || !a.particles || a.append) continue;
      const host = entry.el.parentElement;
      if (!host) continue;
      let boxes = byHost.get(host);
      if (!boxes) { boxes = atRestRects(host, (child) => restChild(child, timeline), sr); byHost.set(host, boxes); }
      const rects = boxes.get(entry.el) ?? [];
      if (rects.length) out.push({ key: `a${i}`, idx: textSourceIdx(i), start: windows[i].start, end: textSourceEnd(timeline, i), rects, ...particleOpts(a.particles) });
    }
    if (!textSourcesRef || JSON.stringify(out) === JSON.stringify(textSourcesRef.current)) return false;
    textSourcesRef.current = out;
    return true;
  }

  /** A text box child's at-rest stand-in for atRestRects, rebuilt from the action that built it
   *  (never from its live, possibly split DOM). A particle line is word-wrapped and measured: an HTML
   *  line by its words (ruling F10: only `lineAndDots(value).line` — the dots are skipped), a draw
   *  line by its SVG glyphs. Append fragments ride along at rest as plain spans, unmeasured (F11). */
  function restChild(child: Element, timeline: Action[]): RestChild | null {
    let a: Action | undefined;
    const frags: string[] = [];
    for (const [i, entry] of [...built.current].sort(([x], [y]) => x - y)) {
      const ai = timeline[i];
      if (entry.el === child) a = ai;
      else if (ai?.kind === "text" && ai.append && entry.el.parentElement === child) frags.push(ai.value);
    }
    if (a?.kind === "rotateList") {
      // Its live text cycles with time; the stand-in holds a fixed item so the measurement does not
      // depend on when it ran.
      const first = a.items[0] ?? "";
      return { node: restLine(child, (c) => { c.textContent = first; }) };
    }
    const text = a?.kind === "text" ? a : undefined;
    if (!text && !frags.length) return null; // not a line: cloned as it is
    const wrap = child.querySelector(":scope > .cin__draw-wrap");
    const measure = text?.particles;
    const node = restLine(child, (c) => {
      if (wrap) c.appendChild(wrap.cloneNode(true));
      else if (text) {
        lineContent(c, text.value, text.dots, true);
        if (measure) wrapWords(c);
      }
      for (const v of frags) { const s = document.createElement("span"); s.textContent = v; c.appendChild(s); }
    });
    return { node, measure: measure ? (wrap ? { draw: drawText(text!.value) } : "words") : undefined };
  }

  // --- SlideTransport: one time axis + gate boundaries, replacing the old per-segment GSAP
  // timelines (design spec §7b §4.4). Gate boundaries are TIMES on the single axis: playback
  // pauses at each, the editor scrubs straight through (D1).
  const gates = beatTimeline(slots.beat.timeline)
    .filter((w) => w.action.kind === "click_gate")
    .map((w) => w.start);

  /** === beatDuration(beat.timeline) — the pure beat-clock reading, never a GSAP timeline's
   *  own .duration() (Global Constraints: no tl.duration() reads). */
  function duration(): number {
    return beatDuration(slots.beat.timeline);
  }

  /** Jump straight to `t`, clamped to [0, duration()] — never throws, including on a
   *  zero-duration or empty beat (ambiguity res. #3). Always pause()s first (mirroring play(),
   *  which already unconditionally pauses before it does anything else): a manual seek is the
   *  caller taking control of the clock, and leaving a live ticker running is a real defect, not
   *  a caller-side quirk to route around — play()'s tick closure captures `nextGate` once and
   *  never recomputes it, so a seek across a gate boundary while the ticker is still live gets
   *  silently undone by the very next real-time frame (Task 10 review). Callers must never need
   *  to remember to pause() before seek() themselves. */
  function seek(to: number, clipT?: number) {
    pause();
    const t = Math.max(0, Math.min(duration(), to));
    renderAt(t, clipT !== undefined && Number.isFinite(clipT) ? Math.max(t, clipT) : t);
  }

  /** Stop the ticker driving playback, if any. Idempotent — safe to call when already paused. */
  function pause() {
    if (ticker.current) {
      gsap.ticker.remove(ticker.current);
      ticker.current = null;
    }
  }

  /** Start (or resume) playback from `lastT.current`. Always pause()s first, so calling play()
   *  while already playing never double-registers a ticker. The "next gate" is searched with a
   *  STRICT `>` against lastT.current — not `>=` — so resuming from a position sitting exactly
   *  on a gate's own start (e.g. play() called as a gate's `resume`, or after seek(gateTime))
   *  finds the gate AFTER it, not the one it's already sitting on. Using `>=` here would make
   *  play() immediately re-pause on the same gate it just resumed from, deadlocking forever
   *  (ambiguity res. #2). */
  function play() {
    pause();
    const nextGate = gates.find((g) => g > lastT.current);
    const tick = (_time: number, delta: number) => {
      const t = lastT.current + delta / 1000;
      if (nextGate != null && t >= nextGate) {
        renderAt(nextGate);
        pause();
        runtime.onGate(play); // paused here; runtime.onGate's resume is this same play()
        return;
      }
      if (t >= duration()) {
        renderAt(duration());
        pause();
        runtime.onWaiting(true);
        return;
      }
      renderAt(t);
    };
    ticker.current = tick;
    gsap.ticker.add(tick);
  }

  useImperativeHandle(transport, () => ({ seek, play, pause, duration, sourcesReady: () => pendingSources.current }));

  const pos = slots.beat.pos ?? DEFAULT_TEXT_POS;
  // Anchor the shared text box at `pos` per the first NON-free line's justification
  // (lines with their own `pos` render in their own box, so they don't key this one).
  const firstAlign = slots.beat.timeline.find(
    (a): a is Extract<Action, { kind: "text" }> => a.kind === "text" && !a.pos,
  )?.align;
  const anchor = boxAnchor(pos, firstAlign);

  return (
    <div className={`cin${slots.sceneId === "intro" ? " cin--intro" : ""}`} ref={scope}>
      <div className="cin__stage">
        {slots.sceneId === "intro" && chrome?.splash && (
          <div className="cin__splash">
            {chrome.splash.logo && <img className="cin__logo" src={assets.brand(chrome.splash.logo)} alt="" />}
            {chrome.splash.tagline && <p className="cin__tagline">{chrome.splash.tagline}</p>}
          </div>
        )}
        <div className="cin__text" style={{ left: anchor.left || undefined, right: anchor.right || undefined, top: `${pos.y * 100}%`, transform: anchor.transform || undefined }} />
        {slots.beat.id === "fin" && againRevealed && (
          <div className="cin__ending">
            {!!chrome?.ending?.ctas?.length && (
              <div className="cin__ending-row">
                {chrome.ending.ctas.map((c) => <a key={c.href} className="cin__cta" href={c.href}>{c.label}</a>)}
              </div>
            )}
            <button
              className="cin__again"
              onClick={() => { const u = new URL(location.href); u.searchParams.set("slide", "1"); location.href = u.toString(); }}
            >
              ↺ Watch again
            </button>
          </div>
        )}
      </div>
      {/* The camera's world (media tiles). It follows the text stage at the same z-index, so tiles
          keep their pre-camera stacking (they were appended into the stage after the text box):
          above notes and the shared text box. Only the world takes the camera; text never moves. */}
      <div className="cin__world" ref={world} />
      <style>{`
        .cin { position: relative; width: 100%; height: 100%; }
        /* A fixed 16:9 box matching the letterboxed art rect — the slide canvas that
           text positions (and note anchors) are normalized against. */
        .cin__stage { position: absolute; inset: 0; margin: auto; z-index: 2; pointer-events: none;
          width: min(100cqw, calc(100cqh * 16 / 9)); height: min(100cqh, calc(100cqw * 9 / 16)); }
        /* The camera's world: the same 16:9 box as .cin__stage (tile positions are normalized
           against it), after it at the same z-index. It takes the camera transform about its top-left. */
        .cin__world { position: absolute; inset: 0; margin: auto; z-index: 2; pointer-events: none; transform-origin: 0 0;
          width: min(100cqw, calc(100cqh * 16 / 9)); height: min(100cqh, calc(100cqw * 9 / 16)); }
        .cin__text { position: absolute; max-width: 90%; text-align: left; color: var(--color-mm-cream); text-shadow: 0 2px 14px rgba(0,0,0,0.6); }
        /* Intro is bright day — dark ink for legibility on the light ground. */
        .cin--intro .cin__text, .cin--intro .cin__tagline { color: var(--color-mm-dark-brown); text-shadow: 0 1px 10px rgba(255,247,235,0.55); }
        /* Intro CTA lines build inline (append) — let each box grow to fit its content
           and never wrap, so a growing line extends sideways from center instead of
           wrapping to a 2nd line and shifting the whole stack vertically. */
        .cin--intro .cin__text { max-width: none; }
        .cin--intro .cin__line { white-space: nowrap; }
        /* white-space: pre-line → lines stay long by default; break only on a \\n in the text value. */
        .cin__line { font-family: var(--font-display); line-height: 1.15; margin: 0.25em 0; white-space: pre-line; }
        .cin__line strong { font-weight: 700; } /* **bold** inline markup */
        ${Object.entries(TEXT_SIZES).map(([k, v]) => `.cin__line--${k} { font-size: ${v}; }`).join("\n        ")}
        .cin__line--sm { opacity: 0.85; }
        /* Investor treatments: larger, tighter type with a distinct TITLE scale (~2×, ≥1.8× body)
           and a rule beneath the title. Body uses the body font. Scoped to warm/paper so /story
           keeps its own scale; text-in transitions are suppressed by instantText (Slide.tsx). */
        .deck--warm .cin__line--lg, .deck--paper .cin__line--lg { font-size: clamp(2rem, 5.6cqmin, 3.4rem); line-height: 1.1; }
        .deck--warm .cin__line--md, .deck--paper .cin__line--md { font-size: clamp(1.1rem, 3cqmin, 1.6rem); line-height: 1.3; }
        .deck--warm .cin__line--sm, .deck--paper .cin__line--sm { font-size: clamp(1rem, 2.7cqmin, 1.45rem); font-family: var(--font-body); line-height: 1.35; opacity: 1; }
        .deck--warm .cin__line, .deck--paper .cin__line { margin: 0.08em 0; line-height: 1.2; }
        /* Rule under the slide title (the only <p> lg line on an investor slide; not the counter). */
        .deck--warm p.cin__line--lg { border-bottom: 2px solid var(--color-mm-gold); padding-bottom: 0.2em; margin-bottom: 0.5em; }
        .deck--paper p.cin__line--lg { border-bottom: 2px solid var(--color-mm-terracotta); padding-bottom: 0.2em; margin-bottom: 0.5em; }
        /* Left copy is capped so it clears the right-hand panel; centered lines (title slide)
           get the full safe width and never wrap. */
        .deck--warm .cin__text, .deck--paper .cin__text { max-width: 40%; }
        .deck--warm .cin__text--c, .deck--paper .cin__text--c { max-width: 86%; }
        .cin__text--c .cin__line { white-space: nowrap; }
        /* Title slide: left-aligned, but its column stays wide & non-wrapping so the long
           question holds on one line (overrides the 40% body cap; placed after it to win on order). */
        [data-slide-id="title.a"] .cin__text { max-width: 86%; }
        [data-slide-id="title.a"] .cin__line { white-space: nowrap; }
        /* paper = dark ink on cream; warm keeps the default cream ink. */
        .deck--paper .cin__text, .deck--paper .cin__line { color: var(--color-mm-mushroom); text-shadow: none; }
        .deck--paper .cin__counter { color: var(--color-mm-mushroom); text-shadow: none; }
        .deck--paper .cin__counter-value { color: var(--color-mm-terracotta); }
        .deck--paper .cin__link { color: var(--color-mm-terracotta); }
        .deck--paper .cin__link:hover { color: var(--color-mm-mushroom); }
        /* tone:"dark" — brand dark ink + a soft light halo so a line stays legible on a
           LIGHT art panel (e.g. the closing musicians). Mirrors the intro's day treatment. */
        .cin__line--dark { color: var(--color-mm-dark-brown); text-shadow: 0 1px 12px rgba(255,247,235,0.6); }
        .cin__line--cursive { font-family: var(--font-cursive); font-size: ${CURSIVE_SIZE}; font-weight: 700; }
        /* "draw" lines (sub-project 6): the ghost reserves layout; the SVG over it is traced. */
        .cin__line--draw { position: relative; }
        .cin__draw-wrap { position: relative; display: inline-block; white-space: pre; }
        .cin__draw-ghost { visibility: hidden; }
        .cin__draw { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
        .cin__draw text { fill: currentColor; stroke: currentColor; stroke-width: ${DRAW_STROKE_EM}em; white-space: pre; }
        .cin__draw tspan { stroke-dasharray: ${DRAW_DASH_EM}em; stroke-dashoffset: calc(var(--d, 1) * ${DRAW_DASH_EM}em);
          fill-opacity: var(--f, 0); stroke-opacity: var(--s, 1); }
        .cin__draw--mask { -webkit-mask-image: linear-gradient(90deg, #000 calc(var(--sweep, 0) * 108% - 8%), transparent calc(var(--sweep, 0) * 108%));
          mask-image: linear-gradient(90deg, #000 calc(var(--sweep, 0) * 108% - 8%), transparent calc(var(--sweep, 0) * 108%)); }
        .cin__draw--mask tspan { stroke-dasharray: none; stroke-dashoffset: 0; }
        /* Inline links inside narration. The stage is pointer-events:none, so links must
           opt back in to be clickable (same trick as .cin__cta). */
        .cin__link { pointer-events: auto; cursor: pointer; color: var(--color-mm-gold);
          text-decoration: underline; text-underline-offset: 0.12em; }
        .cin__link:hover { color: var(--color-mm-cream); }
        /* Running-total counter. Box font-size comes from the cin__line--{size} class. */
        .cin__counter { position: absolute; text-align: center; color: var(--color-mm-cream);
          text-shadow: 0 2px 14px rgba(0,0,0,0.6); font-family: var(--font-display); }
        .cin__counter-label { font-size: 0.42em; letter-spacing: 0.08em; opacity: 0.85; margin-bottom: 0.15em; }
        .cin__counter-value { font-weight: 900; line-height: 1; color: var(--color-mm-gold); }
        /* Positioned media tiles (headshots, logos, stubbed callout panels). */
        .cin__media { position: absolute; }
        figure.cin__media { margin: 0; }
        /* Photo: image fills the figure; the label hangs BELOW it as a caption. */
        .cin__media-img { display: block; width: 100%; height: auto; object-fit: contain; filter: drop-shadow(0 4px 24px rgba(0,0,0,0.35)); }
        .cin__media-img--round { aspect-ratio: 1 / 1; border-radius: 50%; object-fit: cover; }
        .cin__media-cap { position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
          margin-top: 0.4em; white-space: nowrap; text-align: center; font-family: var(--font-display);
          font-size: clamp(0.7rem, 2cqmin, 1rem); line-height: 1.1; color: var(--color-mm-cream);
          text-shadow: 0 1px 8px rgba(0,0,0,0.5); }
        .deck--paper .cin__media-cap { color: var(--color-mm-mushroom); text-shadow: none; }
        /* Stub placeholders keep their label inside the dashed box. */
        .cin__media--round { aspect-ratio: 1 / 1; border-radius: 50%; overflow: hidden; }
        .cin__media--stub { box-sizing: border-box; aspect-ratio: 16 / 10; display: flex; align-items: center;
          justify-content: center; text-align: center; white-space: pre-line; padding: 0.6em;
          font-family: var(--font-display); font-size: clamp(0.7rem, 2.4cqmin, 1.05rem);
          line-height: 1.2; color: var(--color-mm-cream); background: rgba(40,28,22,0.55);
          border: 2px dashed var(--color-mm-mushroom); border-radius: 12px;
          text-shadow: 0 1px 8px rgba(0,0,0,0.5); }
        .cin__media--round.cin__media--stub { aspect-ratio: 1 / 1; border-radius: 50%; }
        /* Native data panels (funding / financials / SAFE terms). Treatment-aware skins below. */
        .cin__panel { box-sizing: border-box; border-radius: 12px; padding: 1em 1.1em; text-align: left;
          font-family: var(--font-body); font-size: clamp(0.7rem, 2.2cqmin, 1rem); line-height: 1.5; }
        .cin__panel-title { font-family: var(--font-display); font-size: 1.05em; margin-bottom: 0.5em; }
        .cin__panel-row { display: flex; justify-content: space-between; gap: 1em; padding: 0.32em 0; }
        .cin__panel-val.is-neg { font-style: italic; opacity: 0.9; }
        .cin__panel-val.is-muted { opacity: 0.6; }
        .cin__panel-total { margin-top: 0.4em; padding-top: 0.5em; border-top: 2px solid currentColor; font-weight: 700; }
        .cin__panel-big { font-family: var(--font-display); font-weight: 900; font-size: 1.5em; line-height: 1; }
        .cin__panel-note { margin-top: 0.5em; font-size: 0.8em; opacity: 0.65; }
        /* warm = glassy dark card; paper = warm-tan card. */
        .deck--warm .cin__panel { background: rgba(60,40,26,0.55); color: var(--color-mm-cream);
          box-shadow: 0 8px 30px rgba(0,0,0,0.35), 0 0 0 1px rgba(240,201,160,0.12); backdrop-filter: blur(2px); }
        .deck--warm .cin__panel-row { border-bottom: 1px solid rgba(240,201,160,0.18); }
        .deck--warm .cin__panel-big { color: var(--color-mm-gold); }
        .deck--paper .cin__panel { background: var(--color-mm-warm-tan); color: var(--color-mm-dark-brown);
          box-shadow: inset 0 0 0 1px var(--color-mm-hairline); }
        .deck--paper .cin__panel-row { border-bottom: 1px solid rgba(92,61,46,0.18); }
        .deck--paper .cin__panel-big { color: var(--color-mm-terracotta); }
        .cin__rotslot { display: inline-block; font-family: var(--font-display); color: var(--color-mm-gold); }
        .dots { display: inline-block; }
        .cin__splash { position: absolute; top: 38%; left: 50%; transform: translate(-50%, -50%);
          display: flex; flex-direction: column; align-items: center; gap: 0.8rem; max-width: 90%; }
        .cin__logo { width: clamp(220px, 30cqw, 460px); height: auto; filter: drop-shadow(0 4px 24px rgba(0,0,0,0.3)); }
        .cin__tagline { margin: 0; font-family: var(--font-display); font-weight: 400;
          font-size: clamp(1.5rem, 2.8cqw, 2.4rem); letter-spacing: 0.01em; text-align: center; }
        /* End-of-deck actions: two primary Vision-link pills on top, a quiet replay below.
           The group is the absolutely-centered element; only the buttons capture pointer
           events so the nav arrows behind the group stay clickable. */
        .cin__ending { position: absolute; bottom: 9%; left: 50%; transform: translateX(-50%);
          display: flex; flex-direction: column; align-items: center; gap: 0.85rem;
          pointer-events: none; animation: cin-ending-in 0.5s ease both; }
        .cin__ending-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 1rem; }
        @keyframes cin-ending-in {
          from { opacity: 0; transform: translate(-50%, 10px); }
          to   { opacity: 1; transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) { .cin__ending { animation: none; } }
        /* MP4 render page: interactive end-cards are not part of a rendered video (spec §2.4) — and
           frames are a pure function of deck time, so no wall-clock entrance animation either. */
        html[data-render="1"] .cin__ending { display: none; animation: none; }
        /* Primary Vision-link pills (solid brand ink). */
        .cin__cta { pointer-events: auto; cursor: pointer; text-decoration: none; white-space: nowrap;
          font-family: var(--font-display); font-size: clamp(1rem, 1.8cqw, 1.4rem); letter-spacing: 0.03em;
          color: var(--color-mm-cream); background: var(--color-mm-dark-brown); border: 0; border-radius: 999px;
          padding: 0.55em 1.6em; box-shadow: 0 2px 12px rgba(0,0,0,0.45);
          transition: transform 0.15s, background 0.15s; }
        .cin__cta:hover { background: var(--color-mm-mushroom); transform: scale(1.04); }
        /* Quiet replay — ghost button, secondary to the Vision links. */
        .cin__again { pointer-events: auto; cursor: pointer; font-family: var(--font-display);
          font-size: clamp(0.9rem, 1.5cqw, 1.15rem); letter-spacing: 0.03em; color: var(--color-mm-cream);
          background: transparent; border: 0; border-radius: 999px; padding: 0.35em 1.1em; opacity: 0.78;
          text-shadow: 0 2px 10px rgba(0,0,0,0.55); transition: opacity 0.15s, transform 0.15s; }
        .cin__again:hover { opacity: 1; transform: scale(1.04); }
      `}</style>
    </div>
  );
}
