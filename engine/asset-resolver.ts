import type { StoryAsset } from "@/engine/deck/story-assets";
import { storyAssetUrl } from "@/engine/deck/story-assets";
import { sporekleAsset, type SporekleAsset } from "@/engine/sporekles";

export interface AssetResolver {
  story(key: StoryAsset): string;
  brand(file: SporekleAsset): string;
}

export const defaultAssetResolver: AssetResolver = {
  story: (key) => storyAssetUrl(key),
  brand: (file) => sporekleAsset(file),
};
