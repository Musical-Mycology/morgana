"use client";
import { useEffect, useRef } from "react";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { renderBeatAt } from "@/engine/authoring/seek";
import type { Beat } from "@/engine/deck/types";

/** Read-only, static (t=0) render of a single cinematic beat — used for deck-library card
 *  thumbnails. Not interactive; no seek/play controls, no editor-store coupling. */
export function BeatThumbnail({ beat }: { beat: Beat }) {
  const art = useRef<ArtStageHandle>(null);
  const textHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (textHost.current) renderBeatAt(beat.timeline, 0, { textHost: textHost.current, art: art.current });
  }, [beat]);

  return (
    <div
      className="lib__thumb-stage"
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
      aria-hidden
    >
      <ArtStage ref={art} nightlight={beat.nightlight ?? 0.6} reduced transparentBg />
      <div className="cin__stage">
        <div ref={textHost} className="cin__text" style={{ position: "absolute", inset: 0, maxWidth: "none" }} />
      </div>
    </div>
  );
}
