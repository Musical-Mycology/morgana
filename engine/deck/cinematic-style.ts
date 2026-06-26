import type { TextSize } from "./types";

/**
 * Editable font-size scale for cinematic narration text.
 *
 * The `size` field on a `{ kind: "text" }` action ("lg" | "md" | "sm") maps to
 * one of these. Values are any CSS font-size — `clamp(min, cqmin, max)` keeps them
 * responsive to the stage container (container-query units, not the viewport/window).
 * The stage is height-constrained in landscape, so cqmin (the short axis) tracks it better than cqw.
 * The `max` is the desktop size; `min` is the floor on very small containers.
 *
 * Tweak these freely; /story hot-reloads. To ADD a new size token (e.g. "xl"),
 * add it BOTH here and to `TextSize` in `types.ts`.
 */
export const TEXT_SIZES: Record<TextSize, string> = {
  xs: "clamp(0.7rem, 3.2cqmin, 1.35rem)",
  sm: "clamp(0.95rem, 4.6cqmin, 1.95rem)",
  md: "clamp(1.15rem, 5.6cqmin, 2.4rem)",
  lg: "clamp(1.4rem, 7cqmin, 3.0rem)",
  xl: "clamp(1.8rem, 9cqmin, 3.8rem)",
};

/**
 * Font-size for the `cursive` text effect (a script face, intentionally larger than `lg`
 * since cursive runs visually smaller at the same size). Tweak freely; /story hot-reloads.
 */
export const CURSIVE_SIZE = "clamp(5rem, 28cqmin, 12rem)";

/** Default text-box top-left on the 16:9 stage when a beat omits `pos` (normalized 0–1). */
export const DEFAULT_TEXT_POS = { x: 0.03, y: 0.1 };
