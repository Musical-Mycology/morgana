/** Paint the screen-fade overlay (sub-project 6) — shared by DeckStage (/play, /render) and the
 *  editor canvas. Writes only when the painted value changes; at level 0 the overlay is
 *  display:none, so it paints nothing. `cap` limits the level (the editor previews ≤ 0.5). Returns
 *  the key it painted, which the caller passes back as `last`. */
import type { FadeState } from "@/engine/authoring/fade-clock";

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function paintFadeOverlay(el: HTMLElement, f: FadeState, last: string, cap = 1): string {
  const level = r6(Math.min(f.level, cap));
  const key = level <= 0 ? "off" : `${level} ${f.color}`;
  if (key === last) return last;
  if (key === "off") { el.style.display = "none"; return key; }
  el.style.display = "block";
  el.style.opacity = String(level);
  el.style.background = f.color;
  return key;
}
