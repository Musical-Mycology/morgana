import type { Action, TextIn } from "@/engine/deck/types";
import type { ArtStageHandle } from "@/engine/components/ArtStage";

// Mirrors INTRO_DUR + introDuration() in CinematicSlide.tsx so windows match playback timing.
const INTRO_DUR: Record<TextIn, number> = {
  flyUp: 0.6, fade: 0.8, fadeSide: 0.7, cursive: 1.0,
  letterFly: 1.6, letterUp: 1.6, wordUp: 1.3, blurIn: 1.6, typewriter: 1.5,
};
const DOTFADE_TAIL = 2.02;

function introDuration(a: { in: TextIn; value: string; dots?: true; speed?: number }): number {
  const sp = a.speed ?? (a.in === "cursive" ? 0.2 : 1);
  const chars = a.value.length;
  const words = a.value.trim().split(/\s+/).length;
  let base: number;
  switch (a.in) {
    case "cursive":
    case "typewriter": base = 0.1 + chars * 0.045; break;
    case "letterFly":
    case "letterUp":
    case "blurIn": base = 0.5 + chars * 0.03; break;
    case "wordUp": base = 0.6 + words * 0.08; break;
    default: base = INTRO_DUR[a.in];
  }
  return (base + (a.dots ? DOTFADE_TAIL : 0)) / sp;
}

/** Seconds the engine reserves on the master timeline for this action. */
export function actionDuration(a: Action): number {
  switch (a.kind) {
    case "text": return introDuration(a);
    case "wait": return a.ms / 1000;
    case "fade_out": return (a.durationMs ?? 500) / 1000;
    case "counter_show": return 0.4;
    case "counter_to":
    case "counter_add": return (a.durationMs ?? 800) / 1000;
    case "media": return (a.durationMs ?? 600) / 1000;
    case "media_move": return (a.durationMs ?? 800) / 1000;
    case "media_out": return (a.durationMs ?? 500) / 1000;
    default: return 0; // art / notes / nightlight / clear / gates: instantaneous side-effects
  }
}

/** Tween effects can be rendered at arbitrary progress; particle/note sources cannot. */
export function isSeekable(a: Action): boolean {
  return a.kind !== "note_emitter" && a.kind !== "note_circle" && a.kind !== "cue";
}

export interface Window { action: Action; start: number; end: number; }

/** Assign sequential [start,end) seconds to each action. */
export function beatTimeline(timeline: Action[]): Window[] {
  let cursor = 0;
  const out: Window[] = [];
  for (const action of timeline) {
    const dur = actionDuration(action);
    out.push({ action, start: cursor, end: cursor + dur });
    cursor += dur;
  }
  return out;
}

export function beatDuration(timeline: Action[]): number {
  return beatTimeline(timeline).reduce((m, w) => Math.max(m, w.end), 0);
}

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
