/** Pure, time-indexed note-particle state. No GSAP, no Math.random(), no wall-clock:
 *  every value here is a function of (scene, beatIndex, tLocal) alone, so scrubbing to
 *  the same time always paints the same frame. See docs/superpowers/specs/
 *  2026-07-27-time-pure-particles-7a-design.md §3. */

import type { Action, Scene } from "@/engine/deck/types";
import { NOTE_GLYPHS, type NoteGlyph } from "@/engine/deck/story-assets";
import { beatTimeline, beatDuration } from "@/engine/authoring/beat-clock";

/** Reference stage width the engine's px constants were authored against. */
export const REF_W = 1920;
/** launchNote's EMIT_SPEED (130 px/s), as stage-widths per second. */
export const EMIT_SPEED_N = 130 / REF_W;
/** The 42px note sprite, as a fraction of stage width. */
export const NOTE_SIZE_N = 42 / REF_W;
/** The stage is a fixed 16:9 box, so a stage-width distance converts to a
 *  stage-height distance by this factor — which is what preserves travel angles
 *  under separate per-axis normalization. */
export const STAGE_ASPECT = 16 / 9;

export const MAX_SPRITES_PER_SOURCE = 256;
export const MAX_SPRITES_TOTAL = 512;

export const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Deterministic 32-bit mix of two integers → the seed for one sprite's jitter. */
export function hash32(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Small, fast, seedable PRNG. Replaces the two Math.random() calls in launchNote. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** GSAP "back.out(2)": (p−1)²·((s+1)(p−1) + s) + 1 with s = 2. Overshoots above 1. */
export function backOut2(p: number): number {
  const q = p - 1;
  return q * q * (3 * q + 2) + 1;
}

/** GSAP "power1.out" (quad out). */
export const powerOut1 = (p: number): number => 1 - (1 - p) * (1 - p);
/** GSAP "power1.in" (quad in). */
export const powerIn1 = (p: number): number => p * p;

/** The glyph subset the note effects draw from — the melodic notes, not clefs or rests. */
const GLYPHS = NOTE_GLYPHS.filter((g) => g.startsWith("Notes")) as NoteGlyph[];
/** Glyph for the i-th sprite of a source. Despite the name it is deterministic —
 *  a plain index cycle — which is what keeps a scrubbed frame reproducible. */
export function randomGlyph(i: number): NoteGlyph { return GLYPHS[i % GLYPHS.length]; }

/** One live note sprite at an absolute time. x/y are normalized 0–1 stage coordinates.
 *  `key` is a stable pool slot — the renderer reuses the DOM node with the same key. */
export interface NoteSpriteState {
  key: string;
  x: number; y: number;
  scale: number;
  opacity: number;
  hex: string;
  glyph: NoteGlyph;
}

/** `decay` is authored in MILLISECONDS; launchNote clamped it to a 0.1s floor. */
export const emitterDecaySeconds = (decayMs: number): number => Math.max(0.1, decayMs / 1000);

/** Live sprites of one note_emitter, `elapsed` seconds after the source started.
 *  Ports launchNote's three tweens as closed-form functions of each note's age. */
export function emitterSpritesAt(
  a: Extract<Action, { kind: "note_emitter" }>,
  srcIdx: number,
  elapsed: number,
): NoteSpriteState[] {
  const freq = a.freq;
  if (!(freq > 0) || !(a.decay > 0) || elapsed < 0) return [];
  const D = emitterDecaySeconds(a.decay);
  const P = Math.min(Math.ceil(D * freq) + 1, MAX_SPRITES_PER_SOURCE);
  // live iff 0 ≤ elapsed − i/freq < D
  const iMax = Math.floor(elapsed * freq);
  const iMin = Math.max(0, Math.floor((elapsed - D) * freq) + 1, iMax - P + 1); // keep the newest P
  const tIn = Math.min(0.4, D * 0.4);
  const fadeStart = 0.6 * D;
  const fadeSpan = 0.4 * D;

  const out: NoteSpriteState[] = [];
  for (let i = iMin; i <= iMax; i++) {
    const age = elapsed - i / freq;
    const rnd = mulberry32(hash32(srcIdx, i));
    const spread = (rnd() * 2 - 1) * (a.var ?? 0);
    const mult = 0.8 + rnd() * 0.4;
    const theta = ((a.dir + spread) * Math.PI) / 180;   // compass: 0 = up, clockwise
    const dist = EMIT_SPEED_N * D * mult;
    const dx = Math.sin(theta) * dist;
    const dy = -Math.cos(theta) * dist * STAGE_ASPECT;

    const bounce = backOut2(clamp01(age / tIn));
    let opacity = clamp01(bounce);
    if (age >= fadeStart) opacity *= 1 - powerIn1(clamp01((age - fadeStart) / fadeSpan));
    const travel = powerOut1(clamp01(age / D));

    out.push({
      key: `${srcIdx}:${i % P}`,
      x: a.pos.x + dx * travel,
      y: a.pos.y + dy * travel,
      scale: 0.4 + 0.6 * bounce,
      opacity,
      hex: a.color,
      glyph: randomGlyph(i),
    });
  }
  return out;
}

/** Live sprites of one note_circle, `elapsed` seconds after the source started.
 *  Already closed-form in the engine — this is the same ellipse math with the GSAP
 *  angle tween replaced by `2π·elapsed/dur`, in normalized stage space. */
export function circleSpritesAt(
  a: Extract<Action, { kind: "note_circle" }>,
  srcIdx: number,
  elapsed: number,
): NoteSpriteState[] {
  if (elapsed < 0) return [];
  const N = Math.max(1, Math.round(a.notes ?? 8));
  const count = Math.min(N, MAX_SPRITES_PER_SOURCE);
  const dur = Math.max(0.1, (a.speed ?? 6000) / 1000);   // speed is ms per orbit
  const colors = a.hex.length ? a.hex : ["#FFFFFF"];
  const rx = a.width / 2;
  const ry = a.height / 2;
  const bounce = a.bounce ?? 0;

  const out: NoteSpriteState[] = [];
  for (let k = 0; k < count; k++) {
    const ang = (k / N) * Math.PI * 2 + (elapsed / dur) * Math.PI * 2;
    const hop = bounce * ry * 0.5 * Math.abs(Math.sin(ang * 3));   // |sin| → always upward
    out.push({
      key: `${srcIdx}:${k}`,
      x: a.pos.x + Math.cos(ang) * rx,
      y: a.pos.y + Math.sin(ang) * ry - hop,
      scale: 1,
      opacity: 1,
      hex: colors[k % colors.length],
      glyph: randomGlyph(k),
    });
  }
  return out;
}

type NoteSource =
  | { kind: "emitter"; action: Extract<Action, { kind: "note_emitter" }>; srcIdx: number; startBeat: number; windowStart: number }
  | { kind: "ring"; action: Extract<Action, { kind: "note_circle" }>; srcIdx: number; startBeat: number; windowStart: number };

/** Walk one beat's timeline up to `limit` seconds, mutating the live source list.
 *  `limit = Infinity` replays the whole beat (used when folding prior beats). */
function foldBeat(
  sources: NoteSource[], timeline: Action[], beatIdx: number, limit: number, nextIdx: () => number,
): NoteSource[] {
  let live = sources;
  for (const { action, start } of beatTimeline(timeline)) {
    if (start > limit) break;
    if (action.kind === "note_emitter") {
      live.push({ kind: "emitter", action, srcIdx: nextIdx(), startBeat: beatIdx, windowStart: start });
    } else if (action.kind === "note_circle") {
      live.push({ kind: "ring", action, srcIdx: nextIdx(), startBeat: beatIdx, windowStart: start });
    } else if (action.kind === "stop_notes") {
      live.length = 0;
    } else if (action.kind === "stop_circle") {
      live = live.filter((s) => s.kind !== "ring");
    }
  }
  return live;
}

/** Every live note sprite at (beatIndex, tLocal seconds into that beat).
 *
 *  Prior beats are folded to their settled state to derive which sources survive
 *  (stop_notes / stop_circle remove them), then each carried source's phase is
 *  continued across the intervening beat durations. Mirrors objectStateAt's fold,
 *  so there is one cross-beat model in the codebase. */
export function noteFieldStateAt(scene: Scene, beatIndex: number, tLocal: number): NoteSpriteState[] {
  const beats = scene?.beats;
  if (!beats?.length) return [];                                   // zero-beat scenes are legal
  if (beatIndex < 0 || beatIndex >= beats.length) return [];

  let counter = 0;
  const nextIdx = () => counter++;
  let sources: NoteSource[] = [];
  for (let bi = 0; bi < beatIndex; bi++) {
    sources = foldBeat(sources, beats[bi].timeline, bi, Infinity, nextIdx);
  }
  sources = foldBeat(sources, beats[beatIndex].timeline, beatIndex, tLocal, nextIdx);

  const elapsedOf = (s: NoteSource): number => {
    if (s.startBeat === beatIndex) return tLocal - s.windowStart;
    let e = beatDuration(beats[s.startBeat].timeline) - s.windowStart;
    for (let j = s.startBeat + 1; j < beatIndex; j++) e += beatDuration(beats[j].timeline);
    return e + tLocal;
  };

  const out: NoteSpriteState[] = [];
  for (const s of sources) {
    const sprites = s.kind === "emitter"
      ? emitterSpritesAt(s.action, s.srcIdx, elapsedOf(s))
      : circleSpritesAt(s.action, s.srcIdx, elapsedOf(s));
    // Total cap drops whole trailing sources, so one runaway emitter cannot blank a
    // scene's rings mid-source.
    if (out.length + sprites.length > MAX_SPRITES_TOTAL) break;
    out.push(...sprites);
  }
  return out;
}
