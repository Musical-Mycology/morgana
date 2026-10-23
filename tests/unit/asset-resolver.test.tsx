import { useEffect } from "react";
import { render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DeckAssetsProvider, useAssetResolver } from "@/engine/asset-resolver-react";
import { defaultAssetResolver, deckAssetResolver, type AssetResolver } from "@/engine/asset-resolver";
import { mediaUrl } from "@/lib/api/media-client";

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
    media: (m) => `https://cdn.example/${m}`,
  };
  expect(r.story("3.02")).toBe("https://cdn.example/3.02");
});

const REF = "media:0123456789abcdef.mp4" as const;

test("default resolver resolves media refs to an empty string (no deck)", () => {
  expect(defaultAssetResolver.media(REF)).toBe("");
});

test("deckAssetResolver maps a media ref to the deck's media URL", () => {
  const r = deckAssetResolver("d1");
  expect(r.media(REF)).toBe(mediaUrl("d1", "0123456789abcdef.mp4"));
  expect(r.media(REF)).toBe("/api/decks/d1/media/0123456789abcdef.mp4");
});

test("deckAssetResolver leaves story() and brand() unchanged", () => {
  const r = deckAssetResolver("d1");
  expect(r.story("1.01")).toBe(defaultAssetResolver.story("1.01"));
  expect(r.brand("logo_day_angelring.png")).toBe(defaultAssetResolver.brand("logo_day_angelring.png"));
});

test("deckAssetResolver media URL is prefixed with the configured base path", async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/morgana");
  const { deckAssetResolver: make } = await import("@/engine/asset-resolver");
  expect(make("d1").media(REF)).toBe("/morgana/api/decks/d1/media/0123456789abcdef.mp4");
});

test("DeckAssetsProvider resolves media for its deck and keeps a stable resolver per deckId", () => {
  const seen: AssetResolver[] = [];
  function Probe() { seen.push(useAssetResolver()); return null; }
  const { rerender } = render(<DeckAssetsProvider deckId="d1"><Probe /></DeckAssetsProvider>);
  expect(seen[0].media("media:x.mp4")).toBe(mediaUrl("d1", "x.mp4"));
  rerender(<DeckAssetsProvider deckId="d1"><Probe /></DeckAssetsProvider>);
  expect(seen[seen.length - 1]).toBe(seen[0]);
});

test("DeckAssetsProvider with a null id falls back to the default resolver and never remounts children", () => {
  let mounts = 0;
  const seen: AssetResolver[] = [];
  function Probe() { useEffect(() => { mounts++; }, []); seen.push(useAssetResolver()); return null; }
  const ui = (id: string | null) => <DeckAssetsProvider deckId={id}><Probe /></DeckAssetsProvider>;
  const { rerender } = render(ui(null));
  expect(seen[0]).toBe(defaultAssetResolver);
  rerender(ui("d1"));
  expect(seen[seen.length - 1].media("media:x.mp4")).toBe(mediaUrl("d1", "x.mp4"));
  expect(mounts).toBe(1);
});
