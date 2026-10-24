/** DOM for one credits roll (sub-project 6), shared by CinematicSlide (/play, /render) and seek.ts
 *  (the editor canvas). Inline styles only: the editor canvas never mounts CinematicSlide's <style>.
 *  Sizes are fractions of the 16:9 stage height (engine/deck/credits.ts), so lint's estimate holds. */
import type { Action } from "@/engine/deck/types";
import {
  CREDITS_GAP, CREDITS_NAME_FS, CREDITS_NAME_LH, CREDITS_ROLE_FS, CREDITS_ROLE_LH, DEFAULT_CREDITS_AREA,
} from "@/engine/deck/credits";
import { wrapWords } from "./text-sources";

export interface CreditsBlock { block: HTMLElement; roll: HTMLElement; lines: HTMLElement[] }

/** The 16:9 stage height in the nearest size container (BeatStage's root; the editor canvas host). */
const SH = "min(100cqh, calc(100cqw * 9 / 16))";
const MASK = "linear-gradient(transparent, #000 8%, #000 92%, transparent)";
const pct = (n: number) => `${n * 100}%`;

function line(cls: "cin__credits-role" | "cin__credits-name", text: string, lines: HTMLElement[]): HTMLElement {
  const el = document.createElement("div");
  el.className = cls;
  const role = cls === "cin__credits-role";
  el.style.fontSize = `calc(${SH} * ${role ? CREDITS_ROLE_FS : CREDITS_NAME_FS})`;
  el.style.lineHeight = `calc(${SH} * ${role ? CREDITS_ROLE_LH : CREDITS_NAME_LH})`;
  el.style.fontFamily = "var(--font-body)"; // spec §3: a small uppercase role line, names in the body style
  if (role) { el.style.textTransform = "uppercase"; el.style.letterSpacing = "0.12em"; el.style.opacity = "0.8"; }
  el.textContent = text;
  wrapWords(el);
  lines.push(el);
  return el;
}

/** div.cin__credits (the area: clipped, edge-masked) > div.cin__credits-roll (takes the translateY)
 *  > div.cin__credits-item > div.cin__credits-role | div.cin__credits-name (> span.cin__mw words). */
export function buildCreditsBlock(a: Extract<Action, { kind: "credits" }>): CreditsBlock {
  const area = a.area ?? DEFAULT_CREDITS_AREA;
  const block = document.createElement("div");
  block.className = "cin__credits";
  Object.assign(block.style, {
    position: "absolute", left: pct(area.x), top: pct(area.y), width: pct(area.w), height: pct(area.h),
    overflow: "hidden", textAlign: "center", pointerEvents: "none",
    color: "var(--color-mm-cream)", textShadow: "0 2px 14px rgba(0,0,0,0.6)",
  });
  block.style.setProperty("mask-image", MASK);
  block.style.setProperty("-webkit-mask-image", MASK);
  const roll = document.createElement("div");
  roll.className = "cin__credits-roll";
  Object.assign(roll.style, { position: "absolute", left: "0", top: "0", width: "100%" });
  const lines: HTMLElement[] = [];
  a.items.forEach((it, k) => {
    const item = document.createElement("div");
    item.className = "cin__credits-item";
    if (k > 0) item.style.marginTop = `calc(${SH} * ${CREDITS_GAP})`;
    if (it.role) item.appendChild(line("cin__credits-role", it.role, lines));
    for (const n of it.names) item.appendChild(line("cin__credits-name", n, lines));
    roll.appendChild(item);
  });
  block.appendChild(roll);
  return { block, roll, lines };
}
