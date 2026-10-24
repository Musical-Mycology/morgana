"use client";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { NoteField, type NoteFieldHandle } from "@/engine/components/NoteField";
import { renderBeatAt } from "@/engine/authoring/seek";
import { beatDuration } from "@/engine/authoring/beat-clock";
import { deckLayout } from "@/engine/authoring/deck-clock";
import { cameraAt, cameraEvents, cameraTransform } from "@/engine/authoring/camera-clock";
import { fadeAt, fadeEvents } from "@/engine/authoring/fade-clock";
import { paintFadeOverlay } from "@/engine/components/fade-overlay";
import type { Action } from "@/engine/deck/types";
import { useEditor } from "@/lib/editor/store";
import { descriptorFor } from "@/lib/editor/registry";
import { getPath } from "@/lib/editor/paths";
import { beatLocation, type FlatBeat } from "@/lib/editor/flatten-beats";
import { ObjectsLayer } from "./ObjectsLayer";
import { ObjectStage, type ObjectStageHandle } from "./ObjectStage";
import { CameraPick, effectiveZoom, type CameraPickPoint } from "./CameraPick";

/** The editor previews a screen fade at most this strong so the beat stays editable (spec §4). */
export const CANVAS_FADE_CAP = 0.5;

export interface CanvasHandle { seek: (t: number) => void; play: () => void; pause: () => void; }

export const DeckCanvas = forwardRef<CanvasHandle, { flat: FlatBeat | null; onTime?: (t: number, duration: number) => void }>(
  function DeckCanvas({ flat, onTime }, ref) {
    const host = useRef<HTMLDivElement>(null);
    const art = useRef<ArtStageHandle>(null);
    const textHost = useRef<HTMLDivElement>(null);
    const objStage = useRef<ObjectStageHandle>(null);
    const notes = useRef<NoteFieldHandle>(null);
    const notesWorld = useRef<HTMLDivElement>(null);
    const fadeEl = useRef<HTMLDivElement>(null);
    const lastFade = useRef("");
    const lastCamera = useRef("none"); // last transform written to the notes world ("none" = never written)
    const t = useRef(0);
    const raf = useRef<number | null>(null);
    const [night, setNight] = useState(0.6);
    const [preview, setPreview] = useState(false);
    const doc = useEditor((s) => s.doc);
    const selected = useEditor((s) => s.selected);
    const loc = doc ? beatLocation(doc, selected) : null;
    const scene = loc && doc ? doc.scenes[loc.sceneIdx] : null;
    const beatIndex = loc ? loc.beatIdx : 0;
    // Camera preview (spec §4): the deck-time framing at this beat's deck start + local t, on the art
    // and note worlds only. While picking, the full frame, so the pick rect reads against the stage.
    const selectedAction = useEditor((s) => s.selectedAction);
    const cameraPick = useEditor((s) => s.cameraPick);
    const pickAction = cameraPick && selectedAction != null && flat ? flat.beat.timeline[selectedAction] : undefined;
    const picking = pickAction?.kind === "camera";
    const sceneIdx = loc?.sceneIdx ?? -1;
    const camEvents = useMemo(() => (doc ? cameraEvents(doc) : []), [doc]);
    const beatStart = useMemo(() => {
      const span = doc && sceneIdx >= 0 ? deckLayout(doc).scenes[sceneIdx] : undefined;
      const b = span?.beats[beatIndex];
      return span && b ? span.start + b.start : 0;
    }, [doc, sceneIdx, beatIndex]);
    // draw() reads the camera inputs through a ref refreshed every render: play()'s rAF loop closes
    // over the draw from the render that started it, and must still see a pick or a doc edit.
    const fadeEv = useMemo(() => (doc ? fadeEvents(doc) : []), [doc]);
    const cam = useRef({ picking, camEvents, beatStart, fadeEv });
    useLayoutEffect(() => { cam.current = { picking, camEvents, beatStart, fadeEv }; });
    const dur = () => (flat ? beatDuration(flat.beat.timeline) : 0);
    const draw = () => {
      const c = cam.current;
      const tf = c.picking ? "none" : cameraTransform(cameraAt(c.camEvents, c.beatStart + t.current));
      if (tf !== lastCamera.current && notesWorld.current) { lastCamera.current = tf; notesWorld.current.style.transform = tf; }
      art.current?.setCamera(tf);
      if (fadeEl.current) lastFade.current = paintFadeOverlay(fadeEl.current, fadeAt(c.fadeEv, c.beatStart + t.current), lastFade.current, CANVAS_FADE_CAP);
      if (textHost.current && flat) renderBeatAt(flat.beat.timeline, t.current, { textHost: textHost.current, art: art.current, setNight, entryArt: flat.beat.art });
      if (scene) objStage.current?.renderAt(scene, beatIndex, t.current);
      if (scene) notes.current?.renderAt(scene, beatIndex, t.current);
    };
    const cancel = () => { if (raf.current != null) cancelAnimationFrame(raf.current); raf.current = null; };

    useImperativeHandle(ref, () => ({
      seek: (to) => { cancel(); t.current = Math.max(0, Math.min(dur(), to)); setPreview(t.current > 0); draw(); onTime?.(t.current, dur()); },
      pause: () => cancel(),
      play: () => {
        cancel(); setPreview(true);
        let last = performance.now();
        const step = (now: number) => {
          t.current = Math.min(dur(), t.current + (now - last) / 1000); last = now;
          draw(); onTime?.(t.current, dur());
          if (t.current < dur()) raf.current = requestAnimationFrame(step); else raf.current = null;
        };
        raf.current = requestAnimationFrame(step);
      },
    }), [flat, onTime]);

    useEffect(() => { cancel(); t.current = 0; setPreview(false); draw(); onTime?.(0, dur()); return cancel; }, [flat]);
    useEffect(() => { draw(); }, [scene, beatIndex, camEvents, beatStart, fadeEv]);
    // Picking pauses canvas playback: the pick reads against a still, full-frame stage.
    useEffect(() => { if (picking) cancel(); draw(); }, [picking]);

    return (
      // Exactly 16:9 in any pane shape: the width is the smaller of the parent's width and the pane's
      // height x 16/9 (the editor's .ed__canvas is a size container; with none, cqh is the viewport
      // height), and the height follows from aspect-ratio. (A 100% width with a max-height cap went
      // wider than 16:9 in a short pane, so picks landed off.)
      <div ref={host} className="ed__canvas-host" style={{ position: "relative", flex: "none", width: "min(100%, 100cqh * 16 / 9)", aspectRatio: "16 / 9", margin: "auto", containerType: "size", overflow: "hidden", background: "var(--color-mm-dark-brown)", boxShadow: "0 4px 24px rgba(0,0,0,0.4)" }}>
        {/* clipPlayback off: the editor paints through seek.ts (no deck clock), so a clip shows its
            in-point frame, paused (spec §4 "Editor canvas", §6). */}
        <ArtStage ref={art} nightlight={night} reduced={false} transparentBg clipPlayback={false} />
        {/* The camera's note world, as in BeatStage: carries NoteField's own z (2), display-only. The
            editor ObjectStage below stays unwrapped at full frame — its drag/resize handles' pointer
            math assumes an untransformed stage (spec §4). */}
        <div className="beat__world" ref={notesWorld} style={{ position: "absolute", inset: 0, transformOrigin: "0 0", pointerEvents: "none", zIndex: 2 }}>
          <NoteField ref={notes} reduced={false} />
        </div>
        {/* CinematicSlide's own `.cin` rule (position:relative) + `.cin__stage` (z-index:2) never apply here —
            CinematicSlide isn't mounted on this route, so this wrapper is otherwise static and paints BELOW
            NoteField's positioned z-index:2 regardless of DOM order. Pin it explicitly above notes (z-index:2)
            and below PosHandle (5) / ObjectStage (6), matching BeatStage's effective art -> notes -> text -> objects order. */}
        {/* Display-only caption layer: renderBeatAt only ever paints text nodes here, nothing
            interactive. Every sibling layer in this stack states its pointer-events intent
            explicitly (NoteField, ObjectStage, ObjectsLayer, PosHandle) — match that convention
            so this box doesn't silently swallow clicks meant for a future lower layer. */}
        <div className="cin" style={{ position: "absolute", inset: 0, zIndex: 3, pointerEvents: "none" }}><div className="cin__stage"><div ref={textHost} className="cin__text" style={{ position: "absolute", inset: 0, maxWidth: "none" }} data-testid="canvas-text" /></div></div>
        {/* Screen fade preview, capped at 50% so the beat stays editable (spec §4). z 4: over art, notes and
            text; under the pos handle (5) and objects (6). */}
        <div className="deck__fade" ref={fadeEl} aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 4 }} />
        <ObjectStage ref={objStage} scene={scene ?? { id: "", beats: [] }} active={preview} />
        <PosHandle hostRef={host} redraw={draw} />
        {!preview && <ObjectsLayer hostRef={host} />}
        {picking && <PickLayer action={pickAction} zoom={effectiveZoom(flat!.beat.timeline, selectedAction!, beatStart, camEvents)} />}
      </div>
    );
  },
);

/** Draggable position handle for the selected pos-bearing action. Its own pointer-events layer. */
function PosHandle({ hostRef, redraw }: { hostRef: React.RefObject<HTMLDivElement | null>; redraw: () => void }) {
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const selectedAction = useEditor((s) => s.selectedAction);
  const updateAction = useEditor((s) => s.updateAction);
  const action = selectedAction != null ? beats[selected]?.beat.timeline[selectedAction] : undefined;
  const hasPos = !!action && descriptorFor(action).schema.some((f) => f.key === "pos.x");
  if (!action || !hasPos) return null;

  const pos = (getPath(action, "pos") as { x: number; y: number } | undefined) ?? { x: 0.1, y: 0.2 };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
      updateAction(selected, selectedAction!, "pos", { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) });
      redraw();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5 }}>
      <button
        data-testid="pos-handle"
        onPointerDown={onPointerDown}
        style={{
          position: "absolute", left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, transform: "translate(-50%, -50%)",
          width: 18, height: 18, borderRadius: "50%", border: "2px solid var(--ed-accent)", background: "rgba(212,168,67,0.35)",
          cursor: "grab", pointerEvents: "auto", padding: 0,
        }}
      />
    </div>
  );
}

/** Pick on canvas for the selected camera action: one click writes `to` whole ({...to, x, y}) — one
 *  undo step — and leaves pick mode; Esc just leaves it. `zoom` is the action's effective zoom. */
function PickLayer({ action, zoom }: { action: Extract<Action, { kind: "camera" }>; zoom: number }) {
  const selected = useEditor((s) => s.selected);
  const selectedAction = useEditor((s) => s.selectedAction);
  const updateAction = useEditor((s) => s.updateAction);
  const setCameraPick = useEditor((s) => s.setCameraPick);
  const to = action.to ?? {};
  const onPick = (p: CameraPickPoint) => {
    // A pick that lands on the current centre writes nothing (no undo entry).
    if (selectedAction != null && (p.x !== to.x || p.y !== to.y)) updateAction(selected, selectedAction, "to", { ...to, x: p.x, y: p.y });
    setCameraPick(false);
  };
  // A `to` without zoom keeps the zoom in effect: frame the pick rect at that (effectiveZoom).
  return <CameraPick zoom={zoom} at={to} onPick={onPick} onCancel={() => setCameraPick(false)} />;
}
