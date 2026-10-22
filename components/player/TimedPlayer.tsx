"use client";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DeckDoc } from "@/engine/deck-doc";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import { flattenStory, resolveBeatArt, resolveEntryArt } from "@/engine/deck/flatten";
import { deckLayout, locate, type Located } from "@/engine/authoring/deck-clock";
import { formatClock } from "@/lib/timing/clock-format";
import { TimeBar } from "@/components/timing/TimeBar";

const HUD_IDLE_MS = 2000;

/** One mounted BeatStage for the whole deck. Memoised on the beat so the per-frame clock
 *  re-render never re-renders the stage; only a beat change does. */
const Stage = memo(function Stage({ doc, flatIdx, transport }: { doc: DeckDoc; flatIdx: number; transport: React.RefObject<SlideTransport | null> }) {
  const slides = useMemo(() => flattenStory(doc.scenes), [doc]);
  const slide = slides[flatIdx];
  const entryLayers = useMemo(() => resolveEntryArt(slides, flatIdx).layers, [slides, flatIdx]);
  const endLayers = useMemo(() => resolveBeatArt(slides, flatIdx).layers, [slides, flatIdx]);
  if (!slide || slide.layout !== "cinematic") return null;
  const scene = doc.scenes.find((s) => s.id === slide.slots.sceneId)!;
  const beatIndex = scene.beats.indexOf(slide.slots.beat);
  return (
    <BeatStage
      sceneId={slide.slots.sceneId} beat={slide.slots.beat} scene={scene} beatIndex={beatIndex}
      entryLayers={entryLayers} endLayers={endLayers} entryNight={slide.nightlight}
      chrome={doc.meta.chrome} autoplay={false} transport={transport} contained
    />
  );
});

export function TimedPlayer({ doc, initialT = 0 }: { doc: DeckDoc; initialT?: number }) {
  const layout = useMemo(() => deckLayout(doc), [doc]);
  const target = doc.meta.timing?.targetSec;
  const transport = useRef<SlideTransport>(null);
  const T = useRef(Math.max(0, Math.min(layout.total, initialT)));
  const [displayT, setDisplayT] = useState(T.current);
  const [loc, setLoc] = useState<Located | null>(() => locate(layout, T.current));
  const locRef = useRef(loc);
  const [playing, setPlaying] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [hudPinned, setHudPinned] = useState(true); // H toggles; when false the HUD stays hidden
  const idle = useRef<number | null>(null);

  /** Move the deck clock to `to` and paint. A beat change re-renders <Stage>; the seek for the
   *  new beat happens in the layout effect below so the first painted frame is already at localT. */
  const apply = useCallback((to: number) => {
    T.current = Math.max(0, Math.min(layout.total, to));
    const next = locate(layout, T.current);
    const prev = locRef.current;
    locRef.current = next;
    if (next?.flatIdx !== prev?.flatIdx || next?.phase !== prev?.phase) setLoc(next);
    else if (next && next.flatIdx != null) transport.current?.seek(next.localT);
    setDisplayT(T.current);
  }, [layout]);

  // Children's layout effects (CinematicSlide's beat setup) run before this one, so the seek
  // lands on the freshly-mounted beat before the browser paints.
  useLayoutEffect(() => {
    if (loc && loc.flatIdx != null) transport.current?.seek(locRef.current?.localT ?? loc.localT);
  }, [loc]);

  // The one clock: a single rAF loop while playing.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let id = requestAnimationFrame(function step(now) {
      apply(T.current + (now - last) / 1000);
      last = now;
      if (T.current >= layout.total) { setPlaying(false); return; }
      id = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(id);
  }, [playing, apply, layout.total]);

  // A hidden tab pauses rather than jumping ahead when it comes back.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState !== "visible") setPlaying(false); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const step = e.shiftKey ? 5 : 1;
      switch (e.key) {
        case " ": e.preventDefault(); if (T.current >= layout.total) { apply(0); setPlaying(true); } else setPlaying((p) => !p); break;
        case "ArrowRight": e.preventDefault(); apply(T.current + step); break;
        case "ArrowLeft": e.preventDefault(); apply(T.current - step); break;
        case "Home": e.preventDefault(); apply(0); break;
        case "f": case "F": void document.documentElement.requestFullscreen?.(); break;
        case "h": case "H": setHudPinned((v) => !v); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apply, layout.total]);

  // HUD: always visible while paused; fades 2s after the last pointer move while playing.
  const wake = () => {
    setHudVisible(true);
    if (idle.current != null) clearTimeout(idle.current);
    idle.current = window.setTimeout(() => setHudVisible(false), HUD_IDLE_MS);
  };
  useEffect(() => { if (!playing) setHudVisible(true); else wake(); }, [playing]);

  if (layout.total <= 0) {
    return <div className="play play--empty" data-testid="play-empty">Nothing to play — add beats or pin a scene length.</div>;
  }

  const over = target !== undefined && displayT > target;
  const sceneId = loc ? doc.scenes[loc.sceneIdx].id : "";
  return (
    <div className="play" onPointerMove={wake}>
      <div className="play__frame" data-testid="play-stage">
        {loc && loc.flatIdx != null && <Stage doc={doc} flatIdx={loc.flatIdx} transport={transport} />}
      </div>
      {hudPinned && (
        <div className={`play__hud${hudVisible ? "" : " play__hud--hidden"}`} data-testid="play-hud">
          <button className="play__btn" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
          <span className="play__clock" data-testid="play-clock" data-over={over ? "true" : undefined}>
            {formatClock(displayT)} / {formatClock(target ?? layout.total, { tenths: false })}
          </span>
          <span className="play__scene" data-testid="play-scene">{sceneId}</span>
          <div className="play__bar">
            <TimeBar layout={layout} sceneIds={doc.scenes.map((s) => s.id)} value={displayT} targetSec={target}
              onScrub={(to) => { setPlaying(false); apply(to); }} testId="play-scrub" />
          </div>
        </div>
      )}
    </div>
  );
}
