"use client";
import { useCallback, useMemo, useRef, useState, type Ref } from "react";
import type { ArtAsset, Beat, Framing, Scene } from "@/engine/deck/types";
import type { DeckChrome } from "@/engine/deck-doc";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { NoteField, type NoteFieldHandle } from "@/engine/components/NoteField";
import { beatFraming, CinematicSlide, type BeatCamera, type SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import { cameraTransform } from "./camera-clock";
import { ObjectStage, type ObjectStageHandle } from "@/components/editor/ObjectStage";
import type { ClipMode } from "@/engine/components/video-sync";
import { makeAuthoringRuntime } from "./runtime";

export function BeatStage({
  sceneId, beat, animate = true, entryLayers = [], endLayers = [], chrome, contained = false,
  scene, beatIndex = 0, transport, autoplay = true, art: withArt = true, clipModeRef, cameraRef, camera,
}: {
  sceneId: string; beat: Beat; animate?: boolean;
  entryLayers?: ArtAsset[]; endLayers?: ArtAsset[];
  chrome?: DeckChrome; contained?: boolean;
  scene?: Scene; beatIndex?: number;
  /** Imperative seek/play/pause/duration over CinematicSlide's single time axis — forwarded
   *  straight through (design spec §7b §4.1). Optional: most callers just let it autoplay. */
  transport?: Ref<SlideTransport>;
  /** false = host-driven: no autoplay ticker; the host drives time via `transport.seek`
   *  (the timed Player). The slide then issues no art/nightlight, so a host that paints art
   *  itself also passes `art={false}`. Default true. */
  autoplay?: boolean;
  /** false = don't mount this stage's own ArtStage: the host owns one (persistent across beats)
   *  and paints art + nightlight from art-clock (the timed Player). The wrapper's background is
   *  then transparent so the host's art shows through. Default true. */
  art?: boolean;
  /** The host's clip mode (play/seek) for this beat's video tiles, read at paint time — forwarded
   *  to CinematicSlide. Undefined = autoplay ("play"). */
  clipModeRef?: React.RefObject<ClipMode>;
  /** Host-driven camera: the framing at the deck time being painted, read at paint time (a ref,
   *  so a framing change never re-renders). Forwarded to CinematicSlide (media tiles) and painted
   *  here on `.beat__world` (notes + objects). Wins over `camera`. */
  cameraRef?: React.RefObject<Framing>;
  /** Autoplay camera: the deck's camera events + this beat's deck start; every world layer paints
   *  `cameraAt(events, beatStart + t)` at beat-local `t`. Ignored when `cameraRef` is set. */
  camera?: BeatCamera;
}) {
  const art = useRef<ArtStageHandle>(null);
  const notes = useRef<NoteFieldHandle>(null);
  const objStage = useRef<ObjectStageHandle>(null);
  const world = useRef<HTMLDivElement>(null);
  const lastCamera = useRef("none"); // last transform written to .beat__world ("none" = never written)
  const [night, setNight] = useState(beat.nightlight ?? 0);

  const runtime = useMemo(
    () => makeAuthoringRuntime({
      art, setNight,
      resolveEntry: () => entryLayers,
      resolveEnd: () => endLayers,
      onGate: () => {}, onWaiting: () => {},
    }),
    [entryLayers, endLayers],
  );

  // The one clock (design spec §7b Task 10): CinematicSlide is the sole thing that ever
  // advances time — play()'s ticker, seek(), and the static end-state path all funnel through
  // its renderAt, which fires onTime with the exact beat-local `t` it just painted. Painting the
  // sibling stages FROM that callback (rather than polling, or running a second ticker here) is
  // what keeps notes/objects paused/playing/seeked in lockstep with text, including across a
  // click_gate pause — a second time source is the exact desync this replaces.
  // The camera rides the same callback: `.beat__world` (and, in autoplay, this stage's own
  // ArtStage world) paint the framing at this same `t`, written only when it changes.
  const paint = useCallback((t: number) => {
    const tf = cameraTransform(beatFraming(t, cameraRef, camera));
    if (tf !== lastCamera.current && world.current) { lastCamera.current = tf; world.current.style.transform = tf; }
    art.current?.setCamera(tf);
    if (!scene) return; // ObjectStage/NoteField are only meaningful with a scene to read from
    objStage.current?.renderAt(scene, beatIndex, t);
    notes.current?.renderAt(scene, beatIndex, t);
  }, [scene, beatIndex, cameraRef, camera]);

  return (
    <div data-testid="beatstage" style={{ position: contained ? "absolute" : "fixed", inset: 0, containerType: "size", background: withArt ? "var(--color-mm-dark-brown)" : "transparent" }}>
      {withArt && <ArtStage ref={art} nightlight={night} reduced={false} transparentBg />}
      {/* The camera's world for notes + objects. It sets no z-index and, at full frame, no
          transform, so it forms no stacking context: .notefield (2) and .ed__objstage (6) keep
          stacking against the text wrapper exactly as before. Display-only (objects here carry no
          drag handles), so it takes no pointer events. */}
      <div className="beat__world" ref={world} style={{ position: "absolute", inset: 0, transformOrigin: "0 0", pointerEvents: "none" }}>
        <NoteField ref={notes} reduced={false} />
        {/* ObjectStage/NoteField must mount (and attach their imperative refs) BEFORE
            CinematicSlide's own layout effect runs — that effect can call onTime synchronously
            (the static-mode end-state path), and React runs sibling layout effects in tree order.
            Both sit in this world wrapper, ahead of the CinematicSlide wrapper, for that reason.
            z-index is explicit on both (.notefield: 2, .ed__objstage: 6) and neither this wrapper
            nor the CinematicSlide wrapper below sets one, so this ordering has no effect on
            paint/stacking — only on effect timing. */}
        {scene && <ObjectStage ref={objStage} scene={scene} active />}
      </div>
      <div style={{ position: "absolute", inset: 0 }}>
        <CinematicSlide slots={{ sceneId, beat }} animate={animate} runtime={runtime} chrome={chrome} transport={transport} onTime={paint} autoplay={autoplay} clipModeRef={clipModeRef} cameraRef={cameraRef} camera={camera} />
      </div>
    </div>
  );
}
