// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { DECK_FONTS, loadDeckFonts } from "@/components/player/render-fonts";

afterEach(() => {
  for (const { cssVar } of DECK_FONTS) document.documentElement.style.removeProperty(cssVar);
  delete (document as { fonts?: unknown }).fonts;
});

test("DECK_FONTS matches the next/font families and weights app/layout.tsx declares", () => {
  const src = readFileSync(join(__dirname, "../../app/layout.tsx"), "utf8");
  const declared = [...src.matchAll(/weight:\s*\[([^\]]*)\][^\n]*variable:\s*"([^"]+)"/g)]
    .map((m) => ({ cssVar: m[2], weights: [...m[1].matchAll(/"(\d+)"/g)].map((w) => w[1]) }));
  expect(declared.length).toBeGreaterThan(0);
  expect(DECK_FONTS).toEqual(declared);
});

test("loads every family (each separately) at every weight, resolved from the CSS variables, then awaits fonts.ready", async () => {
  const order: string[] = [];
  const load = vi.fn(async (spec: string) => { order.push(spec); return []; });
  let readyResolved = false;
  const ready = new Promise<void>((r) => setTimeout(() => { readyResolved = true; order.push("ready"); r(); }, 0));
  Object.defineProperty(document, "fonts", { value: { load, ready }, configurable: true });
  document.documentElement.style.setProperty("--font-display", "'__Londrina_Solid_x', '__Londrina_Solid_Fallback_x'");
  document.documentElement.style.setProperty("--font-body", "'__Atkinson_x'");
  document.documentElement.style.setProperty("--font-cursive", "'__Dancing_x'");

  await loadDeckFonts();

  expect(readyResolved).toBe(true);
  expect(load.mock.calls.map((c) => c[0])).toEqual([
    "400 1em '__Londrina_Solid_x'", "900 1em '__Londrina_Solid_x'",
    "400 1em '__Londrina_Solid_Fallback_x'", "900 1em '__Londrina_Solid_Fallback_x'",
    "400 1em '__Atkinson_x'", "700 1em '__Atkinson_x'",
    "400 1em '__Dancing_x'", "700 1em '__Dancing_x'",
  ]);
  expect(order.at(-1)).toBe("ready");
});

test("a face that fails to load (e.g. a missing local() fallback) neither fails the page nor blocks the real font", async () => {
  const load = vi.fn(async (spec: string) => { if (spec.includes("Fallback")) throw new Error("NetworkError"); return []; });
  Object.defineProperty(document, "fonts", { value: { load, ready: Promise.resolve() }, configurable: true });
  document.documentElement.style.setProperty("--font-display", "'X', 'X Fallback'");
  await expect(loadDeckFonts()).resolves.toBeUndefined();
  expect(load.mock.calls.map((c) => c[0])).toEqual(["400 1em 'X'", "900 1em 'X'", "400 1em 'X Fallback'", "900 1em 'X Fallback'"]);
});
