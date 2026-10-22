"use client";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DeckDoc } from "@/engine/deck-doc";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import { flattenStory, resolveBeatArt, resolveEntryArt } from "@/engine/deck/flatten";
import { deckLayout, locate, type Located } from "@/engine/authoring/deck-clock";
import { formatClock } from "@/lib/timing/clock-format";
import { TimeBar } from "@/components/timing/TimeBar";
import { loadSoundtrack, type Soundtrack } from "@/lib/audio/soundtrack";
import { useSoundtrack } from "@/lib/audio/use-soundtrack";

const HUD_IDLE_MS = 2000;
/** An audio clock that reads non-null but hasn't moved for this long (wall time) is treated as
 *  stalled — e.g. AudioContext.resume() never succeeded because autoplay was blocked — and the
 *  timer drives T instead. Must stay well above the ~170 ms a real context takes to start. */
const AUDIO_STALL_MS = 500;

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

export function TimedPlayer({ doc, initialT = 0, loadTrack }: { doc: DeckDoc; initialT?: number; loadTrack?: (url: string) => Promise<Soundtrack> }) {
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
  const playingRef = useRef(false);
  const sound = useSoundtrack(doc.meta.id, doc.meta.soundtrack?.media, loadTrack ?? loadSoundtrack);
  const track = sound.status === "ready" ? sound.track : null;
  const trackRef = useRef<Soundtrack | null>(null);
  const [muted, setMuted] = useState(false);
  /** Exposed as data-clock. "audio" only on a frame where the soundtrack's clock demonstrably
   *  ADVANCED (its reading is non-null, strictly greater than the previous frame's, and not stalled).
   *  A frozen reading (suspended context, the very first frame after a (re)start, or the 0.5 s grace
   *  window) reports "timer" even if T is still being held on the audio value. */
  const [clockSrc, setClockSrc] = useState<"audio" | "timer">("timer");
  /** The rAF loop's view of the audio clock: its last reading, when (rAF time) it last changed,
   *  and whether it is stalled (timer driving T). `lastT: null` = no reading since a (re)start. */
  const audioClock = useRef<{ lastT: number | null; movedAt: number; stalled: boolean }>({ lastT: null, movedAt: 0, stalled: false });

  /** Move the deck clock to `to` and paint. A beat change re-renders <Stage>; the seek for the
   *  new beat happens in the layout effect below so the first painted frame is already at localT. */
  const apply = useCallback((to: number) => {
    T.current = Math.max(0, Math.min(layout.total, to));
    const next = locate(layout, T.current);
    const prev = locRef.current;
    locRef.current = next;
    if (next?.flatIdx !== prev?.flatIdx || next?.phase !== prev?.phase || next?.sceneIdx !== prev?.sceneIdx) setLoc(next);
    else if (next && next.flatIdx != null) transport.current?.seek(next.localT);
    setDisplayT(T.current);
  }, [layout]);

  /** A seek: move T, and while playing restart the soundtrack there so sound and picture agree. */
  const seekTo = useCallback((to: number) => {
    apply(to);
    if (playingRef.current && trackRef.current) {
      trackRef.current.play(T.current);
      audioClock.current.lastT = null; // the jump is ours, not the audio clock moving on its own
    }
  }, [apply]);

  /** Play/pause; at the very end it restarts from 0 (shared by Space and the HUD button). */
  const togglePlay = useCallback(() => {
    if (T.current >= layout.total) { seekTo(0); setPlaying(true); } else setPlaying((p) => !p);
  }, [seekTo, layout.total]);

  useEffect(() => { trackRef.current = track; }, [track]);
  useEffect(() => () => trackRef.current?.pause(), []);
  useEffect(() => { track?.setMuted(muted); }, [track, muted]);
  // The soundtrack's transport follows `playing` — which also lets a track that finishes
  // decoding mid-play join at the current T.
  useEffect(() => {
    if (!track) return;
    audioClock.current.lastT = null;
    if (playing) track.play(T.current); else track.pause();
  }, [playing, track]);

  // Children's layout effects (CinematicSlide's beat setup) run before this one, so the seek
  // lands on the freshly-mounted beat before the browser paints.
  useLayoutEffect(() => {
    if (loc && loc.flatIdx != null) transport.current?.seek(locRef.current?.localT ?? loc.localT);
  }, [loc]);

  // The one clock: a single rAF loop while playing. While the soundtrack plays, ITS clock is
  // the deck clock; otherwise (no track, decode failed, past its end, stalled) the timer is.
  useEffect(() => {
    if (!playing) { setClockSrc("timer"); return; }
    let last = performance.now();
    let fromAudio = false; // did the soundtrack's clock advance and drive this frame's T?
    audioClock.current = { lastT: null, movedAt: 0, stalled: false };
    let id = requestAnimationFrame(function step(now) {
      // The first frame's timestamp can predate the performance.now() read above; never let
      // that step the clock (and the stage) backwards on Play.
      const timerT = T.current + Math.max(0, now - last) / 1000;
      fromAudio = false;
      apply(audioDrivenT(now, timerT) ?? timerT);
      setClockSrc(fromAudio ? "audio" : "timer");
      last = now;
      if (T.current >= layout.total) { setPlaying(false); return; }
      id = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(id);

    /** The audio clock's T for this frame, or null when the timer should drive. */
    function audioDrivenT(now: number, timerT: number): number | null {
      const tr = trackRef.current;
      const a = tr?.now() ?? null;
      const ac = audioClock.current;
      let advancedNow = false; // this frame's reading is strictly past the previous frame's
      if (a === null) { ac.lastT = null; return null; }
      if (ac.lastT === null) { ac.lastT = a; ac.movedAt = now; } // first reading since a (re)start
      else if (a !== ac.lastT) {
        advancedNow = a > ac.lastT;
        ac.lastT = a;
        ac.movedAt = now;
        if (ac.stalled) {
          // It came alive while the timer was driving: restart it at the picture's T.
          ac.stalled = false;
          ac.lastT = null;
          tr!.play(timerT);
          return timerT;
        }
      } else if (now - ac.movedAt >= AUDIO_STALL_MS) ac.stalled = true;
      if (ac.stalled) return null;
      fromAudio = advancedNow;
      return a;
    }
  }, [playing, apply, layout.total]);

  // A hidden tab pauses rather than jumping ahead when it comes back.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState !== "visible") setPlaying(false); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // A layout effect, not a passive one: the listener must exist by the time the first frame
  // paints, or a key pressed as soon as the clock shows up is silently dropped.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Modified keys belong to the browser/OS (Alt+←/→ history, Ctrl/Cmd+F find, …).
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const step = e.shiftKey ? 5 : 1;
      switch (e.key) {
        // A focused button activates itself on Space (its click handler toggles) — toggling here
        // too would cancel it out.
        case " ": if (el?.tagName === "BUTTON") break; e.preventDefault(); togglePlay(); break;
        case "ArrowRight": e.preventDefault(); seekTo(T.current + step); break;
        case "ArrowLeft": e.preventDefault(); seekTo(T.current - step); break;
        case "Home": e.preventDefault(); seekTo(0); break;
        case "f": case "F": void document.documentElement.requestFullscreen?.(); break;
        case "h": case "H": setHudPinned((v) => !v); break;
        case "m": case "M": setMuted((v) => !v); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seekTo, togglePlay]);

  // HUD: always visible while paused; fades 2s after the last pointer move while playing.
  const wake = () => {
    setHudVisible(true);
    if (idle.current != null) clearTimeout(idle.current);
    idle.current = null;
    if (playingRef.current) idle.current = window.setTimeout(() => setHudVisible(false), HUD_IDLE_MS);
  };
  useEffect(() => {
    playingRef.current = playing;
    if (!playing && idle.current != null) { clearTimeout(idle.current); idle.current = null; }
    if (!playing) setHudVisible(true); else wake();
  }, [playing]);
  useEffect(() => () => { if (idle.current != null) clearTimeout(idle.current); }, []);

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
          {/* preventDefault on mousedown: a click must not leave the button focused, so Space keeps
              reaching the window handler rather than re-activating the button. */}
          <button className="play__btn" onClick={togglePlay} onMouseDown={(e) => e.preventDefault()} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
          <span className="play__clock" data-testid="play-clock" data-clock={clockSrc} data-over={over ? "true" : undefined}>
            {formatClock(displayT)} / {formatClock(target ?? layout.total, { tenths: false })}
          </span>
          <span className="play__scene" data-testid="play-scene">{sceneId}</span>
          {sound.status === "loading" && <span className="play__audio" data-testid="play-audio-status">loading audio…</span>}
          {sound.status === "error" && <span className="play__audio play__audio--err" data-testid="play-audio-status">Soundtrack unavailable — playing silent</span>}
          {sound.status !== "none" && (
            <button className="play__btn" data-testid="play-mute" aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"}
              onMouseDown={(e) => e.preventDefault()} onClick={() => setMuted((v) => !v)}>{muted ? "🔇" : "🔊"}</button>
          )}
          <div className="play__bar">
            {/* Scrub and marker click pause first (the audio stops with them), then jump. */}
            <TimeBar layout={layout} sceneIds={doc.scenes.map((s) => s.id)} value={displayT} targetSec={target}
              onScrub={(to) => { setPlaying(false); apply(to); }} testId="play-scrub"
              peaks={track?.peaks} peaksDuration={track?.duration} markers={doc.meta.markers}
              onMarkerClick={(t) => { setPlaying(false); apply(t); }} />
          </div>
        </div>
      )}
    </div>
  );
}
