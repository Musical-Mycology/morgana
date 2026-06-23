import type { Deck, Scene, ArtTransition, SlideTreatment, SlideTheme } from "./types";
import type { StoryAsset } from "./story-assets";

/** Full night for warm, full day for cover/paper. */
export function treatmentNightlight(t: SlideTreatment): number {
  return t === "warm" ? 1 : 0;
}
/** Light ink on dark ground for warm; dark ink on light ground for cover/paper. */
export function treatmentTheme(t: SlideTreatment): SlideTheme {
  return t === "warm" ? "dark" : "light";
}

export function flattenStory(scenes: Scene[]): Deck {
  const slides: Deck = [];
  let night = 0;
  for (const scene of scenes) {
    const t = scene.treatment;
    for (const beat of scene.beats) {
      if (beat.nightlight != null) night = beat.nightlight;
      slides.push({
        id: `${scene.id}.${beat.id}`,
        layout: "cinematic",
        nightlight: t ? treatmentNightlight(t) : night,
        theme: t ? treatmentTheme(t) : "dark",
        treatment: t,
        slots: { sceneId: scene.id, beat },
      });
    }
  }
  return slides;
}

function asArray(to: StoryAsset | StoryAsset[]): StoryAsset[] {
  return Array.isArray(to) ? to : [to];
}

/**
 * Apply one transition to a layer stack (bottom→top), honoring keep/out.
 * Exported so ArtStage can fold mid-timeline ops onto its live stack.
 * - no keep & no out → full replace with `to`
 * - keep given       → survivors = existing ∩ keep; then append `to`
 * - out given        → survivors = all existing;     then append `to`, remove `out`
 */
export function applyArt(layers: StoryAsset[], art: ArtTransition): StoryAsset[] {
  const added = asArray(art.to);
  if (!art.keep && !art.out) return [...added];
  let survivors = art.keep ? layers.filter((l) => art.keep!.includes(l)) : [...layers];
  survivors = survivors.filter((l) => !added.includes(l));
  let next = [...survivors, ...added];
  if (art.out) next = next.filter((l) => !art.out!.includes(l));
  return next;
}

/** Fold every art op of one beat (entry, then its timeline art actions). */
function foldBeat(layers: StoryAsset[], slide: Deck[number], phase: "entry" | "end"): StoryAsset[] {
  if (slide.layout !== "cinematic") return layers;
  const { beat } = slide.slots;
  let out = beat.art ? applyArt(layers, beat.art) : layers;
  if (phase === "end") for (const a of beat.timeline) if (a.kind === "art") out = applyArt(out, a.art);
  return out;
}

/** Settled visible layers AFTER beat `index` fully plays (entry + its mid art ops). */
export function resolveBeatArt(deck: Deck, index: number): { layers: StoryAsset[] } {
  let layers: StoryAsset[] = [];
  for (let i = 0; i <= index && i < deck.length; i++) {
    layers = foldBeat(layers, deck[i], "end");
  }
  return { layers };
}

/** Visible layers at beat `index` ENTRY (beats 0..index-1 full, beat index's entry op only). */
export function resolveEntryArt(deck: Deck, index: number): { layers: StoryAsset[] } {
  let layers: StoryAsset[] = [];
  for (let i = 0; i < index && i < deck.length; i++) layers = foldBeat(layers, deck[i], "end");
  if (index < deck.length) layers = foldBeat(layers, deck[index], "entry");
  return { layers };
}
