import { afterEach, expect, test, vi } from "vitest";
import { defaultAssetResolver, type AssetResolver } from "@/engine/asset-resolver";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("default resolver reproduces current URLs", () => {
  const r = defaultAssetResolver;
  expect(r.story("3.02")).toBe("/storyboard/panels/3.02.jpg");
  expect(r.story("MusicScore")).toBe("/storyboard/overlays/MusicScore.png");
  expect(r.story("Notes1")).toBe("/storyboard/notes/Notes1.png");
  expect(r.brand("logo_day_angelring.png"))
    .toBe("https://design-assets.musicalmycology.org/assets/logo_day_angelring.png");
});

test("story() is prefixed with the configured base path", async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/morgana");
  const { defaultAssetResolver: r } = await import("@/engine/asset-resolver");
  expect(r.story("3.02")).toBe("/morgana/storyboard/panels/3.02.jpg");
  expect(r.story("MusicScore")).toBe("/morgana/storyboard/overlays/MusicScore.png");
  expect(r.story("Notes1")).toBe("/morgana/storyboard/notes/Notes1.png");
});

test("custom resolver overrides", () => {
  const r: AssetResolver = {
    story: (k) => `https://cdn.example/${k}`,
    brand: (f) => `https://cdn.example/${f}`,
  };
  expect(r.story("3.02")).toBe("https://cdn.example/3.02");
});
