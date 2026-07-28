/** Pure reducer for positioned media tiles (the media / media_move / media_out actions).
 *  No DOM, no GSAP, no React — this is what makes a media tile scrubbable rather than
 *  wall-clock-animated (design spec §7b §6), and is written to be shareable with §7c's
 *  parity gate later. `tests/unit/pure-import-graph.test.ts`-style purity applies here too. */
import type { Action } from "@/engine/deck/types";

export interface MediaRenderState { x: number; y: number; scale: number; opacity: number }
export interface MediaFold { action: Action; p: number }

// GSAP's power names are one ahead of their exponent: power1 = quad (^2), power2 = cubic (^3),
// power3 = quart (^4). engine/components/effects/note-state.ts's powerOut1 being quadratic is
// the in-repo confirmation. Getting this wrong makes a scrubbed frame disagree with playback —
// exactly the drift §7b exists to remove. Match showMedia's/moveMedia's real gsap calls exactly.
const powerOut2 = (p: number): number => 1 - Math.pow(1 - p, 3);        // showMedia fade/fadeSide ("power2.out")
const powerOut3 = (p: number): number => 1 - Math.pow(1 - p, 4);        // showMedia flyUp ("power3.out")
const backOut2 = (p: number): number => { const q = p - 1; return q * q * (3 * q + 2) + 1; }; // showMedia pop ("back.out(2)")
/** GSAP "power3.inOut" (quart in-out) — the ease moveMedia actually uses. Symmetric: exactly
 *  0.5 at p=0.5, unlike an ease-out curve. */
const powerInOut3 = (p: number): number =>
  p < 0.5 ? 8 * Math.pow(p, 4) : 1 - Math.pow(-2 * p + 2, 4) / 2;

/** Entrance ease per `media.in` mode, mirroring showMedia's per-mode gsap.from calls. */
const ENTRANCE: Record<string, (p: number) => number> = {
  flyUp: powerOut3, pop: backOut2, fadeSide: powerOut2, fade: powerOut2,
};

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** Fold reached media actions into each tile's render state. Pure: recomputed from scratch
 *  on every call (not carried as tween state), so backward seek falls out for free.
 *
 *  `media_move` chaining: folds `cur.x`/`cur.y` as the origin, so a second `media_move` on the
 *  same tile starts from wherever the first one ended — matching playback. Do not "optimise"
 *  this to read the original `pos`.
 *
 *  `media_out` with no `id` clears every tile (matches the old `outMedia`'s semantics), not
 *  just one. */
export function mediaStateAt(entries: MediaFold[], _t: number): Map<string, MediaRenderState> {
  const out = new Map<string, MediaRenderState>();
  for (const { action: a, p } of entries) {
    if (a.kind === "media") {
      const ease = ENTRANCE[a.in ?? "fade"] ?? powerOut2;
      out.set(a.id, { x: a.pos.x, y: a.pos.y, scale: 1, opacity: ease(p) });
    } else if (a.kind === "media_move") {
      const cur = out.get(a.id);
      if (!cur) continue;
      const e = powerInOut3(p);
      out.set(a.id, {
        ...cur,
        x: lerp(cur.x, a.to.x, e),
        y: lerp(cur.y, a.to.y, e),
        scale: a.scale != null ? lerp(cur.scale, a.scale, e) : cur.scale,
      });
    } else if (a.kind === "media_out") {
      const ids = a.id ? [a.id] : [...out.keys()];
      for (const id of ids) {
        const cur = out.get(id);
        if (cur) out.set(id, { ...cur, opacity: 1 - p });
      }
    }
  }
  return out;
}
