import type { DeckDoc } from "@/engine/deck-doc";
import type { FlatBeat } from "./flatten-beats";

export type CanvasPlaceholder = "load-error" | "empty-deck" | "empty-scene" | null;

/** Which full-canvas card (if any) replaces the stage. Ordered by precedence: a load failure
 *  beats everything, and a not-yet-arrived deck shows nothing rather than flashing a card. */
export function canvasPlaceholder(opts: {
  loadError: boolean;
  doc: DeckDoc | null;
  selectedFlat: FlatBeat | null;
}): CanvasPlaceholder {
  if (opts.loadError) return "load-error";
  if (!opts.doc) return null;
  if (opts.doc.scenes.length === 0) return "empty-deck";
  if (!opts.selectedFlat) return "empty-scene";
  return null;
}

/** True when a beat draws nothing at all. The scene-objects check matters: objects render on
 *  a beat with an empty timeline, so the hint must not cover them. */
export function isBeatEmpty(doc: DeckDoc, flat: FlatBeat): boolean {
  if (flat.beat.art) return false;
  if (flat.beat.timeline.length > 0) return false;
  const scene = doc.scenes.find((s) => s.id === flat.sceneId);
  return !scene?.objects?.length;
}
