"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { Beat, Scene } from "@/engine/deck/types";
import type { StoryAsset } from "@/engine/deck/story-assets";
import type { DeckChrome } from "@/engine/deck-doc";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { NoteField, type NoteFieldHandle } from "@/engine/components/NoteField";
import { CinematicSlide } from "@/engine/components/layouts/CinematicSlide";
import { ObjectStage, type ObjectStageHandle } from "@/components/editor/ObjectStage";
import { beatTimeline } from "@/engine/authoring/seek";
import { makeAuthoringRuntime } from "./runtime";

export function BeatStage({
  sceneId, beat, animate = true, entryLayers = [], endLayers = [], chrome, contained = false,
  scene, beatIndex = 0,
}: {
  sceneId: string; beat: Beat; animate?: boolean;
  entryLayers?: StoryAsset[]; endLayers?: StoryAsset[];
  chrome?: DeckChrome; contained?: boolean;
  scene?: Scene; beatIndex?: number;
}) {
  const art = useRef<ArtStageHandle>(null);
  const notes = useRef<NoteFieldHandle>(null);
  const objStage = useRef<ObjectStageHandle>(null);
  const [night, setNight] = useState(beat.nightlight ?? 0);

  const runtime = useMemo(
    () => makeAuthoringRuntime({
      art, notes, setNight,
      resolveEntry: () => entryLayers,
      resolveEnd: () => endLayers,
      onGate: () => {}, onWaiting: () => {},
    }),
    [entryLayers, endLayers],
  );

  // Drive the object stage: static end-state when !animate, else a proxy tween on a local
  // timeline sampling the reducer. Span = the beat's total timeline duration.
  useEffect(() => {
    if (!scene) return;
    const span = beatTimeline(beat.timeline).reduce((m, w) => Math.max(m, w.end), 0);
    if (!animate || span <= 0) { objStage.current?.renderAt(scene, beatIndex, span || 1e9); return; }
    const proxy = { p: 0 };
    const tl = gsap.timeline().to(proxy, {
      p: 1, duration: span, ease: "none",
      onUpdate: () => objStage.current?.renderAt(scene, beatIndex, proxy.p * span),
    });
    return () => { tl.kill(); };
  }, [scene, beat, beatIndex, animate]);

  return (
    <div data-testid="beatstage" style={{ position: contained ? "absolute" : "fixed", inset: 0, containerType: "size", background: "var(--color-mm-dark-brown)" }}>
      <ArtStage ref={art} nightlight={night} reduced={false} transparentBg />
      <NoteField ref={notes} reduced={false} />
      <div style={{ position: "absolute", inset: 0 }}>
        <CinematicSlide slots={{ sceneId, beat }} animate={animate} runtime={runtime} chrome={chrome} />
      </div>
      {scene && <ObjectStage ref={objStage} scene={scene} active />}
    </div>
  );
}
