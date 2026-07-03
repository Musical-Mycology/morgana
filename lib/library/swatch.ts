/** Deterministic gradient swatch (hashed from the deck id) for decks with no cinematic
 *  beat to thumbnail — see design spec §3 "Thumbnail fallback". */
export function swatchGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const hue2 = (hue + 40) % 360;
  return `linear-gradient(135deg, hsl(${hue}, 45%, 32%), hsl(${hue2}, 55%, 14%))`;
}
