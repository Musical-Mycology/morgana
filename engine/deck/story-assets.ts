/** Storyboard panel keys (clean "without Notes" art). */
export const PANELS = [
  "1.01", "1.02", "1.03", "2.01", "2.02",
  "3.01", "3.02", "3.03", "3.04", "4",
] as const;
export type Panel = (typeof PANELS)[number];

/** Note-glyph keys (white line-art, tinted live). */
export const NOTE_GLYPHS = [
  "Notes1","Notes2","Notes3","Notes4","Notes5","Notes6","Notes7","Notes8","Notes9",
  "clef1","clef2","rest1","rest2","rest3",
] as const;
export type NoteGlyph = (typeof NOTE_GLYPHS)[number];

/** Full-frame transparent line-art overlays, screen-blended over a panel. */
export const OVERLAYS = ["MusicScore"] as const;
export type Overlay = (typeof OVERLAYS)[number];

export type StoryAsset = Panel | NoteGlyph | Overlay;

const PANEL_SET = new Set<string>(PANELS);
const OVERLAY_SET = new Set<string>(OVERLAYS);

/** True for overlay assets (transparent PNGs, screen-blended). */
export function isOverlay(asset: StoryAsset): boolean {
  return OVERLAY_SET.has(asset);
}

/**
 * Local public URL for an asset. Local-first for the preview loop;
 * Phase 3 swaps this to sporekleAsset(...) once uploaded to the CDN.
 */
export function storyAssetUrl(asset: StoryAsset): string {
  if (OVERLAY_SET.has(asset)) return `/storyboard/overlays/${asset}.png`;
  // Panels are opaque full-frame art → JPEG (much smaller); note glyphs need PNG alpha.
  return PANEL_SET.has(asset)
    ? `/storyboard/panels/${asset}.jpg`
    : `/storyboard/notes/${asset}.png`;
}

export type NoteColor = "cyan" | "lime" | "pink" | "cream";
/** Per the supplied Hex sheet: fill = note color, glow = color-dodge halo. */
export const NOTE_TINTS: Record<NoteColor, { fill: string; glow: string }> = {
  cyan:  { fill: "#3FFBFF", glow: "#01C2DF" },
  lime:  { fill: "#E3F84F", glow: "#AEE769" },
  pink:  { fill: "#FFBDEC", glow: "#F85057" },
  cream: { fill: "#F6E6D7", glow: "#C78353" },
};

/** Normalized (0..1) emit points over a panel; tuned live in preview. */
export interface Anchor { x: number; y: number }
export const PANEL_ANCHORS: Partial<Record<Panel, Anchor[]>> = {
  // First-pass guesses; refined against the art during the content build.
  "2.02": [{ x: 0.30, y: 0.62 }, { x: 0.62, y: 0.66 }, { x: 0.48, y: 0.58 }],
  "3.01": [{ x: 0.45, y: 0.50 }, { x: 0.55, y: 0.58 }],
};
