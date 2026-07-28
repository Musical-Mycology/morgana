"use client";

import { useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { ArtMode, ArtTransition, CinematicSlideSlots, Action, TextIn, TextSize, TextAlign, StagePoint, SlideTheme, PanelSpec } from "@/engine/deck/types";
import type { StoryAsset } from "@/engine/deck/story-assets";
import type { DeckChrome } from "@/engine/deck-doc";
import { renderPanelHTML } from "@/engine/deck/panel";
import { useAssetResolver } from "@/engine/asset-resolver-react";
import { TEXT_SIZES, CURSIVE_SIZE, DEFAULT_TEXT_POS } from "@/engine/deck/cinematic-style";
import { parseInlineLinks, hasInlineMarkup } from "@/engine/deck/inline-links";
import { formatCounterValue, counterTarget, counterValueAt } from "@/engine/deck/counter";
import { mediaStateAt, type MediaFold, type MediaRenderState } from "@/engine/deck/media-state";
import {
  flyUp, fadeIn, fadeSide, dotFade, rotateList, lineAndDots,
  letterFly, letterUp, wordUp, blurIn, typewriter,
} from "../effects/cinematic-anim";
import { introDuration, foldAt, rebuildBoundary } from "@/engine/authoring/beat-clock";

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
}

export function CinematicSlide({ slots, animate, runtime, chrome, print, instantText }: Props) {
  const assets = useAssetResolver();
  const scope = useRef<HTMLDivElement>(null);
  const loopers = useRef<gsap.core.Timeline[]>([]);
  const masterRef = useRef<gsap.core.Timeline | null>(null);
  const lineBoxes = useRef<HTMLElement[]>([]); // free-positioned per-line text boxes (text action `pos`)
  const currentLine = useRef<HTMLElement | null>(null); // last line, for inline `append` fragments
  const fadeRef = useRef<gsap.core.Tween | null>(null); // active fade_out tween, killed on beat change
  // `a` is the counter_show action that built this box — renderAt compares against it (by
  // reference) to know whether the fold's current counter is the one already on screen, or
  // whether it needs to rebuild (design spec §7b §5). `value` is bookkeeping for the old
  // wall-clock scheduleAction path only (counter_add's relative delta); renderAt never reads it.
  const counterRef = useRef<{ box: HTMLElement; valueEl: HTMLElement; prefix: string; value: number; a: Extract<Action, { kind: "counter_show" }> } | null>(null);
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
  // resetFrom(0) clears both so a backward seek past this beat's start re-issues (ambiguity
  // res. #3) — an art/nightlight action is never itself torn down by resetFrom (it builds no
  // `built` cache entry), so without this the ref would go stale after a rebuild.
  const appliedArt = useRef<string | null>(null);
  const appliedNight = useRef<number | null>(null);
  const lastT = useRef(0);
  const [againRevealed, setAgainRevealed] = useState(false);

  useGSAP(() => {
    const host = scope.current;
    if (!host) return;
    const textHost = host.querySelector<HTMLElement>(".cin__text")!;
    // useGSAP defers context cleanup to unmount (not dependency change), so kill the
    // previous beat's master timeline + loopers explicitly to avoid zombie timelines
    // playing stale text/art into the new beat.
    masterRef.current?.kill();
    fadeRef.current?.kill();
    fadeRef.current = null;
    loopers.current.forEach((t) => t.kill());
    loopers.current = [];
    built.current.forEach((entry) => entry.tl?.kill());
    built.current.clear();
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
      runtime.art(runtime.resolveEnd(), "cut");
      // Replay the timeline's text steps to the settled end-state, honoring `clear`
      // (so a beat that clears then shows new text doesn't stack both).
      let counterStatic: { a: Extract<Action, { kind: "counter_show" }>; value: number } | null = null;
      const mediaStatic = new Map<string, Extract<Action, { kind: "media" }>>();
      for (const a of slots.beat.timeline) {
        if (a.kind === "clear" || a.kind === "fade_out") { textHost.innerHTML = ""; clearLineBoxes(); }
        else if (a.kind === "text") {
          if (print && a.screenOnly) continue;
          const el = a.append
            ? appendFragment(a.value)
            : appendText(a.pos ? makeLineBox(a.pos, a.align) : textHost, a.value, a.size, a.align, a.dots, true, a.tone);
          if (a.in === "cursive") el.classList.add("cin__line--cursive");
        }
        else if (a.kind === "rotateList" && a.items[0]) appendText(textHost, a.items[0], a.size ?? "md", undefined, false, true);
        else if (a.kind === "reveal_again") setAgainRevealed(true);
        else if (a.kind === "counter_show") counterStatic = { a, value: a.value ?? 0 };
        else if (a.kind === "counter_to" && counterStatic) counterStatic.value = a.value;
        else if (a.kind === "counter_add" && counterStatic) counterStatic.value += a.delta;
        else if (a.kind === "counter_hide") counterStatic = null;
        else if (a.kind === "media") mediaStatic.set(a.id, a);
        else if (a.kind === "media_move") { const m = mediaStatic.get(a.id); if (m) mediaStatic.set(a.id, { ...m, pos: a.to }); }
        else if (a.kind === "media_out") { if (a.id) mediaStatic.delete(a.id); else mediaStatic.clear(); }
      }
      if (counterStatic) showCounter({ ...counterStatic.a, value: counterStatic.value });
      mediaStatic.forEach((m) => { const el = makeMediaEl(m); stageParent()?.appendChild(el); mediaTiles.current.set(m.id, el); });
      runtime.onWaiting(true);
      return;
    }

    // Entry art: resolveEntry() already folds this beat's entry transition, so show
    // it as an absolute cross-fade using the entry op's mode.
    if (slots.beat.art) runtime.art(runtime.resolveEntry(), slots.beat.art.mode, slots.beat.art.durationMs);

    // Split the timeline into segments at click_gate boundaries; play one at a time and
    // wait for the user's forward input between them (robust intra-beat click-stepping —
    // GSAP addPause can't reliably stop callbacks scheduled at the same tick as the pause).
    const segments: Action[][] = [[]];
    for (const a of slots.beat.timeline) {
      if (a.kind === "click_gate") segments.push([]);
      else segments[segments.length - 1].push(a);
    }
    let segIdx = 0;
    const playSegment = () => {
      const seg = gsap.timeline({
        onComplete: () => {
          if (segIdx < segments.length - 1) {
            segIdx++;
            runtime.onGate(playSegment); // pause here; the user's next forward input resumes
          } else {
            runtime.onWaiting(true);
          }
        },
      });
      masterRef.current = seg;
      for (const a of segments[segIdx]) scheduleAction(seg, a, textHost);
      if (!segments[segIdx].length) seg.to({}, { duration: 0.001 }); // empty segment still ticks → onComplete
    };
    playSegment();

    // Test-only handle; Task 9 replaces this with the SlideTransport ref.
    (host.closest(".cin") as HTMLElement & { __renderAt?: (t: number) => void }).__renderAt = renderAt;

    // master + rotateList loops are created here / in deferred callbacks; kill them
    // on unmount (deps re-run also kills them at the top of the effect above).
    return () => {
      masterRef.current?.kill();
      loopers.current.forEach((t) => t.kill());
      loopers.current = [];
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

  /** Build the counter's DOM at rest (opacity 1, no offset) — no entrance animation here.
   *  Both the old wall-clock scheduleAction path (instant show) and renderAt's paint step
   *  (which applies the eased entrance itself, driven by fold progress) call this to (re)build
   *  the box; only renderAt scrubs its opacity/offset afterward (design spec §7b §5). */
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
    const value = a.value ?? 0;
    const prefix = a.prefix ?? "";
    valueEl.textContent = formatCounterValue(value, prefix);
    box.appendChild(valueEl);
    stageParent()?.appendChild(box);
    counterRef.current = { box, valueEl, prefix, value, a };
  }

  /** Old wall-clock scheduleAction path only: an instant snap to the counter's new target via
   *  the same pure counterValueAt renderAt uses (p=1, i.e. fully settled) — no GSAP tween.
   *  **Behaviour change**: this path used to animate the digits over `durationMs`; it no longer
   *  does (design spec §7b §5). renderAt's paintCounter is what makes this scrubbable/eased,
   *  driven by the fold's own progress — this function has no `p` to animate with. */
  function tweenCounter(a: { kind: "counter_to"; value: number } | { kind: "counter_add"; delta: number }) {
    const c = counterRef.current;
    if (!c) return;
    const target = counterTarget(c.value, a);
    c.valueEl.textContent = formatCounterValue(counterValueAt(c.value, target, 1), c.prefix);
    c.value = target;
  }

  /** Fade the counter to opacity `1 - p` — a direct write, not a tween (design spec §7b §5,
   *  ambiguity res. #3). At `p >= 1` it is fully hidden, so it is torn down. Used both by
   *  renderAt's paint step (varying `p` per frame) and the old scheduleAction path (a single
   *  `p = 1` call — an instant hide, replacing what used to fade over `durationMs`). */
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

  /** Old wall-clock scheduleAction path only: build the tile at rest, no entrance tween.
   *  **Behaviour change**: this used to gsap.from-tween in over `durationMs`; it no longer
   *  does (design spec §7b §6, same shape as Task 5's counter conversion). renderAt's
   *  paintMedia is what makes the entrance scrubbable, driven by the fold's own progress via
   *  the pure mediaStateAt — this function has no `p` to animate with. */
  function showMedia(a: Extract<Action, { kind: "media" }>) {
    mediaTiles.current.get(a.id)?.remove();
    const el = makeMediaEl(a);
    stageParent()?.appendChild(el);
    mediaTiles.current.set(a.id, el);
  }

  /** Old wall-clock scheduleAction path only: an instant snap to the tile's new position/scale
   *  — no GSAP tween. **Behaviour change**: this used to gsap.to-tween over `durationMs`; see
   *  showMedia's note. */
  function moveMedia(a: Extract<Action, { kind: "media_move" }>) {
    const el = mediaTiles.current.get(a.id);
    if (!el) return;
    el.style.left = `${a.to.x * 100}%`;
    el.style.top = `${a.to.y * 100}%`;
    if (a.scale != null) gsap.set(el, { scale: a.scale });
  }

  /** Old wall-clock scheduleAction path only: an instant removal — no fade tween. **Behaviour
   *  change**: this used to gsap.to-tween opacity to 0 over `durationMs` before removing; see
   *  showMedia's note. `a.id` omitted clears every tile (design spec §7b §6, ambiguity res. #3). */
  function outMedia(a: Extract<Action, { kind: "media_out" }>) {
    const ids = a.id ? [a.id] : [...mediaTiles.current.keys()];
    for (const id of ids) {
      const el = mediaTiles.current.get(id);
      if (!el) continue;
      mediaTiles.current.delete(id);
      el.remove();
    }
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
   *  downgraded) `in` style. Used by both the scheduled autoplay path (scheduleAction) and
   *  the paused seekable path (buildText) so the branch mapping lives in exactly one place. */
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

  /** Build one text action's element + its real reveal timeline, paused at 0. Reuses the same
   *  el-creation + effect-selection logic as scheduleAction's `text` case (design spec §7b §4.2). */
  function buildText(a: Extract<Action, { kind: "text" }>, host: HTMLElement): { el: HTMLElement; tl: gsap.core.Timeline | null; box?: HTMLElement } {
    const perPiece: TextIn[] = ["letterFly", "letterUp", "wordUp", "blurIn", "typewriter", "cursive"];
    const effIn: TextIn = hasInlineMarkup(a.value) && perPiece.includes(a.in) ? "fade" : a.in;
    // instantText / no-reveal lines have no entrance: they render at rest, and (matching
    // scheduleAction's equivalent branch) their dots render already-faded-in via `instant`.
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
    // A reset from the very start of the timeline also invalidates any art/nightlight already
    // issued to the (external, sibling) ArtStage — otherwise a backward seek to before this
    // beat's first art/nightlight action leaves the stage showing state from time already left
    // (ambiguity res. #3). Only index 0 qualifies: resetting from a later index means art before
    // it is still correctly applied and must NOT be re-issued (that would restart its crossfade
    // for no reason).
    if (index === 0) { appliedArt.current = null; appliedNight.current = null; }
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

  /** Paint the beat's visual state at beat-local time `t` (text, clear/fade_out, and counter
   *  actions — Tasks 6-8 bring media/art/nightlight/rotateList under this path). PAUSED
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
    for (const f of foldAt(slots.beat.timeline, t)) {
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
      if (f.action.kind === "clear") {
        // Settled the instant it's reached (0 duration): drop everything built before it.
        resetFrom(0);
        host.innerHTML = "";
        clearLineBoxes();
        continue;
      }
      if (f.action.kind === "fade_out") {
        if (f.phase === "settled") {
          // Terminal: the fade has fully played out — same teardown as `clear`. Only takes
          // effect once settled; see the in-flight branch below for the scrubbable ramp.
          resetFrom(0);
          host.innerHTML = "";
          clearLineBoxes();
          gsap.set(host, { clearProps: "opacity" });
          continue;
        }
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
        // would restart that crossfade continuously (design spec §7b §7). Compare by a stable
        // JSON serialisation since the action's object identity changes every render.
        const key = JSON.stringify(f.action.art);
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
      if (f.action.kind !== "text") continue; // other kinds (rotateList): Task 8
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
    lastT.current = t;
  }

  function scheduleAction(master: gsap.core.Timeline, a: Action, host: HTMLElement) {
    switch (a.kind) {
      case "text": {
        // Investor deck: no text-in transition. Append the line at rest and reserve a tick so the
        // segment still completes (→ click_gate / onWaiting). click-stepping is unaffected.
        // A line with `reveal: true` opts back into its `in` animation (falls through below).
        if (instantText && !a.reveal) {
          master.add(() => {
            const el = a.append
              ? appendFragment(a.value)
              : appendText(a.pos ? makeLineBox(a.pos, a.align) : host, a.value, a.size, a.align, a.dots, true, a.tone);
            if (a.in === "cursive") el.classList.add("cin__line--cursive");
          });
          master.to({}, { duration: 0.01 });
          break;
        }
        // Inline links can't survive SplitText (it re-splits the anchor text); fall back to a
        // line-level fade when a per-piece effect is paired with a linked value. Hoisted out of
        // the master.add callback so the time-reservation below can size by the effective effect.
        const perPiece: TextIn[] = ["letterFly", "letterUp", "wordUp", "blurIn", "typewriter", "cursive"];
        const effIn: TextIn = hasInlineMarkup(a.value) && perPiece.includes(a.in) ? "fade" : a.in;
        master.add(() => {
          const el = a.append
            ? appendFragment(a.value) // inline fragment on the current line
            : appendText(a.pos ? makeLineBox(a.pos, a.align) : host, a.value, a.size, a.align, a.dots, false, a.tone);
          if (a.in === "cursive") el.classList.add("cin__line--cursive"); // script font + larger size
          return buildTextEffect(el, effIn, a);
        });
        // Reserve ≈ this line's intro duration so the master's onComplete (→ onWaiting)
        // fires after the line settles, not before. Tune pacing/overlap live in Phase 2.
        master.to({}, { duration: introDuration({ ...a, in: effIn }) });
        break;
      }
      case "rotateList": {
        master.add(() => {
          const slot = document.createElement("span");
          slot.className = `cin__rotslot cin__line--${a.size ?? "md"}`; // size from cinematic-style (default md)
          host.appendChild(slot);
          const loop = rotateList(slot, a.items);
          loopers.current.push(loop);
        });
        break;
      }
      // Clears the text/free-lines only — the intro logo+tagline persist (they leave when
      // the beat unmounts on advance), so clearing a CTA line doesn't drop the splash.
      case "clear": master.add(() => {
        loopers.current.forEach((t) => t.kill()); loopers.current = []; host.innerHTML = ""; clearLineBoxes();
      }); break;
      case "art": master.add(() => runtime.applyArt(a.art, a.art.durationMs)); break;
      case "nightlight": master.add(() => runtime.setNightlight(a.to, a.durationMs)); break;
      // cue / note_emitter / note_circle / stop_circle / stop_notes are NOT scheduled here.
      // Note sources render from the pure noteFieldStateAt reducer via NoteField (see
      // engine/components/effects/note-state.ts), driven by whatever clock the host supplies —
      // the same split objects use. `cue` is inert; the kind survives in types.ts for
      // deck-format compatibility only.
      // click_gate is a segment boundary handled in useGSAP (timeline segmentation), not here.
      case "click_gate": break;
      case "reveal_arrows": master.add(() => runtime.revealArrows()); break;
      case "reveal_again": master.add(() => setAgainRevealed(true)); break;
      case "pulse_arrow": master.add(() => runtime.pulseArrow(a.which, a.scale ?? 3)); break;
      case "fade_out": {
        const d = (a.durationMs ?? 500) / 1000;
        // Fade the live text out, then clear it as a SEQUENCED master step (the clear
        // must run before the master plays the next actions, or a following `text`
        // append races it). Track the tween so the cleanup can KILL it before restoring
        // opacity — otherwise the still-live tween renders its final opacity:0 frame
        // after clearProps and leaves the (persistent, reused) box invisible.
        master.add(() => {
          fadeRef.current = gsap.to([host, ...lineBoxes.current], { opacity: 0, duration: d, ease: "power2.inOut" });
        });
        master.to({}, { duration: d }); // let the fade play out
        master.add(() => {
          fadeRef.current?.kill();
          fadeRef.current = null;
          loopers.current.forEach((t) => t.kill());
          loopers.current = [];
          host.innerHTML = "";
          clearLineBoxes();
          gsap.set(host, { clearProps: "opacity" }); // restore the box so the next line is visible
        });
        break;
      }
      case "wait": master.to({}, { duration: a.ms / 1000 }); break;
      case "counter_show": master.add(() => showCounter(a)); master.to({}, { duration: 0.4 }); break;
      case "counter_to":
      case "counter_add": {
        const ms = a.durationMs ?? 800;
        master.add(() => tweenCounter(a));
        master.to({}, { duration: ms / 1000 });
        break;
      }
      case "counter_hide": master.add(() => hideCounter(1)); break;
      case "media": master.add(() => showMedia(a)); master.to({}, { duration: (a.durationMs ?? 600) / 1000 }); break;
      case "media_move": master.add(() => moveMedia(a)); master.to({}, { duration: (a.durationMs ?? 800) / 1000 }); break;
      case "media_out": master.add(() => outMedia(a)); master.to({}, { duration: (a.durationMs ?? 500) / 1000 }); break;
    }
  }

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
