"use client";
import { useMemo, useRef, useState } from "react";
import type { Beat } from "@/engine/deck/types";
import type { StoryAsset } from "@/engine/deck/story-assets";
import type { DeckChrome } from "@/engine/deck-doc";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { NoteField, type NoteFieldHandle } from "@/engine/components/NoteField";
import { CinematicSlide } from "@/engine/components/layouts/CinematicSlide";
import { makeAuthoringRuntime } from "./runtime";

export function BeatStage({
  sceneId, beat, animate = true, entryLayers = [], endLayers = [], chrome,
}: {
  sceneId: string; beat: Beat; animate?: boolean;
  entryLayers?: StoryAsset[]; endLayers?: StoryAsset[];
  chrome?: DeckChrome;
}) {
  const art = useRef<ArtStageHandle>(null);
  const notes = useRef<NoteFieldHandle>(null);
  const [night, setNight] = useState(beat.nightlight ?? 0);

  const runtime = useMemo(
    () => makeAuthoringRuntime({
      art, notes, setNight,
      resolveEntry: () => entryLayers,
      resolveEnd: () => endLayers,
      onGate: () => {},
      onWaiting: () => {},
    }),
    [entryLayers, endLayers],
  );

  return (
    <div data-testid="beatstage" style={{ position: "fixed", inset: 0, background: "var(--color-mm-dark-brown)" }}>
      <ArtStage ref={art} nightlight={night} reduced={false} transparentBg />
      <NoteField ref={notes} reduced={false} />
      <div className="deck__stage" style={{ position: "absolute", inset: 0 }}>
        <CinematicSlide slots={{ sceneId, beat }} animate={animate} runtime={runtime} chrome={chrome} />
      </div>
    </div>
  );
}
