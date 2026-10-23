"use client";
import { createContext, useContext, useMemo } from "react";
import { defaultAssetResolver, deckAssetResolver } from "@/engine/asset-resolver";
import type { AssetResolver } from "@/engine/asset-resolver";

export type { AssetResolver } from "@/engine/asset-resolver";
export { defaultAssetResolver } from "@/engine/asset-resolver";

const Ctx = createContext<AssetResolver>(defaultAssetResolver);

export function AssetResolverProvider({ value, children }: { value: AssetResolver; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssetResolver(): AssetResolver {
  return useContext(Ctx);
}

/** Scopes media refs to one deck for everything beneath it (`/play`, `/render`, the editor canvas). */
export function DeckAssetsProvider({ deckId, children }: { deckId: string | null | undefined; children: React.ReactNode }) {
  // A not-yet-known (null/undefined/empty) id falls back to the default resolver, so callers can
  // wrap unconditionally and the subtree never remounts when the id arrives.
  const value = useMemo(() => (deckId ? deckAssetResolver(deckId) : defaultAssetResolver), [deckId]);
  return <AssetResolverProvider value={value}>{children}</AssetResolverProvider>;
}
