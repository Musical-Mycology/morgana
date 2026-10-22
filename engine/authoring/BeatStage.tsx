"use client";
import { useCallback, useMemo, useRef, useState, type Ref } from "react";
import type { Beat, Scene } from "@/engine/deck/types";
import type { StoryAsset } from "@/engine/deck/story-assets";
import type { DeckChrome } from "@/engine/deck-doc";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { NoteField, type NoteFieldHandle } from "@/engine/components/NoteField";
import { CinematicSlide, type SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import { ObjectStage, type ObjectStageHandle } from "@/components/editor/ObjectStage";
import { makeAuthoringRuntime } from "./runtime";

export function BeatStage({
  sceneId, beat, animate = true, entryLayers = [], endLayers = [], chrome, contained = false,
  scene, beatIndex = 0, transport, autoplay = true, entryNight,
}: {
  sceneId: string; beat: Beat; animate?: boolean;
  entryLayers?: StoryAsset[]; endLayers?: StoryAsset[];
  chrome?: DeckChrome; contained?: boolean;
  scene?: Scene; beatIndex?: number;
  /** Imperative seek/play/pause/duration over CinematicSlide's single time axis — forwarded
   *  straight through (design spec §7b §4.1). Optional: most callers just let it autoplay. */
  transport?: Ref<SlideTransport>;
  /** false = host-driven: no autoplay ticker; the host drives time via `transport.seek`
   *  (the timed Player). Default true. */
  autoplay?: boolean;
  /** Flattened entry nightlight for `beat`, supplied by a host that swaps `beat` on a mounted
   *  stage. Re-applied on every beat change (including backward seeks), and — host-driven only —
   *  on a backward seek WITHIN the beat (via the runtime's resolveEntryNight). */
  entryNight?: number;
}) {
  const art = useRef<ArtStageHandle>(null);
  const notes = useRef<NoteFieldHandle>(null);
  const objStage = useRef<ObjectStageHandle>(null);
  const [night, setNight] = useState(entryNight ?? beat.nightlight ?? 0);
  // CinematicSlide only issues nightlight for `nightlight` ACTIONS, never the beat's inherited
  // entry value. A host that swaps `beat` on a mounted stage (the timed Player) passes the
  // flattened entry nightlight here, and it must be re-applied on every beat change — including
  // a backward seek into an earlier beat. Applied DURING RENDER (React's "adjust state when a
  // prop changes" pattern), not in an effect: CinematicSlide's child layout effect runs
  // renderAt(0) before any parent effect, and a t=0 `nightlight` action it issues must be the
  // LAST write, so the inherited entry value has to land before the child's effects run.
  const entryKey = `${sceneId}\u0000${beat.id}\u0000${entryNight ?? ""}`;
  const [appliedEntryKey, setAppliedEntryKey] = useState(entryKey);
  if (appliedEntryKey !== entryKey) {
    setAppliedEntryKey(entryKey);
    if (entryNight != null) setNight(entryNight);
  }

  const runtime = useMemo(
    () => makeAuthoringRuntime({
      art, setNight,
      resolveEntry: () => entryLayers,
      resolveEnd: () => endLayers,
      resolveEntryNight: () => entryNight,
      onGate: () => {}, onWaiting: () => {},
    }),
    [entryLayers, endLayers, entryNight],
  );

  // The one clock (design spec §7b Task 10): CinematicSlide is the sole thing that ever
  // advances time — play()'s ticker, seek(), and the static end-state path all funnel through
  // its renderAt, which fires onTime with the exact beat-local `t` it just painted. Painting the
  // sibling stages FROM that callback (rather than polling, or running a second ticker here) is
  // what keeps notes/objects paused/playing/seeked in lockstep with text, including across a
  // click_gate pause — a second time source is the exact desync this replaces.
  const paint = useCallback((t: number) => {
    if (!scene) return; // ObjectStage/NoteField are only meaningful with a scene to read from
    objStage.current?.renderAt(scene, beatIndex, t);
    notes.current?.renderAt(scene, beatIndex, t);
  }, [scene, beatIndex]);

  return (
    <div data-testid="beatstage" style={{ position: contained ? "absolute" : "fixed", inset: 0, containerType: "size", background: "var(--color-mm-dark-brown)" }}>
      <ArtStage ref={art} nightlight={night} reduced={false} transparentBg />
      <NoteField ref={notes} reduced={false} />
      {/* ObjectStage/NoteField must mount (and attach their imperative refs) BEFORE
          CinematicSlide's own layout effect runs — that effect can call onTime synchronously
          (the static-mode end-state path), and React runs sibling layout effects in tree order.
          NoteField already precedes CinematicSlide above; ObjectStage is placed here, ahead of
          the CinematicSlide wrapper, for the same reason. z-index is explicit on both
          (.notefield: 2, .ed__objstage: 6) and the CinematicSlide wrapper below sets none, so
          this ordering has no effect on paint/stacking — only on effect timing. */}
      {scene && <ObjectStage ref={objStage} scene={scene} active />}
      <div style={{ position: "absolute", inset: 0 }}>
        <CinematicSlide slots={{ sceneId, beat }} animate={animate} runtime={runtime} chrome={chrome} transport={transport} onTime={paint} autoplay={autoplay} />
      </div>
    </div>
  );
}
