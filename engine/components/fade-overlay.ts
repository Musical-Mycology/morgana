/** Paint the screen-fade overlay (sub-project 6) — shared by DeckStage (/play, /render) and the
 *  editor canvas. Writes only when the painted value changes; at level 0 the overlay is
 *  display:none with no level or colour, so it paints nothing. `cap` limits the level (the editor previews ≤ 0.5). Returns
 *  the key it painted, which the caller passes back as `last`. */
import type { FadeState } from "@/engine/authoring/fade-clock";

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function paintFadeOverlay(el: HTMLElement, f: FadeState, last: string, cap = 1): string {
  const level = r6(Math.min(f.level, cap));
  const key = level <= 0 ? "off" : `${level} ${f.color}`;
  if (key === last) return last;
  // Off clears the level and colour too: the hidden overlay's DOM is then the same whatever was
  // painted before (a fresh mount's), so a stepped and a jumped /render frame compare equal.
  if (key === "off") { el.style.display = "none"; el.style.opacity = ""; el.style.background = ""; return key; }
  el.style.display = "block";
  el.style.opacity = String(level);
  // Clear first: the browser ignores an invalid colour and would keep the previous one, so the
  // painted background would depend on the path taken to this frame.
  el.style.background = "";
  el.style.background = f.color;
  return key;
}
