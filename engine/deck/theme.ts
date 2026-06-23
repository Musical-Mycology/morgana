import type { SlideTheme } from "./types";

export interface ThemeColors {
  /** Primary text color (CSS value). */
  ink: string;
  /** Eyebrow/accent color (CSS value). */
  accent: string;
}

/** Foreground color sets per slide text theme. Brand tokens only. */
const THEMES: Record<SlideTheme, ThemeColors> = {
  light: { ink: "var(--color-mm-mushroom)", accent: "var(--color-mm-terracotta)" },
  dark: { ink: "var(--color-mm-cream)", accent: "var(--color-mm-gold)" },
};

export function themeColors(theme: SlideTheme = "light"): ThemeColors {
  return THEMES[theme];
}
