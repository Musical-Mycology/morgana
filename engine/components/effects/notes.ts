import gsap from "gsap";
import { NOTE_TINTS, NOTE_GLYPHS, type NoteColor, type NoteGlyph, type StoryAsset } from "@/engine/deck/story-assets";

/** Build a tinted, glowing note sprite element (glyph is white line-art → mask + bg color). */
export function makeNote(color: NoteColor, glyph: NoteGlyph, resolveStory: (key: StoryAsset) => string): HTMLElement {
  const el = document.createElement("span");
  const { fill, glow } = NOTE_TINTS[color];
  const url = resolveStory(glyph);
  Object.assign(el.style, {
    position: "absolute", width: "42px", height: "42px",
    backgroundColor: fill,
    WebkitMaskImage: `url(${url})`, maskImage: `url(${url})`,
    WebkitMaskSize: "contain", maskSize: "contain",
    WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
    filter: `drop-shadow(0 0 6px ${glow})`,
    willChange: "transform, opacity",
  } as unknown as CSSStyleDeclaration);
  return el;
}

/** Like makeNote but tinted to an arbitrary HEX color (fill + glow). */
export function makeNoteHex(hex: string, glyph: NoteGlyph, resolveStory: (key: StoryAsset) => string): HTMLElement {
  const el = document.createElement("span");
  const url = resolveStory(glyph);
  Object.assign(el.style, {
    position: "absolute", width: "42px", height: "42px",
    backgroundColor: hex,
    WebkitMaskImage: `url(${url})`, maskImage: `url(${url})`,
    WebkitMaskSize: "contain", maskSize: "contain",
    WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
    filter: `drop-shadow(0 0 6px ${hex})`,
    willChange: "transform, opacity",
  } as unknown as CSSStyleDeclaration);
  return el;
}

const GLYPHS = NOTE_GLYPHS.filter((g) => g.startsWith("Notes")) as NoteGlyph[];
export function randomGlyph(i: number): NoteGlyph { return GLYPHS[i % GLYPHS.length]; }

const EMIT_SPEED = 130; // px/sec a launched note travels — tune

/**
 * Launch one note from (x,y)px traveling in compass direction `dirDeg`
 * (0 = up, 90 = right, 180 = down, 270 = left) ± `spreadDeg`, living `decayMs`.
 * Self-removes on completion.
 */
export function launchNote(
  host: HTMLElement, hex: string, x: number, y: number,
  dirDeg: number, spreadDeg: number, decayMs: number, i: number,
  resolveStory: (key: StoryAsset) => string,
): void {
  const el = makeNoteHex(hex, randomGlyph(i), resolveStory);
  el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.opacity = "0";
  host.appendChild(el);
  const theta = ((dirDeg + (Math.random() * 2 - 1) * spreadDeg) * Math.PI) / 180;
  const dur = Math.max(0.1, decayMs / 1000);
  const dist = EMIT_SPEED * dur * (0.8 + Math.random() * 0.4);
  const dx = Math.sin(theta) * dist;          // compass → screen vector
  const dy = -Math.cos(theta) * dist;         // up = -y
  const tl = gsap.timeline({ onComplete: () => el.remove() });
  tl.fromTo(el, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: Math.min(0.4, dur * 0.4), ease: "back.out(2)" }, 0);
  tl.to(el, { x: dx, y: dy, duration: dur, ease: "power1.out" }, 0);
  tl.to(el, { opacity: 0, duration: dur * 0.4, ease: "power1.in" }, dur * 0.6);
}

/** Emit a note from (x,y) px: bounce in, drift up, fade. Returns its tween. */
export function emitNote(
  host: HTMLElement, color: NoteColor, x: number, y: number, i: number,
  resolveStory: (key: StoryAsset) => string,
) {
  const el = makeNote(color, randomGlyph(i), resolveStory);
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  el.style.opacity = "0";
  host.appendChild(el);
  const tl = gsap.timeline({ onComplete: () => el.remove() });
  tl.fromTo(el, { scale: 0.4, opacity: 0 }, { scale: 1.0, opacity: 1, duration: 0.45, ease: "back.out(2)" }); // bounce-in
  tl.to(el, { y: "-=120", x: `+=${(i % 2 ? 1 : -1) * 24}`, opacity: 0, duration: 2.4, ease: "power1.out" }, "-=0.1");
  return tl;
}
