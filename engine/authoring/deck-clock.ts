/** The deck-wide time axis (timed decks). Pure: no DOM, no GSAP, no React — enforced by
 *  tests/unit/pure-import-graph.test.ts. Built on beat-clock.ts, the single source of truth
 *  for beat durations; nothing here reads a built GSAP timeline.
 *
 *  Scenes are laid end to end. A scene's length is its pinned `durationSec` if set, else its
 *  content length. Pinned scenes HOLD their last frame when content ends early and CUT content
 *  that runs past the boundary — so later scenes (and their music cue points) never move. */
import type { DeckDoc } from "@/engine/deck-doc";
import { beatDuration } from "./beat-clock";

export interface BeatSpan { beatIdx: number; flatIdx: number; start: number; duration: number }
export interface SceneSpan { sceneIdx: number; start: number; length: number; contentLength: number; pinned: boolean; beats: BeatSpan[] }
export interface DeckLayout { scenes: SceneSpan[]; total: number }
export type LocatePhase = "play" | "hold" | "empty";
export interface Located { sceneIdx: number; beatIdx: number | null; flatIdx: number | null; localT: number; phase: LocatePhase }

export function deckLayout(doc: DeckDoc): DeckLayout {
  const scenes: SceneSpan[] = [];
  let cursor = 0;
  let flatIdx = 0;
  doc.scenes.forEach((scene, sceneIdx) => {
    let local = 0;
    const beats = scene.beats.map((beat, beatIdx): BeatSpan => {
      const duration = beatDuration(beat.timeline);
      const span = { beatIdx, flatIdx: flatIdx++, start: local, duration };
      local += duration;
      return span;
    });
    const pinned = typeof scene.durationSec === "number";
    const length = pinned ? scene.durationSec! : local;
    scenes.push({ sceneIdx, start: cursor, length, contentLength: local, pinned, beats });
    cursor += length;
  });
  return { scenes, total: cursor };
}

/** Seconds of content past the pinned boundary (cut off in playback); 0 when unpinned or within. */
export function sceneOverrun(span: SceneSpan): number {
  return span.pinned ? Math.max(0, span.contentLength - span.length) : 0;
}

/** Where deck time `T` lands. `null` iff there is nothing to play (total === 0). */
export function locate(layout: DeckLayout, T: number): Located | null {
  if (layout.total <= 0) return null;
  const t = Math.max(0, Math.min(layout.total, T));
  let scene: SceneSpan | undefined;
  for (const s of layout.scenes) {
    if (s.length <= 0) continue;          // zero-length scenes occupy no time
    if (s.start <= t) scene = s; else break; // half-open: a boundary belongs to the next scene
  }
  const s = scene!;
  const local = Math.min(t - s.start, s.length);
  if (s.beats.length === 0) return { sceneIdx: s.sceneIdx, beatIdx: null, flatIdx: null, localT: 0, phase: "empty" };

  // Only beats that take time and start before the (possibly cut) boundary can be on screen.
  const reachable = s.beats.filter((b) => b.duration > 0 && b.start < s.length);
  if (reachable.length === 0) {
    const last = s.beats[s.beats.length - 1];
    return { sceneIdx: s.sceneIdx, beatIdx: last.beatIdx, flatIdx: last.flatIdx, localT: 0, phase: "hold" };
  }
  let beat = reachable[0];
  for (const b of reachable) { if (b.start <= local) beat = b; else break; }
  const into = local - beat.start;
  const isLast = beat === reachable[reachable.length - 1];
  const phase: LocatePhase = isLast && into >= beat.duration && local < s.length ? "hold" : "play";
  return { sceneIdx: s.sceneIdx, beatIdx: beat.beatIdx, flatIdx: beat.flatIdx, localT: Math.min(into, beat.duration), phase };
}

/** Deck time of (`flatIdx`, beat-local `localT`) — the inverse of `locate`, for the editor
 *  playhead. Clamped to the scene's (possibly cut) end; 0 for an unknown index. */
export function deckTimeOf(layout: DeckLayout, flatIdx: number, localT: number): number {
  for (const s of layout.scenes) {
    const b = s.beats.find((x) => x.flatIdx === flatIdx);
    if (b) return s.start + Math.min(b.start + Math.max(0, Math.min(localT, b.duration)), s.length);
  }
  return 0;
}
