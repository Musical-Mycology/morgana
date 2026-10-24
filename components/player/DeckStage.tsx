"use client";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DeckDoc } from "@/engine/deck-doc";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { flattenStory } from "@/engine/deck/flatten";
import { deckLayout, locate, type DeckLayout, type Located } from "@/engine/authoring/deck-clock";
import { artAt, artEvents, nightAt, nightEvents } from "@/engine/authoring/art-clock";
import { cameraAt, cameraEvents, cameraTransform } from "@/engine/authoring/camera-clock";
import { fadeAt, fadeEvents } from "@/engine/authoring/fade-clock";
import { paintFadeOverlay } from "@/engine/components/fade-overlay";
import type { ClipMode } from "@/engine/components/video-sync";
import type { Framing } from "@/engine/deck/types";

/** The imperative face of a deck stage (the render page drives frames through it). */
export interface DeckStageHandle { apply(T: number): void; total: number; current(): number }

/** The current beat's UNCLAMPED elapsed time at deck time T (T − scene start − beat start). It
 *  equals `loc.localT` while the beat plays; in a pinned scene's hold, where locate() clamps
 *  localT at the beat's end, it keeps running, so media tile clips keep playing like art layers. */
function beatClipClock(layout: DeckLayout, loc: Located, T: number): number {
  const scene = layout.scenes[loc.sceneIdx];
  const beat = loc.beatIdx != null ? scene?.beats[loc.beatIdx] : undefined;
  return scene && beat ? T - scene.start - beat.start : loc.localT;
}

/** One mounted BeatStage for the whole deck. Memoised on the beat so the per-frame clock
 *  re-render never re-renders the stage; only a beat change does. Its own ArtStage is not
 *  mounted (`art={false}`): the deck stage owns the one ArtStage. */
const Stage = memo(function Stage({ doc, flatIdx, transport, clipModeRef, cameraRef }: { doc: DeckDoc; flatIdx: number; transport: React.RefObject<SlideTransport | null>; clipModeRef: React.RefObject<ClipMode>; cameraRef?: React.RefObject<Framing> }) {
  const slides = useMemo(() => flattenStory(doc.scenes), [doc]);
  const slide = slides[flatIdx];
  if (!slide || slide.layout !== "cinematic") return null;
  const scene = doc.scenes.find((s) => s.id === slide.slots.sceneId)!;
  const beatIndex = scene.beats.indexOf(slide.slots.beat);
  return (
    <BeatStage
      sceneId={slide.slots.sceneId} beat={slide.slots.beat} scene={scene} beatIndex={beatIndex}
      chrome={doc.meta.chrome} autoplay={false} art={false} transport={transport} clipModeRef={clipModeRef} cameraRef={cameraRef} contained
    />
  );
});

/** The deck's picture as a pure function of deck time T: the current beat (seeked to its
 *  localT) over one persistent ArtStage painted from art-clock. `apply` is the ONLY writer of T,
 *  so a frame reached by jumping equals the same frame reached by stepping. */
export function useDeckStage(doc: DeckDoc, initialT: number): {
  apply: (to: number) => void;
  T: React.MutableRefObject<number>;
  displayT: number; loc: Located | null; layout: DeckLayout;
  stage: React.ReactNode;
  /** How clips follow deck time: "play" (native playback, drift-corrected) while a host plays;
   *  "seek" (exact, awaitable) otherwise. TimedPlayer flips it; RenderStage leaves "seek". A ref,
   *  read at paint time, so a mode change never re-renders the memoised Stage. */
  clipMode: React.MutableRefObject<ClipMode>;
  /** The camera framing at T, set by `apply` (and on mount) before anything paints. Every world
   *  layer reads it at its own paint time: the ArtStage world here, tiles and notes/objects in
   *  the beat. A ref, so a framing change never re-renders the memoised Stage. */
  cameraRef: React.MutableRefObject<Framing>;
} {
  const layout = useMemo(() => deckLayout(doc), [doc]);
  const artEv = useMemo(() => artEvents(doc), [doc]);
  const nightTl = useMemo(() => nightEvents(doc), [doc]);
  const camEv = useMemo(() => cameraEvents(doc), [doc]);
  const fadeEv = useMemo(() => fadeEvents(doc), [doc]);
  const transport = useRef<SlideTransport>(null);
  const artRef = useRef<ArtStageHandle>(null);
  const T = useRef(Math.max(0, Math.min(layout.total, initialT)));
  const clipMode = useRef<ClipMode>("seek");
  const cameraRef = useRef<Framing>(cameraAt(camEv, T.current));
  const [displayT, setDisplayT] = useState(T.current);
  const [loc, setLoc] = useState<Located | null>(() => locate(layout, T.current));
  const locRef = useRef(loc);
  // ArtStage derives its filter + glow inline from this prop, so it must stay CONSTANT: a changing
  // prop makes React rewrite those styles and clobber what renderState painted. Night is painted
  // only through renderState (end of apply, and the layout effect below).
  const initialNight = useMemo(() => nightAt(nightTl, T.current), [nightTl]);

  const paintArt = useCallback(() => {
    artRef.current?.renderState(artAt(artEv, T.current), nightAt(nightTl, T.current), T.current, clipMode.current);
  }, [artEv, nightTl]);

  const fadeEl = useRef<HTMLDivElement>(null);
  const lastFade = useRef("");
  /** Paint the screen fade at T (spec §4): one overlay above text, outside every camera world. */
  const paintFade = useCallback(() => {
    if (fadeEl.current) lastFade.current = paintFadeOverlay(fadeEl.current, fadeAt(fadeEv, T.current), lastFade.current);
  }, [fadeEv]);

  /** Set the framing at T and paint the ArtStage world (written only when the string changes).
   *  The beat's own world layers pick cameraRef up in their paint, which the seek triggers. */
  const paintCamera = useCallback(() => {
    cameraRef.current = cameraAt(camEv, T.current);
    artRef.current?.setCamera(cameraTransform(cameraRef.current));
  }, [camEv]);

  /** Move the deck clock to `to` and paint. A beat change re-renders <Stage>; the seek for the
   *  new beat happens in the layout effect below so the first painted frame is already at localT.
   *  Art + nightlight are painted here, from art-clock, for every T; the camera framing is set
   *  before the seek so the beat's paint reads the new framing. */
  const apply = useCallback((to: number) => {
    T.current = Math.max(0, Math.min(layout.total, to));
    paintCamera();
    const next = locate(layout, T.current);
    const prev = locRef.current;
    locRef.current = next;
    if (next?.flatIdx !== prev?.flatIdx || next?.phase !== prev?.phase || next?.sceneIdx !== prev?.sceneIdx) setLoc(next);
    else if (next && next.flatIdx != null) transport.current?.seek(next.localT, beatClipClock(layout, next, T.current));
    setDisplayT(T.current);
    paintArt();
    paintFade();
  }, [layout, paintArt, paintCamera, paintFade]);

  // Mount (and a new doc): set + paint the framing at the current T. Declared before the seek
  // effect below so a doc change re-seeks the beat with the new framing already in the ref.
  useLayoutEffect(() => { paintCamera(); }, [paintCamera]);

  // Children's layout effects (CinematicSlide's beat setup) run before this one, so the seek
  // lands on the freshly-mounted beat before the browser paints.
  useLayoutEffect(() => {
    if (loc && loc.flatIdx != null) {
      const cur = locRef.current ?? loc;
      transport.current?.seek(cur.localT, beatClipClock(layout, cur, T.current));
    }
  }, [loc, layout]);

  // Mount (and a new doc): paint art + nightlight at the current T before the first frame shows.
  useLayoutEffect(() => { paintArt(); }, [paintArt]);
  useLayoutEffect(() => { paintFade(); }, [paintFade]);

  const hasCamera = camEv.length > 0;
  const stage = (
    // overflow: hidden: zoomed world layers (tiles, notes, objects) never spill outside the frame.
    // data-camera: a static per-deck flag (the deck has camera events). Chromium keeps the raster
    // scale of a `will-change: transform` layer, so under a zooming world an art layer or note
    // sprite rastered at one zoom kept that resolution at the next, and a frame's pixels depended on
    // how the render got there. Camera decks drop those hints; camera-less decks are unchanged.
    <div data-camera={hasCamera ? "1" : undefined} style={{ position: "absolute", inset: 0, overflow: "hidden", background: "var(--color-mm-dark-brown)" }}>
      {/* !important: a note sprite's will-change is an inline style (makeNoteHex). */}
      {hasCamera && <style>{`[data-camera] .artstage__layer, [data-camera] .notefield__stage > * { will-change: auto !important; }`}</style>}
      <ArtStage ref={artRef} nightlight={initialNight} reduced={false} transparentBg />
      {loc && loc.flatIdx != null && <Stage doc={doc} flatIdx={loc.flatIdx} transport={transport} clipModeRef={clipMode} cameraRef={cameraRef} />}
      {/* The screen fade (sub-project 6): the LAST child, above text and outside every camera world. No
          display/opacity in this style prop: paintFadeOverlay owns them (React never rewrites them). */}
      <div className="deck__fade" ref={fadeEl} aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 50 }} />
    </div>
  );
  return { apply, T, displayT, loc, layout, stage, clipMode, cameraRef };
}
