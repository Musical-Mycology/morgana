import manifest from "./fonts.json";

export type FontRole = "display" | "body" | "cursive";
export interface FontEntry { family: string; pkg: string; role: FontRole; weights: number[]; license: string; }

export const FONT_DEFAULTS = manifest.defaults as Record<FontRole, string>;
export const FONT_CATALOG = manifest.families as FontEntry[];

/** Families for the picker; pass a role to filter, omit for all. */
export function fontFamilies(role?: FontRole): FontEntry[] {
  return role ? FONT_CATALOG.filter((f) => f.role === role) : FONT_CATALOG;
}
