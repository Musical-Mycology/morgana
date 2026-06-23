import type { ISourceOptions } from "@tsparticles/engine";
import { clamp01 } from "@/engine/deck/nightlight";
import { sporeColors } from "@/engine/spore-palette";

export { sporeColors };

/** tsParticles options for a drifting-spore field at a given nightlight. */
export function sporeOptions(nightlight: number): ISourceOptions {
  const t = clamp01(nightlight);
  const night = t >= 0.5;
  const colors = sporeColors(t);
  const opacity = 0.5 + 0.1 * t; // 0.5 day → 0.6 night
  return {
    fullScreen: { enable: false },
    fpsLimit: 60,
    detectRetina: true,
    particles: {
      number: { value: 36, density: { enable: true } },
      color: { value: colors },
      shape: { type: "circle" },
      opacity: { value: opacity },
      size: { value: { min: 2, max: 6 } },
      move: {
        enable: true,
        direction: "top",
        speed: { min: 0.2, max: 0.7 },
        straight: false,
        outModes: { default: "out", bottom: "out", top: "destroy" },
      },
      shadow: {
        enable: night,
        color: colors[0],
        blur: 8,
      },
    },
  };
}

/** One-shot spore burst from slide center (closing "burst" effect). */
export function burstOptions(nightlight: number): ISourceOptions {
  const colors = sporeColors(nightlight);
  return {
    fullScreen: { enable: false },
    particles: {
      number: { value: 0 },
      color: { value: colors },
      shape: { type: "circle" },
      opacity: { value: 0.6 },
      size: { value: { min: 2, max: 5 } },
      move: {
        enable: true,
        gravity: { enable: true, acceleration: 6 },
        speed: { min: 6, max: 14 },
        decay: 0.05,
        outModes: "destroy",
      },
    },
    emitters: {
      direction: "none",
      // One-shot: emit the whole batch via startCount, then never again.
      // (rate.quantity: 0 + life.count: 1 mirrors the canonical confetti emitter.)
      startCount: 120,
      life: { count: 1, duration: 0.1 },
      rate: { delay: 0, quantity: 0 },
      size: { width: 0, height: 0, mode: "percent" },
      position: { x: 50, y: 60 },
    },
  };
}
