import type { Scene, SlideTreatment } from "@/engine/deck/types";

/** Optional host-app chrome, defaulted to none so decks render generic. */
export interface DeckChrome {
  /** Splash on the scene whose id is "intro". */
  splash?: { logo?: string; tagline?: string };
  /** CTAs on the beat whose id is "fin". */
  ending?: { ctas?: { label: string; href: string }[] };
  /** Footer wordmark text. */
  wordmark?: string;
}

export interface DeckMeta {
  id: string;
  title: string;
  treatment?: SlideTreatment;
  noindex?: boolean;
  chrome?: DeckChrome;
  fonts?: { display?: string; body?: string; cursive?: string };
}

export interface DeckDoc {
  version: 1;
  meta: DeckMeta;
  scenes: Scene[];
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function validateDeckDoc(obj: unknown): { ok: boolean; errors: string[] } {
  const e: string[] = [];
  const d = obj as Partial<DeckDoc>;
  if (!d || typeof d !== "object") return { ok: false, errors: ["not an object"] };
  if (d.version !== 1) e.push("version must be 1");
  if (!d.meta || typeof d.meta !== "object") e.push("meta missing");
  else {
    if (typeof d.meta.id !== "string" || !ID_RE.test(d.meta.id)) e.push("meta.id must match /^[a-z0-9][a-z0-9-]*$/");
    if (typeof d.meta.title !== "string" || !d.meta.title) e.push("meta.title required");
  }
  if (!Array.isArray(d.scenes)) e.push("scenes must be an array");
  else d.scenes.forEach((s: Scene, i) => {
    if (!s || typeof s.id !== "string") e.push(`scenes[${i}].id required`);
    if (!Array.isArray(s?.beats)) e.push(`scenes[${i}].beats must be an array`);
  });
  return { ok: e.length === 0, errors: e };
}

export const DECK_ID_RE = ID_RE;
