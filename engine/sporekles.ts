/**
 * mm-sporekles — design-asset CDN integration.
 *
 * Sporekles is the canonical store for the brand's binary design library
 * (logos, decorative imagery, fonts, CSS tokens). Public assets are served
 * from the CDN below; the inventory is at /manifest.json. Updates uploaded
 * via the Sporekles UI become visible to the site immediately (no rebuild).
 *
 * See CLAUDE.md → "Design System" for the broader mirror policy.
 */

export const SPOREKLES_CDN = "https://design-assets.musicalmycology.org";

/**
 * Filenames of public asset entries in the sporekles manifest. The slug
 * vocabulary is fixed to the manifest so a typo here fails at build/type
 * time rather than at runtime with a 403.
 */
export type SporekleAsset =
  // Day/night mushroom pairs — used together via the active theme.
  | "day_angelring.png"
  | "night_devilring2.png"
  | "day_corpusviola.png"
  | "night_corpusviola.png"
  | "day_faeriecrown.png"
  | "night_faeriecrown.png"
  | "day_gildedhaze.png"
  | "night_guildedreverie.png"
  | "day_glimmeringoculi.png"
  | "night_glimmeringoculi2.png"
  | "dayvein.png"
  | "nightvein1.png"
  // Logo day/night pairs.
  | "logo_day_angelring.png"
  | "logo_night_devilring.png"
  | "logo_dayvein.png"
  | "logo_nightvein.png"
  | "foundation_logo_day.png"
  | "foundation_logo_night.png"
  // Vision rebuild — Puffle hero frames (2.1)
  | "puffball_day_1.png"
  | "puffball_day_2.png"
  | "puffball_day_3.png"
  | "puffball_day_4.png"
  | "puffball_day_5.png"
  | "puffball_day_6.png"
  | "puffball_night_1.png"
  | "puffball_night_2.png"
  | "puffball_night_3.png"
  | "puffball_night_4.png"
  | "puffball_night_5.png"
  | "puffball_night_6.png"
  // Vision rebuild — Tune Shroom (2.3)
  | "tuneshroom_day.png"
  | "tuneshroom_night.png"
  | "tuneshroom_diagram.png"
  // Vision rebuild — props slideshow (2.4)
  | "cart_day.png"
  | "cart_night.png"
  | "terrarium_day.png"
  | "terrarium_night.png"
  | "bits_day.png"
  | "bits_night.png";

/** Resolve a sporekles asset filename to its absolute CDN URL. */
export function sporekleAsset(filename: SporekleAsset): string {
  return `${SPOREKLES_CDN}/assets/${filename}`;
}
