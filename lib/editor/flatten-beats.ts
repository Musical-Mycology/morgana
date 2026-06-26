import type { DeckDoc } from "@/engine/deck-doc";
import type { Beat } from "@/engine/deck/types";

export interface FlatBeat { sceneId: string; beat: Beat; }

export function flattenBeats(doc: DeckDoc): FlatBeat[] {
  return doc.scenes.flatMap((s) => s.beats.map((beat) => ({ sceneId: s.id, beat })));
}

/** Map a flat beat index (filmstrip order) back to its scene + in-scene position. */
export function beatLocation(doc: DeckDoc, flatIdx: number): { sceneIdx: number; beatIdx: number } | null {
  let n = 0;
  for (let si = 0; si < doc.scenes.length; si++) {
    for (let bi = 0; bi < doc.scenes[si].beats.length; bi++) {
      if (n === flatIdx) return { sceneIdx: si, beatIdx: bi };
      n++;
    }
  }
  return null;
}
