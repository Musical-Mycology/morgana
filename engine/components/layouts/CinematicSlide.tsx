"use client";

import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { ArtMode, ArtTransition, CinematicSlideSlots, Action, TextIn, TextSize, TextAlign, StagePoint, SlideTheme, PanelSpec } from "@/engine/deck/types";
import type { StoryAsset } from "@/engine/deck/story-assets";
import type { DeckChrome } from "@/engine/deck-doc";
import { renderPanelHTML } from "@/engine/deck/panel";
import { useAssetResolver } from "@/engine/asset-resolver-react";
import { TEXT_SIZES, CURSIVE_SIZE, DEFAULT_TEXT_POS } from "@/engine/deck/cinematic-style";
import { parseInlineLinks, hasInlineMarkup } from "@/engine/deck/inline-links";
import { formatCounterValue, counterValueAt } from "@/engine/deck/counter";
import { mediaStateAt, type MediaFold, type MediaRenderState } from "@/engine/deck/media-state";
import {
  flyUp, fadeIn, fadeSide, dotFade, rotateItemAt, lineAndDots,
  letterFly, letterUp, wordUp, blurIn, typewriter,
} from "../effects/cinematic-anim";
import { foldAt, rebuildBoundary, beatTimeline, beatDuration } from "@/engine/authoring/beat-clock";

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
 *  differently and spuriously re-trigger ArtStage's crossfade. An explicit field list also fails
 *  loudly (a TS error) if ArtTransition gains a field this key doesn't know about, rather than
 *  silently changing diffing behaviour. */
function artKey(a: ArtTransition): string {
  return JSON.stringify([a.to, a.mode, a.durationMs ?? null, a.keep ?? null, a.out ?? null]);
}


export interface CinematicRuntime {
  /** Cross-fade to an absolute layer set (entry transitions). */
  art(layers: StoryAsset[], mode: ArtMode, durationMs?: number): void;
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
  resolveEntry(): StoryAsset[];
  /** End-state layers for this beat (after all its art ops) — for PDF/static. */
  resolveEnd(): StoryAsset[];
  /** Jump to a 0-based slide index (inline jump links). */
  jumpTo(index: number): void;
}

/** The public seekable transport over a beat's single time axis (design spec §7b §4.1).
 *  `seek` clamps to `[0, duration()]` and never throws, including on a zero-duration/empty
 *  beat. `duration()` is always `beatDuration(beat.timeline)` — the pure beat-clock reading,
 *  never a GSAP timeline's own `.duration()`. */
export interface SlideTransport {
  seek(t: number): void;
  play(): void;
  pause(): void;
  duration(): number;
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
}

export function CinematicSlide({ slots, animate, runtime, chrome, print, instantText, transport, onTime }: Props) {
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
  // Built, PAUSED effect timelines keyed by action index. Nothing here ever runs on
  // wall-clock — renderAt is the only thing that advances them (design spec §7b §4.2).
  // `box` is set only for a `pos`-bearing text action: the separate wrapper div makeLineBox()
  // creates (distinct from `el`, the <p> inside it). resetFrom must tear both down, or a
  // backward seek strands an empty positioned box in the stage (and a detached node in
  // lineBoxes.current) every time it lands inside an in-flight fade_out.
  const built = useRef<Map<number, { el: HTMLElement; tl: gsap.core.Timeline | null; box?: HTMLElement }>>(new Map());
  // Last-issued art transition (JSON of its ArtTransition, since object identity changes every
  // render) and nightlight target. ArtStage.show() runs its own crossfade as a side effect on a
  // SIBLING component — calling it on every scrub frame would restart that crossfade
  // continuously, so renderAt's fold loop below only calls into the runtime when the folded
  // value actually differs from what was last issued (design spec §7b §7, ambiguity res. #1).
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
    const staticMode = !animate || document.visibilityState !== "visible";
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
      runtime.art(runtime.resolveEnd(), "cut");
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
      return () => { pause(); };
    }

    // Entry art: resolveEntry() already folds this beat's entry transition, so show
    // it as an absolute cross-fade using the entry op's mode.
    if (slots.beat.art) runtime.art(runtime.resolveEntry(), slots.beat.art.mode, slots.beat.art.durationMs);

    // Autoplay from t=0 — observable behaviour is unchanged from the old per-segment
    // machinery (design spec §7b §4.4): a ticker now drives the single time axis instead of
    // N GSAP timelines, pausing at each click_gate and handing `resume` to runtime.onGate,
    // exactly as the segment machinery did. Most callers (today) never touch `transport` at
    // all; the ref just gives a scrubber somewhere to grab onto later.
    play();

    // built effect timelines are created here / in deferred callbacks; kill them on unmount
    // (deps re-run also kills them at the top of the effect above). The ticker itself is
    // stopped via pause() — critical: gsap.ticker.add has no other owner, so a beat change or
    // unmount that forgets this leaves a zombie ticker calling renderAt forever (ambiguity
    // res. #1).
    return () => {
      pause();
      built.current.forEach((entry) => entry.tl?.kill());
      built.current.clear();
      clearLineBoxes();
      clearCounter();
      clearMedia();
    };
    // sceneId is in the deps because beat ids are only unique within a scene.
  }, { scope, dependencies: [slots.sceneId, slots.beat.id, animate] });

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

  /** The 16:9 stage element that free-positioned overlays (line-boxes, counter, media) attach to. */
  function stageParent(): HTMLElement | null {
    return scope.current?.querySelector<HTMLElement>(".cin__stage") ?? scope.current;
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
      const img = document.createElement("img");
      img.src = a.src;
      img.alt = a.label ?? "";
      img.className = `cin__media-img${a.round ? " cin__media-img--round" : ""}`;
      fig.appendChild(img);
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
    return el;
  }

  function clearMedia() {
    mediaTiles.current.forEach((el) => el.remove());
    mediaTiles.current.clear();
  }

  /** Paint every media tile's position/scale/opacity at fold-derived progress — a pure read
   *  of mediaStateAt, never a GSAP tween (design spec §7b §6). `fold` is this renderAt call's
   *  full run of reached media actions (in fold order); `state` is mediaStateAt's result keyed
   *  by tile id. A tile tracked in mediaTiles.current with no entry in `state` predates the
   *  current `media` action's reach (a backward seek past it) and is torn down; an id in
   *  `state` with no DOM tile yet is built via makeMediaEl from its `media` show action, found
   *  by scanning `fold`. Because this is recomputed from scratch on every call (not carried as
   *  tween state), backward seek falls out for free. */
  function paintMedia(fold: MediaFold[], state: Map<string, MediaRenderState>) {
    for (const [id, el] of mediaTiles.current) {
      if (!state.has(id)) { el.remove(); mediaTiles.current.delete(id); }
    }
    if (!state.size) return;
    let showActions: Map<string, Extract<Action, { kind: "media" }>> | null = null;
    for (const [id, s] of state) {
      let el = mediaTiles.current.get(id);
      if (!el) {
        if (!showActions) {
          showActions = new Map();
          for (const { action } of fold) if (action.kind === "media") showActions.set(action.id, action);
        }
        const a = showActions.get(id);
        if (!a) continue; // no show action reached yet for this id (shouldn't happen: mediaStateAt only emits ids it has seen)
        el = makeMediaEl(a);
        stageParent()?.appendChild(el);
        mediaTiles.current.set(id, el);
      }
      el.style.left = `${s.x * 100}%`;
      el.style.top = `${s.y * 100}%`;
      el.style.opacity = String(s.opacity);
      gsap.set(el, { scale: s.scale });
    }
  }

  /** Shared ease selector: builds the reveal-effect timeline for a text line's (possibly
   *  downgraded) `in` style. buildText's sole caller. */
  function buildTextEffect(el: HTMLElement, effIn: TextIn, a: Extract<Action, { kind: "text" }>): gsap.core.Timeline {
    const dir = a.align === "right" ? "right" : "left"; // letterFly follows justification
    const tl =
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
    const perPiece: TextIn[] = ["letterFly", "letterUp", "wordUp", "blurIn", "typewriter", "cursive"];
    const effIn: TextIn = hasInlineMarkup(a.value) && perPiece.includes(a.in) ? "fade" : a.in;
    // instantText / no-reveal lines have no entrance: they render at rest, and their dots
    // render already-faded-in via `instant`.
    const instant = !!(instantText && !a.reveal);
    // `box` is only created (and only tracked) for a non-append, `pos`-bearing line — capture
    // it so resetFrom can tear it down alongside `el` (see the `built` ref's comment).
    let box: HTMLElement | undefined;
    const el = a.append
      ? appendFragment(a.value)
      : appendText(a.pos ? (box = makeLineBox(a.pos, a.align)) : host, a.value, a.size, a.align, a.dots, instant, a.tone);
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
    }
  }

  /** Paint the beat's visual state at beat-local time `t` — text, clear/fade_out, counter,
   *  media, art, nightlight, and rotateList actions all render from here now (Tasks 5-8). PAUSED
   *  timelines only; renderAt is the sole thing that ever advances them (design spec §7b §4.2). */
  function renderAt(t: number) {
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
      // call, and anything not yet re-reached fires again when forward-crossed later.
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
        // In-flight: scrub the opacity ramp from local progress (pure, from beatTimeline —
        // never from a built tween's .duration()). Nothing is deleted yet, so a seek that
        // lands mid-fade can still scrub back out of it without a rebuild.
        gsap.set([host, ...lineBoxes.current], { opacity: 1 - f.p });
        continue;
      }
      if (f.action.kind === "media" || f.action.kind === "media_move" || f.action.kind === "media_out") {
        mediaFold.push({ action: f.action, p: f.p });
        continue;
      }
      if (f.action.kind === "art") {
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
    paintCounter(counter, counterValueP, counterEntranceP, counterHideP);
    paintMedia(mediaFold, mediaStateAt(mediaFold, t));
    setAgainRevealed(revealAgain);
    lastT.current = t;
    // The one clock (design spec §7b Task 10, ambiguity res. #1): every renderAt call notifies
    // the host with the exact `t` it just painted, so a host driving sibling stages (notes,
    // objects) off THIS callback — instead of a second ticker of its own — stays in lockstep,
    // including pausing exactly when playback pauses at a click_gate.
    onTime?.(t);
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
  function seek(to: number) {
    pause();
    renderAt(Math.max(0, Math.min(duration(), to)));
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

  useImperativeHandle(transport, () => ({ seek, play, pause, duration }));

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
      <style>{`
        .cin { position: relative; width: 100%; height: 100%; }
        /* A fixed 16:9 box matching the letterboxed art rect — the slide canvas that
           text positions (and note anchors) are normalized against. */
        .cin__stage { position: absolute; inset: 0; margin: auto; z-index: 2; pointer-events: none;
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
