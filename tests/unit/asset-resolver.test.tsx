import { expect, test } from "vitest";
import { defaultAssetResolver, type AssetResolver } from "@/engine/asset-resolver";

test("default resolver reproduces current URLs", () => {
  const r = defaultAssetResolver;
  expect(r.story("3.02")).toBe("/storyboard/panels/3.02.jpg");
  expect(r.story("MusicScore")).toBe("/storyboard/overlays/MusicScore.png");
  expect(r.story("Notes1")).toBe("/storyboard/notes/Notes1.png");
  expect(r.brand("logo_day_angelring.png"))
    .toBe("https://design-assets.musicalmycology.org/assets/logo_day_angelring.png");
});

test("custom resolver overrides", () => {
  const r: AssetResolver = {
    story: (k) => `https://cdn.example/${k}`,
    brand: (f) => `https://cdn.example/${f}`,
  };
  expect(r.story("3.02")).toBe("https://cdn.example/3.02");
});
