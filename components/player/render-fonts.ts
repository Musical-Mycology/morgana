/** The font families + weights deck CSS uses: app/layout.tsx declares them as next/font CSS
 *  variables on <html> (kept in sync by tests/unit/render-fonts.test.ts). */
export const DECK_FONTS: { cssVar: string; weights: string[] }[] = [
  { cssVar: "--font-display", weights: ["400", "900"] },
  { cssVar: "--font-body", weights: ["400", "700"] },
  { cssVar: "--font-cursive", weights: ["400", "700"] },
];

/** Load every deck font before the first beat mounts: SplitText measures lines while a beat
 *  builds, so text built before its font arrives would be split at fallback-font widths. A font
 *  that fails to load is tolerated (the browser renders the fallback). */
export async function loadDeckFonts(): Promise<void> {
  const style = getComputedStyle(document.documentElement);
  // Each family in the variable's list loads on its own: next/font's metric "Fallback" face is a
  // local() font that errors where that system font is missing, and would reject the whole list.
  const families = (cssVar: string) => style.getPropertyValue(cssVar).split(",").map((f) => f.trim()).filter(Boolean);
  await Promise.all(DECK_FONTS.flatMap(({ cssVar, weights }) => families(cssVar).flatMap((family) =>
    weights.map((w) => document.fonts.load(`${w} 1em ${family}`).catch(() => [])))));
  await document.fonts.ready;
}
