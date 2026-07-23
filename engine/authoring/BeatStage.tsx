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
  //
  // KNOWN LIMITATION (see design spec §6 "Known limitations"): this proxy tween is its own
  // independent `gsap.timeline()` running on wall-clock time from mount — it is NOT attached to
  // CinematicSlide's actual master timeline. CinematicSlide has no single persistent master; it
  // splits a beat into segments at `click_gate` boundaries and pauses indefinitely between
  // segments waiting for `runtime.onGate`/user input. Because this proxy keeps advancing on a
  // fixed real-time schedule regardless of those pauses, a beat that combines a `click_gate`
  // with `obj_*` actions scheduled after the gate will show the object animating out of sync
  // with the actual gated segment (it won't pause when CinematicSlide pauses, and may finish
  // its "wait for the click" long before the user actually clicks). This is a known, accepted
  // limitation for 3b — the real fix (attaching the proxy to each of CinematicSlide's segment
  // timelines) requires exposing masterRef/segment state outside CinematicSlide, which is out of
  // scope here and deferred alongside the north-star §7 "real GSAP transport surface" work.
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
