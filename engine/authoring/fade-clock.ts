/** Screen fade as a pure function of deck time (timed-video sub-project 6). Pure: no DOM, GSAP or
 *  React — enforced by tests/unit/pure-import-graph.test.ts. The nightlight model (art-clock's
 *  nightEvents/nightAt): each fade is linear from the level in effect when it starts, and the level
 *  holds across beats and scenes until the next fade. */
import type { DeckDoc } from "@/engine/deck-doc";
import { deckLayout } from "./deck-clock";
import { beatTimeline } from "./beat-clock";
import { clamp01 } from "./art-clock";
import { isHexColor } from "@/engine/deck/story-assets";

export const FADE_DEFAULT_MS = 1000;
export const FADE_DEFAULT_COLOR = "#000";
/** `at` is the position of the source screen_fade action (the fade-unfinished lint reuses it). */
export interface FadeEvent {
  start: number; duration: number; to: number; color: string; // seconds
  at: { sceneIdx: number; beatIdx: number; actionIdx: number };
}
export interface FadeState { level: number; color: string }

/** Every reached screen_fade in deck order (same reach rule as nightEvents: nothing past a pinned
 *  scene's cut). */
export function fadeEvents(doc: DeckDoc): FadeEvent[] {
  const out: FadeEvent[] = [];
  for (const s of deckLayout(doc).scenes) {
    const scene = doc.scenes[s.sceneIdx];
    const reached = (localStart: number) => !s.pinned || localStart < s.length;
    for (const b of s.beats) {
      if (!reached(b.start)) continue;
      beatTimeline(scene.beats[b.beatIdx].timeline).forEach((w, actionIdx) => {
        if (w.action.kind !== "screen_fade" || !reached(b.start + w.start)) return;
        const a = w.action;
        out.push({
          start: s.start + b.start + w.start,
          duration: (a.durationMs ?? FADE_DEFAULT_MS) / 1000,
          to: clamp01(a.to),
          // An invalid colour never reaches the DOM (the browser would ignore it and keep the
          // previous background, so a stepped frame would differ from a jumped one).
          color: isHexColor(a.color) ? a.color : FADE_DEFAULT_COLOR,
          at: { sceneIdx: s.sceneIdx, beatIdx: b.beatIdx, actionIdx },
        });
      });
    }
  }
  return out;
}

/** The fade at deck time T. The colour is the latest started fade's (it switches at its start). */
export function fadeAt(events: FadeEvent[], T: number): FadeState {
  let level = 0;
  let color = FADE_DEFAULT_COLOR;
  for (let i = 0; i < events.length && events[i].start <= T; i++) {
    const e = events[i];
    const until = i + 1 < events.length && events[i + 1].start <= T ? events[i + 1].start : T;
    const p = e.duration <= 0 ? 1 : clamp01((until - e.start) / e.duration);
    level = level + (e.to - level) * p;
    color = e.color;
  }
  return { level, color };
}
