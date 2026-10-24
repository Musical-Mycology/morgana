/** Camera framing as a pure function of deck time (timed-video sub-project 5). Pure: no DOM,
 *  GSAP or React — enforced by tests/unit/pure-import-graph.test.ts. */
import type { CameraEase, Framing } from "@/engine/deck/types";
import type { DeckDoc } from "@/engine/deck-doc";
import { deckLayout } from "./deck-clock";
import { beatTimeline } from "./beat-clock";
import { clamp01, power2InOut } from "./art-clock";

export const FULL_FRAME: Framing = { x: 0.5, y: 0.5, zoom: 1 };
export const CAMERA_DEFAULT_MS = 1200;
const MIN_ZOOM = 1, MAX_ZOOM = 8;
export interface CameraEvent { start: number; duration: number; to: Partial<Framing>; ease: CameraEase }

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export function clampFraming(f: Framing): Framing {
  const zoom = clamp(f.zoom, MIN_ZOOM, MAX_ZOOM);
  const m = 0.5 / zoom;
  return { zoom, x: clamp(f.x, m, 1 - m), y: clamp(f.y, m, 1 - m) };
}

export function cameraEase(e: CameraEase, p: number): number {
  switch (e) {
    case "in": return p * p * p;
    case "out": return 1 - Math.pow(1 - p, 3);
    case "linear": return p;
    default: return power2InOut(p);
  }
}

/** Whether a camera action starting at `start` folds into the event before it (cameraEvents): only
 *  when they share a start and that event is a move (duration > 0), not a cut. Shared with lint. */
export function mergesInto(prev: Pick<CameraEvent, "start" | "duration"> | undefined, start: number): boolean {
  return !!prev && prev.start === start && prev.duration > 0;
}

export function cameraEvents(doc: DeckDoc): CameraEvent[] {
  const out: CameraEvent[] = [];
  for (const s of deckLayout(doc).scenes) {
    const scene = doc.scenes[s.sceneIdx];
    const reached = (localStart: number) => !s.pinned || localStart < s.length;
    for (const b of s.beats) {
      if (!reached(b.start)) continue;
      for (const w of beatTimeline(scene.beats[b.beatIdx].timeline)) {
        if (w.action.kind !== "camera" || !reached(b.start + w.start)) continue;
        const a = w.action;
        const ev: CameraEvent = { start: s.start + b.start + w.start, duration: (a.durationMs ?? CAMERA_DEFAULT_MS) / 1000, to: { ...a.to }, ease: a.ease ?? "inOut" };
        // Camera actions take no timeline time, so back-to-back ones share a start: fold them into one
        // move (later fields, duration and ease win) instead of letting the later one supersede at p = 0.
        // A 0 ms cut is never folded into: a cut then a same-instant move is the cut, then the move from it.
        const prev = out[out.length - 1];
        if (mergesInto(prev, ev.start)) { prev!.to = { ...prev!.to, ...ev.to }; prev!.duration = ev.duration; prev!.ease = ev.ease; }
        else out.push(ev);
      }
    }
  }
  return out;
}

export function cameraAt(events: CameraEvent[], T: number): Framing {
  let f = FULL_FRAME;
  for (let i = 0; i < events.length && events[i].start <= T; i++) {
    const e = events[i];
    const until = i + 1 < events.length && events[i + 1].start <= T ? events[i + 1].start : T;
    const p = e.duration <= 0 ? 1 : cameraEase(e.ease, clamp01((until - e.start) / e.duration));
    const to = clampFraming({ ...f, ...e.to });
    f = clampFraming({
      zoom: Math.exp(Math.log(f.zoom) + (Math.log(to.zoom) - Math.log(f.zoom)) * p),
      x: f.x + (to.x - f.x) * p,
      y: f.y + (to.y - f.y) * p,
    });
  }
  return f;
}

const r6 = (n: number) => { const v = Math.round(n * 1e6) / 1e6; return v === 0 ? 0 : v; };
export function cameraTransform(f: Framing): string {
  if (f.zoom === 1 && f.x === 0.5 && f.y === 0.5) return "none";
  return `translate(${r6((0.5 - f.x * f.zoom) * 100)}%, ${r6((0.5 - f.y * f.zoom) * 100)}%) scale(${r6(f.zoom)})`;
}

/** Whether any beat emits note particles: a `note_emitter` / `note_circle`, or a `text` / `credits`
 *  action with `particles` (sub-project 6). Note sprites animate their own scale, so — like a camera
 *  deck — such a deck needs a full raster per frame in /render to be the same stepped or jumped
 *  (RenderStage's full-raster gate). The reach rule is ignored on purpose: the gate only has to be safe. */
export function hasNoteSources(doc: DeckDoc): boolean {
  return doc.scenes.some((s) => s.beats.some((b) => b.timeline.some((a) =>
    a.kind === "note_emitter" || a.kind === "note_circle" || ((a.kind === "text" || a.kind === "credits") && !!a.particles))));
}
