import type { Action, ArtAsset, ArtTransition, ClipOpts } from "@/engine/deck/types";
import type { ArtClips, ArtStageHandle } from "@/engine/components/ArtStage";
import { beatTimeline } from "@/engine/authoring/beat-clock";
import { applyArt } from "@/engine/deck/flatten";
import { isMediaRef, type MediaRef } from "@/engine/deck/media-ref";

export interface SeekCtx {
  textHost: HTMLElement; art: ArtStageHandle | null; setNight?: (n: number) => void;
  /** The beat's entry art. Not painted here; it seeds the art stack so that clip options follow
   *  the transition that brought each layer in (see `ClipFold`). */
  entryArt?: ArtTransition;
}

/** Clip options per on-stage media ref, under the same rule as art-clock's `artAt`: a layer's
 *  options come from the transition that brought it in. A layer already in the stack keeps them
 *  when a later transition keeps or re-lists it. A layer the transition adds takes that
 *  transition's `clips[ref]`, or none (in-point 0). */
class ClipFold {
  private stack: ArtAsset[] = [];
  private clips: Partial<Record<MediaRef, ClipOpts>> = {};
  /** Fold one transition; returns a snapshot of the effective options for ArtStage. */
  step(tr: ArtTransition): ArtClips {
    const next = applyArt(this.stack, tr);
    for (const asset of next) {
      if (!isMediaRef(asset) || this.stack.includes(asset)) continue;
      const opts = tr.clips?.[asset];
      if (opts) this.clips[asset] = opts; else delete this.clips[asset];
    }
    this.stack = next;
    return { ...this.clips } as ArtClips;
  }
}

/** Render the beat's visual state at absolute time `t` (seconds). Frame-accurate for tween
 *  effects; particle effects render nothing (non-seekable / suppressed under scrub). */
export function renderBeatAt(timeline: Action[], t: number, ctx: SeekCtx): void {
  ctx.textHost.innerHTML = "";
  ctx.textHost.style.opacity = "";
  const clips = new ClipFold();
  if (ctx.entryArt) clips.step(ctx.entryArt);
  for (const { action, start, end } of beatTimeline(timeline)) {
    if (start > t) break;                       // not reached yet (strictly after t)
    const dur = end - start;
    const p = dur <= 0 ? 1 : Math.min(1, (t - start) / dur); // local progress 0..1
    applyAt(action, p, ctx, action.kind === "art" ? clips.step(action.art) : undefined);
  }
}

function applyAt(a: Action, p: number, ctx: SeekCtx, artClips?: ArtClips): void {
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
      // `artClips`: each layer's options from the transition that introduced it. With no deck
      // clock here the host (the editor canvas, library thumbnails: `clipPlayback={false}`)
      // shows each clip's in-point frame.
      if (p >= 1) ctx.art?.snap(layers, artClips); else ctx.art?.show(layers, "fade", 1, artClips);
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
