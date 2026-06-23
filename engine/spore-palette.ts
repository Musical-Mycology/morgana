import { clamp01 } from "@/engine/deck/nightlight";

/** Warm terracotta/gold spores read against the day ground. */
export const DAY = ["#c07850", "#d4a843", "#e8c090"];
/** Cool blue/violet spores read against the night ground. */
export const NIGHT = ["#b0b0f0", "#8a7ed8", "#6db6d9", "#c77dd8"];

/** Palette flips at the midpoint. Shared by the deck and the marketing hero. */
export function sporeColors(nightlight: number): string[] {
  return clamp01(nightlight) >= 0.5 ? NIGHT : DAY;
}
