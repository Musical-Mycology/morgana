import gsap from "gsap";
import { SplitText } from "gsap/SplitText";

// SplitText ships free in gsap >= 3.13. Register once (guard for SSR import safety).
if (typeof window !== "undefined") gsap.registerPlugin(SplitText);

/** Split a trailing "…" or "..." off a line; returns dot count for dotFade. */
export function lineAndDots(value: string): { line: string; dots: number } {
  const m = value.match(/(…|\.\.\.)\s*$/);
  if (!m) return { line: value, dots: 0 };
  return { line: value.slice(0, m.index).trimEnd(), dots: 3 };
}

const FLY_Y = 40; // px — first-pass; tune live

// `speed` is a per-line multiplier (default 1). Higher = faster, lower = slower —
// every duration/stagger below is divided by it. Set it via `speed:` on a text action.
export function flyUp(el: HTMLElement, speed = 1): gsap.core.Timeline {
  return gsap.timeline().from(el, { y: FLY_Y, opacity: 0, duration: 0.6 / speed, ease: "power3.out" });
}
export function fadeIn(el: HTMLElement, speed = 1): gsap.core.Timeline {
  return gsap.timeline().from(el, { opacity: 0, duration: 0.8 / speed, ease: "power2.out" });
}
export function fadeSide(el: HTMLElement, speed = 1): gsap.core.Timeline {
  return gsap.timeline().from(el, { x: 24, opacity: 0, duration: 0.7 / speed, ease: "power2.out" });
}
export function cursiveIn(el: HTMLElement, speed = 1): gsap.core.Timeline {
  return gsap.timeline().from(el, { opacity: 0, scale: 0.9, duration: 1.0 / speed, ease: "power2.out" });
}

/** Tick the trailing dots on one-by-one, hold, then fade the dots away. */
export function dotFade(dotsEl: HTMLElement): gsap.core.Timeline {
  const dots = Array.from(dotsEl.querySelectorAll<HTMLElement>(".dot"));
  const tl = gsap.timeline();
  tl.from(dots, { opacity: 0, duration: 0.18, stagger: 0.22, ease: "none" });
  tl.to(dots, { opacity: 0, duration: 0.6, ease: "power1.in" }, "+=0.8");
  return tl;
}

/**
 * Cycle list items flying up into a fixed gap, holding, flying out, looping.
 * Returns the timeline (repeat: -1) so the caller can kill it when the beat advances.
 */
export function rotateList(slotEl: HTMLElement, items: string[]): gsap.core.Timeline {
  const tl = gsap.timeline({ repeat: -1 });
  items.forEach((text) => {
    tl.call(() => { slotEl.textContent = text; });
    tl.fromTo(slotEl, { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" });
    tl.to(slotEl, { y: -28, opacity: 0, duration: 0.45, ease: "power2.in" }, "+=1.1");
  });
  return tl;
}

/* ── Per-letter / per-word effects (GSAP SplitText) ──────────────────────────
   Each splits the line, animates the pieces, then reverts on complete so the
   DOM/copy-paste/screen-reader text is restored (SplitText `aria:"auto"` keeps
   the line readable while split). First-pass timings; tune live. */

/** Letters fly in from the justified side (left-justified → from left, etc.). */
export function letterFly(el: HTMLElement, dir: "left" | "right" = "left", speed = 1): gsap.core.Timeline {
  const split = SplitText.create(el, { type: "chars,words", mask: "chars", aria: "auto" });
  const tl = gsap.timeline({ onComplete: () => split.revert() });
  tl.from(split.chars, {
    x: dir === "left" ? -40 : 40, opacity: 0, duration: 0.5 / speed, ease: "power3.out",
    stagger: { each: 0.03 / speed, from: dir === "left" ? "start" : "end" },
  });
  return tl;
}

/** Letters rise + fade in, staggered left→right. */
export function letterUp(el: HTMLElement, speed = 1): gsap.core.Timeline {
  const split = SplitText.create(el, { type: "chars", mask: "chars", aria: "auto" });
  const tl = gsap.timeline({ onComplete: () => split.revert() });
  tl.from(split.chars, { yPercent: 120, opacity: 0, duration: 0.5 / speed, ease: "back.out(1.7)", stagger: 0.03 / speed });
  return tl;
}

/**
 * Whole words slide up from behind a mask, one after another.
 *
 * `splitLines` (default true) adds line wrappers so a multi-line value reveals
 * line-by-line. Pass false for an INLINE appended fragment: the "lines" split
 * wraps the fragment in a block-level <div>, which would drop it onto its own
 * line during the reveal and then snap it back up on revert — so an append must
 * split words-only to stay inline on its host line.
 */
export function wordUp(el: HTMLElement, speed = 1, splitLines = true): gsap.core.Timeline {
  const split = SplitText.create(el, { type: splitLines ? "words,lines" : "words", mask: "words", aria: "auto" });
  const tl = gsap.timeline({ onComplete: () => split.revert() });
  tl.from(split.words, { yPercent: 110, opacity: 0, duration: 0.6 / speed, ease: "power4.out", stagger: 0.08 / speed });
  return tl;
}

/** Letters resolve from a blur into focus. */
export function blurIn(el: HTMLElement, speed = 1): gsap.core.Timeline {
  const split = SplitText.create(el, { type: "chars", aria: "auto" });
  const tl = gsap.timeline({ onComplete: () => split.revert() });
  tl.fromTo(split.chars,
    { filter: "blur(10px)", opacity: 0 },
    { filter: "blur(0px)", opacity: 1, duration: 0.6 / speed, ease: "power2.out", stagger: 0.03 / speed });
  return tl;
}

/** Typewriter — letters pop on one-by-one, instant. `speed` < 1 slows the keystrokes. */
export function typewriter(el: HTMLElement, speed = 1): gsap.core.Timeline {
  const split = SplitText.create(el, { type: "chars", aria: "auto" });
  const tl = gsap.timeline({ onComplete: () => split.revert() });
  tl.from(split.chars, { opacity: 0, duration: 0.01, ease: "none", stagger: 0.045 / speed });
  return tl;
}
