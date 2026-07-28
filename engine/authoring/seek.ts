import type { Action } from "@/engine/deck/types";
import type { ArtStageHandle } from "@/engine/components/ArtStage";
import { beatTimeline } from "@/engine/authoring/beat-clock";

export interface SeekCtx { textHost: HTMLElement; art: ArtStageHandle | null; setNight?: (n: number) => void; }

/** Render the beat's visual state at absolute time `t` (seconds). Frame-accurate for tween
 *  effects; particle effects render nothing (non-seekable / suppressed under scrub). */
export function renderBeatAt(timeline: Action[], t: number, ctx: SeekCtx): void {
  ctx.textHost.innerHTML = "";
  ctx.textHost.style.opacity = "";
  for (const { action, start, end } of beatTimeline(timeline)) {
    if (start > t) break;                       // not reached yet (strictly after t)
    const dur = end - start;
    const p = dur <= 0 ? 1 : Math.min(1, (t - start) / dur); // local progress 0..1
    applyAt(action, p, ctx);
  }
}

function applyAt(a: Action, p: number, ctx: SeekCtx): void {
  switch (a.kind) {
    case "text": {
      const el = document.createElement("p");
      el.className = "cin__line cin__line--" + (a.size ?? "lg");
      el.textContent = a.value;
      el.style.opacity = String(p);
      el.style.transform = a.in === "flyUp" ? `translateY(${(1 - p) * 40}px)` : a.in === "fadeSide" ? `translateX(${(1 - p) * 24}px)` : "";
      if (a.align) el.style.textAlign = a.align;
      if (a.pos) { el.style.position = "absolute"; el.style.left = `${a.pos.x * 100}%`; el.style.top = `${a.pos.y * 100}%`; }
      ctx.textHost.appendChild(el);
      break;
    }
    case "art": {
      const layers = Array.isArray(a.art.to) ? a.art.to : [a.art.to];
      if (p >= 1) ctx.art?.snap(layers); else ctx.art?.show(layers, "fade", 1);
      break;
    }
    case "clear":
      ctx.textHost.innerHTML = "";
      ctx.textHost.style.opacity = "";
      break;
    case "fade_out":
      if (p >= 1) { ctx.textHost.innerHTML = ""; ctx.textHost.style.opacity = ""; }
      else ctx.textHost.style.opacity = String(1 - p);
      break;
    case "nightlight":
      ctx.setNight?.(a.to);
      break;
    default:
      break;  // wait/click_gate: no visual. note_*/cue/counter_*/media*: non-seekable, not rendered under scrub.
  }
}
