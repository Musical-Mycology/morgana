"use client";

import { useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { ArtMode, ArtTransition, CinematicSlideSlots, Action, EffectCue, TextIn, TextSize, TextAlign, StagePoint, SlideTheme, PanelSpec } from "@/engine/deck/types";
import type { StoryAsset } from "@/engine/deck/story-assets";
import { renderPanelHTML } from "@/engine/deck/panel";
import { useAssetResolver } from "@/engine/asset-resolver-react";
import { TEXT_SIZES, CURSIVE_SIZE, DEFAULT_TEXT_POS } from "@/engine/deck/cinematic-style";
import { parseInlineLinks, hasInlineMarkup } from "@/engine/deck/inline-links";
import { formatCounterValue, counterTarget } from "@/engine/deck/counter";
import {
  flyUp, fadeIn, fadeSide, dotFade, rotateList, lineAndDots,
  letterFly, letterUp, wordUp, blurIn, typewriter,
} from "../effects/cinematic-anim";

// First-pass intro durations (mirror the builders in cinematic-anim.ts); used to
// reserve master-timeline time so onWaiting fires after a line settles, not before.
// Letter/word effects run longer (per-piece stagger). Pacing is tuned live.
const INTRO_DUR: Record<TextIn, number> = {
  flyUp: 0.6, fade: 0.8, fadeSide: 0.7, cursive: 1.0,
  letterFly: 1.6, letterUp: 1.6, wordUp: 1.3, blurIn: 1.6, typewriter: 1.5,
};
const DOTFADE_TAIL = 2.02; // dotFade total ≈ tick-on 0.62 + hold 0.8 + fade 0.6
// Time to reserve before the next timeline step, ≈ this line's actual reveal duration.
// For per-letter/word effects it's derived from the real char/word count × stagger, so a
// slower `speed` only lengthens the letters (no inflated dead time); line effects use a
// fixed base. Mirrors the stagger constants in cinematic-anim.ts.
function introDuration(a: { in: TextIn; value: string; dots?: true; speed?: number }): number {
  const sp = a.speed ?? (a.in === "cursive" ? 0.2 : 1); // cursive defaults to a slow type-on
  const chars = a.value.length;
  const words = a.value.trim().split(/\s+/).length;
  let base: number;
  switch (a.in) {
    case "cursive": // cursive reveals via typewriter
    case "typewriter": base = 0.1 + chars * 0.045; break;
    case "letterFly":
    case "letterUp":
    case "blurIn":     base = 0.5 + chars * 0.03; break;
    case "wordUp":     base = 0.6 + words * 0.08; break;
    default:           base = INTRO_DUR[a.in]; // line-level fixed
  }
  return (base + (a.dots ? DOTFADE_TAIL : 0)) / sp;
}

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
  cue(c: EffectCue): void;
  /** Start a placeable directional note emitter (note_emitter action). */
  emitter(opts: { color: string; x: number; y: number; dir: number; spread: number; decayMs: number; freq: number }): void;
  /** Start a placeable orbiting note ring (note_circle action). speed is ms per orbit. */
  noteCircle(opts: { x: number; y: number; width: number; height: number; hex: string[]; bounce: number; notes: number; speed: number }): void;
  /** Stop all note sources (stop_notes action). */
  stopNotes(): void;
  /** Stop only the orbiting note rings (stop_circle action). */
  stopCircles(): void;
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
  /** True when rendering for PDF print — suppresses screenOnly text actions. */
  print?: boolean;
  /** Investor deck: render narration text instantly (no per-line entrance animation).
   *  click_gates still step the timeline; only the text-in reveal is suppressed. */
  instantText?: boolean;
}

export function CinematicSlide({ slots, animate, runtime, print, instantText }: Props) {
  const assets = useAssetResolver();
  const scope = useRef<HTMLDivElement>(null);
  const loopers = useRef<gsap.core.Timeline[]>([]);
  const masterRef = useRef<gsap.core.Timeline | null>(null);
  const lineBoxes = useRef<HTMLElement[]>([]); // free-positioned per-line text boxes (text action `pos`)
  const currentLine = useRef<HTMLElement | null>(null); // last line, for inline `append` fragments
  const fadeRef = useRef<gsap.core.Tween | null>(null); // active fade_out tween, killed on beat change
  const counterRef = useRef<{ valueEl: HTMLElement; value: number; prefix: string } | null>(null);
  const mediaTiles = useRef<Map<string, HTMLElement>>(new Map());
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

    // master + rotateList loops are created here / in deferred callbacks; kill them
    // on unmount (deps re-run also kills them at the top of the effect above).
    return () => {
      masterRef.current?.kill();
      loopers.current.forEach((t) => t.kill());
      loopers.current = [];
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
    counterRef.current = { valueEl, value, prefix };
    gsap.from(box, { opacity: 0, y: 12, duration: 0.4, ease: "power2.out" });
  }

  function tweenCounter(
    a: { kind: "counter_to"; value: number } | { kind: "counter_add"; delta: number },
    ms: number,
  ) {
    const c = counterRef.current;
    if (!c) return;
    const target = counterTarget(c.value, a);
    const proxy = { v: c.value };
    gsap.to(proxy, {
      v: target,
      duration: ms / 1000,
      ease: "power2.out",
      onUpdate: () => { c.valueEl.textContent = formatCounterValue(proxy.v, c.prefix); },
      onComplete: () => { c.valueEl.textContent = formatCounterValue(target, c.prefix); },
    });
    c.value = target;
  }

  function hideCounter(ms: number) {
    const c = counterRef.current;
    if (!c) return;
    const box = c.valueEl.parentElement;
    counterRef.current = null;
    if (box) gsap.to(box, { opacity: 0, duration: ms / 1000, onComplete: () => box.remove() });
  }

  function clearCounter() {
    counterRef.current?.valueEl.parentElement?.remove();
    counterRef.current = null;
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

  function showMedia(a: Extract<Action, { kind: "media" }>) {
    mediaTiles.current.get(a.id)?.remove();
    const el = makeMediaEl(a);
    stageParent()?.appendChild(el);
    mediaTiles.current.set(a.id, el);
    const dur = (a.durationMs ?? 600) / 1000;
    const mode = a.in ?? "fade";
    if (mode === "flyUp") gsap.from(el, { y: 40, opacity: 0, duration: dur, ease: "power3.out" });
    else if (mode === "pop") gsap.from(el, { scale: 0.8, opacity: 0, duration: dur, ease: "back.out(2)" });
    else if (mode === "fadeSide") gsap.from(el, { x: 24, opacity: 0, duration: dur, ease: "power2.out" });
    else gsap.from(el, { opacity: 0, duration: dur, ease: "power2.out" });
  }

  function moveMedia(a: Extract<Action, { kind: "media_move" }>) {
    const el = mediaTiles.current.get(a.id);
    if (!el) return;
    gsap.to(el, {
      left: `${a.to.x * 100}%`,
      top: `${a.to.y * 100}%`,
      ...(a.scale != null ? { scale: a.scale } : {}),
      duration: (a.durationMs ?? 800) / 1000,
      ease: "power3.inOut",
    });
  }

  function outMedia(a: Extract<Action, { kind: "media_out" }>) {
    const dur = (a.durationMs ?? 500) / 1000;
    const ids = a.id ? [a.id] : [...mediaTiles.current.keys()];
    for (const id of ids) {
      const el = mediaTiles.current.get(id);
      if (!el) continue;
      mediaTiles.current.delete(id);
      gsap.to(el, { opacity: 0, duration: dur, onComplete: () => el.remove() });
    }
  }

  function clearMedia() {
    mediaTiles.current.forEach((el) => el.remove());
    mediaTiles.current.clear();
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
      case "cue": master.add(() => runtime.cue(a.cue)); break;
      case "note_emitter": master.add(() => runtime.emitter({
        color: a.color, x: a.pos.x, y: a.pos.y, dir: a.dir, spread: a.var ?? 0, decayMs: a.decay, freq: a.freq,
      })); break;
      case "note_circle": master.add(() => runtime.noteCircle({
        x: a.pos.x, y: a.pos.y, width: a.width, height: a.height, hex: a.hex,
        bounce: a.bounce ?? 0, notes: a.notes ?? 8, speed: a.speed ?? 6000,
      })); break;
      case "stop_circle": master.add(() => runtime.stopCircles()); break;
      case "stop_notes": master.add(() => runtime.stopNotes()); break;
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
        master.add(() => tweenCounter(a, ms));
        master.to({}, { duration: ms / 1000 });
        break;
      }
      case "counter_hide": master.add(() => hideCounter(a.durationMs ?? 400)); break;
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
        {slots.sceneId === "intro" && (
          <div className="cin__splash">
            <img className="cin__logo" src={assets.brand("logo_day_angelring.png")} alt="Musical Mycology" />
            <p className="cin__tagline">Connecting People and Music</p>
          </div>
        )}
        <div className="cin__text" style={{ left: anchor.left || undefined, right: anchor.right || undefined, top: `${pos.y * 100}%`, transform: anchor.transform || undefined }} />
        {slots.beat.id === "fin" && againRevealed && (
          <div className="cin__ending">
            <div className="cin__ending-row">
              <a className="cin__cta" href="/vision/">Why it&rsquo;s important</a>
              <a className="cin__cta" href="/vision/#vision-solution">How we will do it</a>
            </div>
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
        .cin__stage { position: fixed; inset: 0; margin: auto; z-index: 2; pointer-events: none;
          width: min(100vw, calc(100vh * 16 / 9)); height: min(100vh, calc(100vw * 9 / 16)); }
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
        .deck--warm .cin__line--lg, .deck--paper .cin__line--lg { font-size: clamp(2rem, 5.6vmin, 3.4rem); line-height: 1.1; }
        .deck--warm .cin__line--md, .deck--paper .cin__line--md { font-size: clamp(1.1rem, 3vmin, 1.6rem); line-height: 1.3; }
        .deck--warm .cin__line--sm, .deck--paper .cin__line--sm { font-size: clamp(1rem, 2.7vmin, 1.45rem); font-family: var(--font-body); line-height: 1.35; opacity: 1; }
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
          font-size: clamp(0.7rem, 2vmin, 1rem); line-height: 1.1; color: var(--color-mm-cream);
          text-shadow: 0 1px 8px rgba(0,0,0,0.5); }
        .deck--paper .cin__media-cap { color: var(--color-mm-mushroom); text-shadow: none; }
        /* Stub placeholders keep their label inside the dashed box. */
        .cin__media--round { aspect-ratio: 1 / 1; border-radius: 50%; overflow: hidden; }
        .cin__media--stub { box-sizing: border-box; aspect-ratio: 16 / 10; display: flex; align-items: center;
          justify-content: center; text-align: center; white-space: pre-line; padding: 0.6em;
          font-family: var(--font-display); font-size: clamp(0.7rem, 2.4vmin, 1.05rem);
          line-height: 1.2; color: var(--color-mm-cream); background: rgba(40,28,22,0.55);
          border: 2px dashed var(--color-mm-mushroom); border-radius: 12px;
          text-shadow: 0 1px 8px rgba(0,0,0,0.5); }
        .cin__media--round.cin__media--stub { aspect-ratio: 1 / 1; border-radius: 50%; }
        /* Native data panels (funding / financials / SAFE terms). Treatment-aware skins below. */
        .cin__panel { box-sizing: border-box; border-radius: 12px; padding: 1em 1.1em; text-align: left;
          font-family: var(--font-body); font-size: clamp(0.7rem, 2.2vmin, 1rem); line-height: 1.5; }
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
        .cin__logo { width: clamp(220px, 30vw, 460px); height: auto; filter: drop-shadow(0 4px 24px rgba(0,0,0,0.3)); }
        .cin__tagline { margin: 0; font-family: var(--font-display); font-weight: 400;
          font-size: clamp(1.5rem, 2.8vw, 2.4rem); letter-spacing: 0.01em; text-align: center; }
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
          font-family: var(--font-display); font-size: clamp(1rem, 1.8vw, 1.4rem); letter-spacing: 0.03em;
          color: var(--color-mm-cream); background: var(--color-mm-dark-brown); border: 0; border-radius: 999px;
          padding: 0.55em 1.6em; box-shadow: 0 2px 12px rgba(0,0,0,0.45);
          transition: transform 0.15s, background 0.15s; }
        .cin__cta:hover { background: var(--color-mm-mushroom); transform: scale(1.04); }
        /* Quiet replay — ghost button, secondary to the Vision links. */
        .cin__again { pointer-events: auto; cursor: pointer; font-family: var(--font-display);
          font-size: clamp(0.9rem, 1.5vw, 1.15rem); letter-spacing: 0.03em; color: var(--color-mm-cream);
          background: transparent; border: 0; border-radius: 999px; padding: 0.35em 1.1em; opacity: 0.78;
          text-shadow: 0 2px 10px rgba(0,0,0,0.55); transition: opacity 0.15s, transform 0.15s; }
        .cin__again:hover { opacity: 1; transform: scale(1.04); }
      `}</style>
    </div>
  );
}
