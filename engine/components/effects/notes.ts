import type { NoteGlyph, StoryAsset } from "@/engine/deck/story-assets";
import { NOTE_SIZE_N } from "./note-state";

/** Build a note sprite tinted to an arbitrary HEX (glyph is white line-art → mask + bg color).
 *  Sized as a fraction of the 16:9 stage so the effect is resolution-independent — the px
 *  sizing it replaced made the same emitter look different in the canvas and in BeatStage. */
export function makeNoteHex(hex: string, glyph: NoteGlyph, resolveStory: (key: StoryAsset) => string): HTMLElement {
  const el = document.createElement("span");
  const url = resolveStory(glyph);
  Object.assign(el.style, {
    position: "absolute", width: `${NOTE_SIZE_N * 100}%`, aspectRatio: "1",
    backgroundColor: hex,
    WebkitMaskImage: `url(${url})`, maskImage: `url(${url})`,
    WebkitMaskSize: "contain", maskSize: "contain",
    WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
    filter: `drop-shadow(0 0 6px ${hex})`,
    willChange: "transform, opacity",
  } as unknown as CSSStyleDeclaration);
  el.dataset.hex = hex;
  el.dataset.glyph = glyph;
  return el;
}
