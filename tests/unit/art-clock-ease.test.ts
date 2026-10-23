import { expect, test } from "vitest";
import gsap from "gsap";
import { power2InOut, backOut2, clamp01, ART_DURATION_MS, NIGHT_ENTRY_MS } from "@/engine/authoring/art-clock";

const samples = Array.from({ length: 101 }, (_, i) => i / 100);

test("power2InOut matches GSAP's power2.inOut (cubic)", () => {
  const ref = gsap.parseEase("power2.inOut");
  for (const p of samples) expect(power2InOut(p)).toBeCloseTo(ref(p), 6);
});

test("backOut2 matches GSAP's back.out(2)", () => {
  const ref = gsap.parseEase("back.out(2)");
  for (const p of samples) expect(backOut2(p)).toBeCloseTo(ref(p), 6);
});

test("clamp01 and constants", () => {
  expect([clamp01(-1), clamp01(0.4), clamp01(2)]).toEqual([0, 0.4, 1]);
  expect(ART_DURATION_MS).toEqual({ cut: 0, fade: 700, crossfade: 900, morph: 800, dissolve: 1100 });
  expect(NIGHT_ENTRY_MS).toBe(200);
});
