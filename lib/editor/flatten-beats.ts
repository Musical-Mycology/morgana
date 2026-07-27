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

export interface SceneGroup {
  sceneIdx: number;
  sceneId: string;
  items: { flatIdx: number; beatId: string }[];
}

/** Group beats by scene in document order. Unlike deriving groups from the flat beat list,
 *  this iterates `doc.scenes`, so a scene with no beats yields an empty `items` array
 *  instead of vanishing from the filmstrip entirely. */
export function sceneGroups(doc: DeckDoc): SceneGroup[] {
  let flatIdx = 0;
  return doc.scenes.map((s, sceneIdx) => ({
    sceneIdx,
    sceneId: s.id,
    items: s.beats.map((b) => ({ flatIdx: flatIdx++, beatId: b.id })),
  }));
}

/** Flat (filmstrip-order) index of the beat with `beatId`, or -1 if it no longer exists.
 *  Used to keep the same beat selected across structural edits that shift indices. */
export function flatIndexOfBeat(doc: DeckDoc, beatId: string): number {
  let n = 0;
  for (const s of doc.scenes) {
    for (const b of s.beats) { if (b.id === beatId) return n; n++; }
  }
  return -1;
}

/** Flat index of `scenes[sceneIdx].beats[beatIdx]`, or -1 if out of range. */
export function flatIndexOf(doc: DeckDoc, sceneIdx: number, beatIdx: number): number {
  if (sceneIdx < 0 || sceneIdx >= doc.scenes.length) return -1;
  if (beatIdx < 0 || beatIdx >= doc.scenes[sceneIdx].beats.length) return -1;
  let n = 0;
  for (let si = 0; si < sceneIdx; si++) n += doc.scenes[si].beats.length;
  return n + beatIdx;
}
