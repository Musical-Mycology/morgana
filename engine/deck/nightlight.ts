export interface Palette {
  bgTop: string;
  bgBottom: string;
  /** 0..1 glow intensity; rises with nightlight. */
  glow: number;
}

const DAY = { bgTop: [253, 243, 228], bgBottom: [245, 223, 192] };
const NIGHT = { bgTop: [26, 20, 16], bgBottom: [48, 32, 64] };

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function mix(a: number[], b: number[], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

export function paletteFor(nightlight: number): Palette {
  const t = clamp01(nightlight);
  return {
    bgTop: mix(DAY.bgTop, NIGHT.bgTop, t),
    bgBottom: mix(DAY.bgBottom, NIGHT.bgBottom, t),
    glow: t,
  };
}
