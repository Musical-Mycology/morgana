import { REQUIRED_SLOTS, type Deck } from "./types";

/** Returns an array of human-readable error strings; empty array = valid. */
export function validateDeck(deck: Deck): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const slide of deck) {
    if (seen.has(slide.id)) errors.push(`duplicate slide id "${slide.id}"`);
    seen.add(slide.id);

    if (slide.nightlight < 0 || slide.nightlight > 1) {
      errors.push(`slide "${slide.id}": nightlight ${slide.nightlight} out of range [0,1]`);
    }

    const slots = slide.slots as unknown as Record<string, unknown>;
    for (const key of REQUIRED_SLOTS[slide.layout]) {
      const v = slots[key];
      if (v == null || (typeof v === "string" && v.trim() === "")) {
        errors.push(`slide "${slide.id}": missing slot "${key}"`);
      }
    }

    if (slide.layout === "cinematic") {
      const { beat } = slide.slots;
      if (!beat.art && beat.timeline.length === 0) {
        errors.push(`slide "${slide.id}": cinematic beat has no art and no timeline`);
      }
      for (const a of [beat.art, ...beat.timeline.flatMap((t) => (t.kind === "art" ? [t.art] : []))]) {
        if (!a) continue;
        const tos = Array.isArray(a.to) ? a.to : [a.to];
        for (const t of tos) {
          if (typeof t !== "string") errors.push(`slide "${slide.id}": invalid art target`);
        }
      }
      continue; // skip the generic build-key check (cinematic has no slot keys)
    }

    for (const key of slide.build ?? []) {
      if (!(key in slots)) {
        errors.push(`slide "${slide.id}": build key "${key}" is not a slot`);
      }
    }
  }

  return errors;
}
