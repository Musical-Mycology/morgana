export interface RampOpts {
  floor?: number;
  cap?: number;
}

/**
 * Opacity of the "Download" button at a 0-based slide index.
 * floor on slide 0, easing to cap across the deck, full (1.0) on the last slide.
 */
export function downloadOpacity(
  index: number,
  lastIndex: number,
  opts: RampOpts = {}
): number {
  const floor = opts.floor ?? 0.1;
  const cap = opts.cap ?? 0.5;
  if (lastIndex <= 0) return 1;
  if (index >= lastIndex) return 1;
  return floor + (cap - floor) * (index / lastIndex);
}
