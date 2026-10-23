import type { RefObject } from "react";
import type { CinematicRuntime } from "@/engine/components/layouts/CinematicSlide";
import type { ArtStageHandle } from "@/engine/components/ArtStage";
import type { StoryAsset } from "@/engine/deck/story-assets";

export interface AuthoringHooks {
  art: RefObject<ArtStageHandle | null>;
  setNight: (n: number) => void;
  resolveEntry: () => StoryAsset[];
  resolveEnd: () => StoryAsset[];
  onGate: (resume: () => void) => void;
  onWaiting: (waiting: boolean) => void;
}

/** A CinematicRuntime with NO global input capture / fullscreen — for the editor.
 *  Note sources are deliberately NOT plumbed through here: they render from the pure
 *  noteFieldStateAt reducer via NoteField, driven by whatever clock the host supplies. */
export function makeAuthoringRuntime(h: AuthoringHooks): CinematicRuntime {
  return {
    art: (layers, mode, ms) => h.art.current?.show(layers, mode, ms),
    applyArt: (t, ms) => h.art.current?.apply(t, ms),
    setNightlight: (to) => h.setNight(to),
    onGate: (resume) => h.onGate(resume),
    revealArrows: () => {},
    pulseArrow: () => {},
    onWaiting: (w) => h.onWaiting(w),
    resolveEntry: () => h.resolveEntry(),
    resolveEnd: () => h.resolveEnd(),
    jumpTo: () => {},
  };
}
