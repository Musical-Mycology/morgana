/** Pure, time-indexed note-particle state. No GSAP, no Math.random(), no wall-clock:
 *  every value here is a function of (scene, beatIndex, tLocal) alone, so scrubbing to
 *  the same time always paints the same frame. See docs/superpowers/specs/
 *  2026-07-27-time-pure-particles-7a-design.md §3. */

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
