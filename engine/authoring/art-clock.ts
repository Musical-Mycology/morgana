/** Art + nightlight as pure functions of deck time (timed-video sub-project 3). Pure: no DOM,
 *  GSAP or React — enforced by tests/unit/pure-import-graph.test.ts. GSAP is only the parity
 *  reference in tests: these curves must match what ArtStage's tweens produce. */
import type { ArtMode, ArtTransition } from "@/engine/deck/types";
import type { DeckDoc } from "@/engine/deck-doc";
import type { StoryAsset } from "@/engine/deck/story-assets";
import { isOverlay } from "@/engine/deck/story-assets";
import { applyArt } from "@/engine/deck/flatten";
import { deckLayout } from "./deck-clock";
import { beatTimeline } from "./beat-clock";

export const ART_DURATION_MS: Record<ArtMode, number> = { cut: 0, fade: 700, crossfade: 900, morph: 800, dissolve: 1100 };
/** A beat-level nightlight change (and a nightlight action with no durationMs) — today's glow CSS transition. */
export const NIGHT_ENTRY_MS = 200;

export function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
/** GSAP power2.inOut — power2 is CUBIC in GSAP's naming (see docs/MM_MORGANA.md gotcha). */
export function power2InOut(p: number): number { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
/** GSAP back.out(2): overshoots past 1 before settling. */
export function backOut2(p: number): number { const q = p - 1; return 1 + 3 * q * q * q + 2 * q * q; }

export interface ArtEvent { start: number; duration: number; mode: ArtMode; to: StoryAsset[] }  // seconds
/** `z` is authoritative for stacking; array order only breaks ties. Incoming/kept layers take z from
 *  the target stack order; outgoing layers keep the z they had (GSAP parity). */
export interface ArtLayerState { asset: StoryAsset; opacity: number; scale: number; z: number; overlay: boolean }

const seconds = (art: ArtTransition) => (art.durationMs ?? ART_DURATION_MS[art.mode]) / 1000;

/** Every art change in deck order, at the deck time it starts. A pinned scene's content past its
 *  cut boundary is never reached, so neither is its art. `to` is folded against the true prior
 *  stack, so keep/out behave exactly as in sequential playback. */
export function artEvents(doc: DeckDoc): ArtEvent[] {
  const out: ArtEvent[] = [];
  let stack: StoryAsset[] = [];
  const push = (start: number, art: ArtTransition, entry = false) => {
    const next = applyArt(stack, art);
    // An entry art that folds to the identical stack is a no-op in ArtStage.show() (sameStack), so a
    // still-running fade continues. Mid-beat art actions always emit.
    if (entry && next.length === stack.length && next.every((a, i) => a === stack[i])) return;
    stack = next;
    out.push({ start, duration: art.mode === "cut" ? 0 : seconds(art), mode: art.mode, to: [...stack] });
  };
  for (const s of deckLayout(doc).scenes) {
    const scene = doc.scenes[s.sceneIdx];
    const reached = (localStart: number) => !s.pinned || localStart < s.length;
    for (const b of s.beats) {
      if (!reached(b.start)) continue;
      const beat = scene.beats[b.beatIdx];
      const beatStart = s.start + b.start;
      if (beat.art) push(beatStart, beat.art, true);
      for (const w of beatTimeline(beat.timeline)) {
        if (w.action.kind === "art" && reached(b.start + w.start)) push(beatStart + w.start, w.action.art);
      }
    }
  }
  return out;
}

/** The art layer stack at deck time T, with crossfade opacities. Paint by `z` (array order only
 *  breaks ties — outgoing layers are listed first but keep their old z). Each event is evaluated up to the
 *  next event's start (or T): kept layers sit at 1 (as ArtStage's reuse snaps them), incoming
 *  layers ease in, outgoing layers ease out from their opacity when the event began. */
export function artAt(events: ArtEvent[], T: number): ArtLayerState[] {
  let visible: ArtLayerState[] = [];
  for (let i = 0; i < events.length && events[i].start <= T; i++) {
    const e = events[i];
    const until = i + 1 < events.length && events[i + 1].start <= T ? events[i + 1].start : T;
    const p = e.duration <= 0 ? 1 : clamp01((until - e.start) / e.duration);
    const prev = new Map(visible.map((l) => [l.asset, l]));
    const incoming: ArtLayerState[] = e.to.map((asset, idx) => {
      const overlay = isOverlay(asset);
      const base = { asset, z: idx + 1, overlay };
      if (prev.has(asset) || p >= 1) return { ...base, opacity: 1, scale: 1 };
      if (overlay) { const q = backOut2(p); return { ...base, opacity: clamp01(q), scale: 0.9 + 0.1 * q }; }
      const q = power2InOut(p);
      return { ...base, opacity: q, scale: e.mode === "morph" ? 1.04 + (1 - 1.04) * q : 1 };
    });
    const outgoing = p >= 1 ? [] : visible
      .filter((l) => !e.to.includes(l.asset))
      .map((l) => ({ ...l, opacity: l.opacity * (1 - power2InOut(p)) }));
    visible = [...outgoing, ...incoming];
  }
  return visible;
}
