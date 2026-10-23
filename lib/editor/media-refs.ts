import type { DeckDoc } from "@/engine/deck-doc";
import type { ArtTransition } from "@/engine/deck/types";
import { isMediaRef, type MediaRef } from "@/engine/deck/media-ref";

export interface MediaRefUse { ref: MediaRef; sceneIdx: number; beatIdx: number; actionIdx?: number; where: "art" | "tile" | "clip-opts" }

/** Every `media:<id>` ref a deck uses: beat art (`to`/`keep`/`out`/`clips` keys), mid-beat art
 *  actions, and media-tile `src`. Panel keys and plain URLs are ignored. Pure. */
export function findMediaRefs(doc: DeckDoc): MediaRefUse[] {
  const out: MediaRefUse[] = [];
  const art = (t: ArtTransition | undefined, sceneIdx: number, beatIdx: number, actionIdx?: number) => {
    if (!t) return;
    const at = actionIdx === undefined ? { sceneIdx, beatIdx } : { sceneIdx, beatIdx, actionIdx };
    const layers = [...(Array.isArray(t.to) ? t.to : [t.to]), ...(t.keep ?? []), ...(t.out ?? [])];
    for (const l of layers) if (isMediaRef(l)) out.push({ ref: l, ...at, where: "art" });
    for (const k of Object.keys(t.clips ?? {})) if (isMediaRef(k)) out.push({ ref: k, ...at, where: "clip-opts" });
  };
  doc.scenes.forEach((s, sceneIdx) => s.beats.forEach((b, beatIdx) => {
    art(b.art, sceneIdx, beatIdx);
    b.timeline.forEach((a, actionIdx) => {
      if (a.kind === "art") art(a.art, sceneIdx, beatIdx, actionIdx);
      else if (a.kind === "media" && isMediaRef(a.src)) out.push({ ref: a.src, sceneIdx, beatIdx, actionIdx, where: "tile" });
    });
  }));
  return out;
}
