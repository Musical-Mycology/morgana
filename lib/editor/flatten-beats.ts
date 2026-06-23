import type { DeckDoc } from "@/engine/deck-doc";
import type { Beat } from "@/engine/deck/types";
export interface FlatBeat { sceneId: string; beat: Beat; }
export function flattenBeats(doc: DeckDoc): FlatBeat[] {
  return doc.scenes.flatMap((s) => s.beats.map((beat) => ({ sceneId: s.id, beat })));
}
