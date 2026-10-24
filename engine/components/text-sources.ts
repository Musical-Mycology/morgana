/** Word-box measurement for text-particle sources (sub-project 6). Every box is measured AT REST:
 *  from layout offsets (offsetLeft/offsetTop ignore transforms) plus a rect, so a line's reveal
 *  effect (flyUp, letterFly…) or a credits roll's translateY never moves its boxes. Results are 0–1
 *  fractions of the stage rect `sr`.
 *
 *  Determinism (ruling F3): a text line is never measured live. The live line may be mid-SplitText
 *  (chars/words/lines wrapped in masks, reverted only when its reveal completes), and so may its
 *  siblings, which move it and resize its box. So a frame reached by stepping (measured while a
 *  line was split) and the same frame reached by jumping (measured after the revert) would
 *  disagree. Instead the whole host is replicated at rest — same element, classes and inline
 *  anchor, every child rebuilt from its source value — and the words are measured inside that
 *  replica, which is removed again before anything paints. */
import type { TextRect } from "@/engine/components/effects/note-state";
import { wordRuns } from "@/engine/components/effects/draw-state";

export const WORD_CLASS = "cin__mw";

/** Wrap every non-space run of `root`'s text nodes (nested markup included) in a span.cin__mw. */
export function wrapWords(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  for (const t of texts) {
    if (!/\S/.test(t.data)) continue;
    const frag = document.createDocumentFragment();
    for (const part of t.data.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
      const span = document.createElement("span");
      span.className = WORD_CLASS;
      span.textContent = part;
      frag.appendChild(span);
    }
    t.replaceWith(frag);
  }
}

/** A fresh, at-rest element standing in for the live line `el`: same tag (selectors such as
 *  `p.cin__line--lg` must still match), classes and alignment, none of an effect's inline styles
 *  or split pieces. `fill` writes its content. */
export function restLine(el: Element, fill: (clone: HTMLElement) => void): HTMLElement {
  const c = document.createElement(el.tagName.toLowerCase());
  c.className = el.className;
  const align = (el as HTMLElement).style?.textAlign;
  if (align) c.style.textAlign = align;
  fill(c);
  return c;
}

/** What a live child of a measured host becomes in its at-rest replica. */
export interface RestChild {
  /** The at-rest stand-in (fresh, detached). */
  node: HTMLElement;
  /** Measure it: "words" = its .cin__mw spans (never those inside `.dots`: dots don't emit, ruling
   *  F10); `{ draw }` = a draw line's SVG glyph extents, one box per word of `draw`. */
  measure?: "words" | { draw: string };
}

const norm = (x: number, y: number, w: number, h: number, sr: DOMRect): TextRect =>
  ({ x: (x - sr.left) / sr.width, y: (y - sr.top) / sr.height, w: w / sr.width, h: h / sr.height });

/** `el`'s border-box offset from `root`'s padding box, through the offsetParent chain (layout px). */
function offsetWithin(el: HTMLElement, root: HTMLElement): { x: number; y: number } {
  let x = 0, y = 0;
  for (let n: HTMLElement | null = el; n && n !== root;) {
    x += n.offsetLeft;
    y += n.offsetTop;
    const p = n.offsetParent as HTMLElement | null;
    if (p && p !== root) { x += p.clientLeft; y += p.clientTop; }
    n = p;
  }
  return { x, y };
}

/** Measure the children of `host` at rest. The replica is a shallow clone of `host` (same classes
 *  and inline anchor: left/right/top/transform) placed right after it, so it resolves exactly as
 *  the host would with every child at rest. `rest(child)` gives each child's stand-in; null =
 *  clone the child as it is. Returns the word boxes of every child whose stand-in asks to be
 *  measured, keyed by the LIVE child. The replica is removed before returning. */
export function atRestRects(host: HTMLElement, rest: (child: Element) => RestChild | null, sr: DOMRect): Map<Element, TextRect[]> {
  const out = new Map<Element, TextRect[]>();
  const parent = host.parentElement;
  if (!parent) return out;
  const replica = host.cloneNode(false) as HTMLElement;
  replica.setAttribute("aria-hidden", "true");
  replica.style.visibility = "hidden";
  replica.style.pointerEvents = "none";
  const measured: [Element, HTMLElement, NonNullable<RestChild["measure"]>][] = [];
  for (const child of Array.from(host.childNodes)) {
    const r = child instanceof Element ? rest(child) : null;
    replica.appendChild(r?.node ?? child.cloneNode(true));
    if (r?.measure) measured.push([child as Element, r.node, r.measure]);
  }
  host.after(replica);
  try {
    const rr = replica.getBoundingClientRect();
    // Offsets are layout px; rects are on-screen px. A scaled ancestor (an editor thumbnail) makes
    // them differ — k maps one onto the other (1 when there is no layout, e.g. jsdom).
    const k = replica.offsetWidth > 0 ? rr.width / replica.offsetWidth : 1;
    const ox = rr.left + replica.clientLeft * k;
    const oy = rr.top + replica.clientTop * k;
    for (const [live, node, how] of measured) {
      const rects: TextRect[] = [];
      if (how === "words") {
        for (const w of Array.from(node.querySelectorAll<HTMLElement>(`.${WORD_CLASS}`))) {
          if (w.closest(".dots")) continue;
          const o = offsetWithin(w, replica);
          rects.push(norm(ox + o.x * k, oy + o.y * k, w.offsetWidth * k, w.offsetHeight * k, sr));
        }
      } else {
        // getExtentOfChar is in the svg's user space = layout px from its top-left, which sits on
        // the .cin__draw-wrap's top-left.
        const wrap = node.querySelector<HTMLElement>(".cin__draw-wrap");
        const t = node.querySelector<SVGTextElement>(".cin__draw text");
        if (wrap && t && typeof t.getExtentOfChar === "function") {
          const o = offsetWithin(wrap, replica);
          for (const [a, b] of wordRuns(how.draw)) {
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (let c = a; c < b; c++) {
              const e = t.getExtentOfChar(c);
              x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y);
              x1 = Math.max(x1, e.x + e.width); y1 = Math.max(y1, e.y + e.height);
            }
            if (x1 > x0 && y1 > y0) rects.push(norm(ox + (o.x + x0) * k, oy + (o.y + y0) * k, (x1 - x0) * k, (y1 - y0) * k, sr));
          }
        }
      }
      out.set(live, rects);
    }
  } finally {
    replica.remove();
  }
  return out;
}

/** One HTML line's word boxes at rest: `fill` writes the line's content into its stand-in.
 *  Siblings are cloned as they are (CinematicSlide rebuilds them at rest via atRestRects). */
export function htmlLineRects(el: HTMLElement, fill: (clone: HTMLElement) => void, sr: DOMRect): TextRect[] {
  const host = el.parentElement;
  if (!host) return [];
  const node = restLine(el, (c) => { fill(c); wrapWords(c); });
  return atRestRects(host, (c) => (c === el ? { node, measure: "words" } : null), sr).get(el) ?? [];
}

/** A "draw" line's word boxes from its SVG glyph geometry (one box per word of `text`). */
export function drawLineRects(el: HTMLElement, text: string, sr: DOMRect): TextRect[] {
  const host = el.parentElement;
  const wrap = el.querySelector(".cin__draw-wrap");
  if (!host || !wrap) return [];
  const node = restLine(el, (c) => { c.appendChild(wrap.cloneNode(true)); });
  return atRestRects(host, (c) => (c === el ? { node, measure: { draw: text } } : null), sr).get(el) ?? [];
}

/** One credit line's word boxes with the roll at offset 0 (its block top-left): word offsets are
 *  relative to the absolutely positioned roll, whose own translateY they ignore. */
export function creditLineRects(block: HTMLElement, line: HTMLElement, sr: DOMRect): TextRect[] {
  const br = block.getBoundingClientRect();
  return Array.from(line.querySelectorAll<HTMLElement>(`.${WORD_CLASS}`))
    .map((w) => norm(br.left + block.clientLeft + w.offsetLeft, br.top + block.clientTop + w.offsetTop, w.offsetWidth, w.offsetHeight, sr));
}
