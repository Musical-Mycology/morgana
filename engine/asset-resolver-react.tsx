"use client";
import { createContext, useContext } from "react";
import { defaultAssetResolver } from "@/engine/asset-resolver";
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
