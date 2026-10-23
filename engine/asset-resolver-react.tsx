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
export function DeckAssetsProvider({ deckId, children }: { deckId: string; children: React.ReactNode }) {
  const value = useMemo(() => deckAssetResolver(deckId), [deckId]);
  return <AssetResolverProvider value={value}>{children}</AssetResolverProvider>;
}
