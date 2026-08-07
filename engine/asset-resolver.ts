import type { StoryAsset } from "@/engine/deck/story-assets";
import { storyAssetUrl } from "@/engine/deck/story-assets";
import { sporekleAsset, type SporekleAsset } from "@/engine/sporekles";
import { withBasePath } from "@/lib/base-path";

export interface AssetResolver {
  story(key: StoryAsset): string;
  brand(file: SporekleAsset | string): string;
}

// storyAssetUrl() hand-builds app-absolute URLs ("/storyboard/…"); Next does not
// rewrite these for basePath, so they must be prefixed here, at the one seam
// between the pure story-assets module and the DOM-facing components that read
// .story() (ArtStage, NoteField, CinematicSlide). Do NOT push withBasePath into
// story-assets.ts itself — engine/components/effects/note-state.ts value-imports
// NOTE_GLYPHS from that module, and note-state.ts must keep a DOM-free runtime
// import graph (see tests/unit/pure-import-graph.test.ts).
export const defaultAssetResolver: AssetResolver = {
  story: (key) => withBasePath(storyAssetUrl(key)),
  brand: (file) => sporekleAsset(file),
};
