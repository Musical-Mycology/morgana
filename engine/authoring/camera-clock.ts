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
        out.push({ start: s.start + b.start + w.start, duration: (a.durationMs ?? CAMERA_DEFAULT_MS) / 1000, to: { ...a.to }, ease: a.ease ?? "inOut" });
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
