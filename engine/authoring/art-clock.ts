/** Art + nightlight as pure functions of deck time (timed-video sub-project 3). Pure: no DOM,
 *  GSAP or React — enforced by tests/unit/pure-import-graph.test.ts. GSAP is only the parity
 *  reference in tests: these curves must match what ArtStage's tweens produce. */
import type { ArtMode } from "@/engine/deck/types";

export const ART_DURATION_MS: Record<ArtMode, number> = { cut: 0, fade: 700, crossfade: 900, morph: 800, dissolve: 1100 };
/** A beat-level nightlight change (and a nightlight action with no durationMs) — today's glow CSS transition. */
export const NIGHT_ENTRY_MS = 200;

export function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
/** GSAP power2.inOut — power2 is CUBIC in GSAP's naming (see docs/MM_MORGANA.md gotcha). */
export function power2InOut(p: number): number { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
/** GSAP back.out(2): overshoots past 1 before settling. */
export function backOut2(p: number): number { const q = p - 1; return 1 + 3 * q * q * q + 2 * q * q; }
