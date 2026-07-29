/** The canonical beat time axis. Pure: no DOM, no GSAP, no React — the pure reducers
 *  (note-state.ts, object-state.ts) import this, and a test in
 *  tests/unit/pure-import-graph.test.ts enforces that it stays that way.
 *
 *  This is the single source of truth for when anything happens in a beat
 *  (design spec §7b D2). Never derive a duration by reading a built GSAP timeline. */
import type { Action, TextIn } from "@/engine/deck/types";

// Mirrors INTRO_DUR + introDuration() in CinematicSlide.tsx so windows match playback timing.
const INTRO_DUR: Record<TextIn, number> = {
  flyUp: 0.6, fade: 0.8, fadeSide: 0.7, cursive: 1.0,
  letterFly: 1.6, letterUp: 1.6, wordUp: 1.3, blurIn: 1.6, typewriter: 1.5,
};
const DOTFADE_TAIL = 2.02;

export function introDuration(a: { in: TextIn; value: string; dots?: true; speed?: number }): number {
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
    case "obj_reveal": return (a.durationMs ?? 600) / 1000;
    case "obj_move": return (a.durationMs ?? 800) / 1000;
    case "obj_out": return (a.durationMs ?? 500) / 1000;
    default: return 0; // art / notes / nightlight / clear / gates: instantaneous side-effects
  }
}

/** Every effect can be rendered at arbitrary progress. `cue` is the sole exception: it is
 *  inert in Morgana (no runtime implements it) and renders nothing. Note sources became
 *  seekable in §7a via the pure noteFieldStateAt reducer. */
export function isSeekable(a: Action): boolean {
  return a.kind !== "cue";
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

export type FoldPhase = "settled" | "in-flight";

/** One reached action's state at time t. `p` is local progress 0–1. */
export interface FoldEntry {
  index: number;
  action: Action;
  start: number;
  phase: FoldPhase;
  p: number;
}

/** Every action reached by time `t`, with its local progress. At most one entry is
 *  "in-flight", because beatTimeline lays actions out sequentially. */
export function foldAt(timeline: Action[], t: number): FoldEntry[] {
  const out: FoldEntry[] = [];
  const windows = beatTimeline(timeline);
  for (let index = 0; index < windows.length; index++) {
    const { action, start, end } = windows[index];
    if (start > t) break;                       // not reached yet (strictly after t)
    const dur = end - start;
    const p = dur <= 0 ? 1 : Math.min(1, (t - start) / dur);
    out.push({ index, action, start, phase: p >= 1 ? "settled" : "in-flight", p });
  }
  return out;
}

/** Actions that DELETE nodes. Seeking backwards past one cannot be undone by
 *  rewinding a tween, so it forces a rebuild (design spec §7b §4.3). */
const DESTRUCTIVE = new Set<Action["kind"]>(["clear", "fade_out"]);

/** Index of the last destructive action at or before `t`; -1 if there is none.
 *  A rebuild may start here rather than at 0 — a clear wipes all prior text state
 *  by definition, so nothing before it is observable. */
export function rebuildBoundary(timeline: Action[], t: number): number {
  let idx = -1;
  const windows = beatTimeline(timeline);
  for (let index = 0; index < windows.length; index++) {
    const { action, start } = windows[index];
    if (start > t) break;
    if (DESTRUCTIVE.has(action.kind)) idx = index;
  }
  return idx;
}
