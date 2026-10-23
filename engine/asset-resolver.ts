import type { StoryAsset } from "@/engine/deck/story-assets";
import { storyAssetUrl } from "@/engine/deck/story-assets";
import { sporekleAsset, type SporekleAsset } from "@/engine/sporekles";
import { withBasePath } from "@/lib/base-path";
import { mediaRefId, type MediaRef } from "@/engine/deck/media-ref";
import { mediaUrl } from "@/lib/api/media-client";

export interface AssetResolver {
  story(key: StoryAsset): string;
  brand(file: SporekleAsset | string): string;
  /** `media:<id>` ref → URL of that deck's uploaded media. "" when there is no deck. */
  media(ref: MediaRef): string;
}

// storyAssetUrl() hand-builds app-absolute URLs ("/storyboard/…"); Next does not
// rewrite these for basePath, so they must be prefixed here, at the one seam
// between the pure story-assets module and the DOM-facing components that read
// .story() (ArtStage, NoteField, CinematicSlide). Do NOT push withBasePath into
// story-assets.ts itself — engine/components/effects/note-state.ts value-imports
// NOTE_GLYPHS from that module, and a deck-format core should not acquire a
// dependency on build-time env config. Note that no test currently enforces
// this: pure-import-graph.test.ts greps for DOM tokens (document., .innerHTML,
// createElement) and lib/base-path.ts has none, so it would NOT have caught the
// mistake. This comment is the guard.
//
// This is also the ONLY runtime import of storyAssetUrl in the repo. A new
// DOM consumer importing it directly would bypass the prefix and 404 under a
// sub-path with nothing failing — see docs/MM_MORGANA.md.
export const defaultAssetResolver: AssetResolver = {
  story: (key) => withBasePath(storyAssetUrl(key)),
  brand: (file) => sporekleAsset(file),
  media: () => "",
};

/** Resolver for a loaded deck: media refs map to that deck's media URL (base path applied by
 *  mediaUrl — the one seam). Everything else behaves as the default. */
export function deckAssetResolver(deckId: string): AssetResolver {
  return { ...defaultAssetResolver, media: (ref) => mediaUrl(deckId, mediaRefId(ref)) };
}
