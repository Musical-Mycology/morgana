"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { beatDuration, renderBeatAt } from "@/engine/authoring/seek";
import { useEditor } from "@/lib/editor/store";
import { descriptorFor } from "@/lib/editor/registry";
import { getPath } from "@/lib/editor/paths";
import type { FlatBeat } from "@/lib/editor/flatten-beats";
import { ObjectsLayer } from "./ObjectsLayer";

export interface CanvasHandle { seek: (t: number) => void; play: () => void; pause: () => void; }

export const DeckCanvas = forwardRef<CanvasHandle, { flat: FlatBeat | null; onTime?: (t: number, duration: number) => void }>(
  function DeckCanvas({ flat, onTime }, ref) {
    const host = useRef<HTMLDivElement>(null);
    const art = useRef<ArtStageHandle>(null);
    const textHost = useRef<HTMLDivElement>(null);
    const t = useRef(0);
    const raf = useRef<number | null>(null);
    const [night, setNight] = useState(0.6);
    const dur = () => (flat ? beatDuration(flat.beat.timeline) : 0);
    const draw = () => { if (textHost.current && flat) renderBeatAt(flat.beat.timeline, t.current, { textHost: textHost.current, art: art.current, setNight }); };
    const cancel = () => { if (raf.current != null) cancelAnimationFrame(raf.current); raf.current = null; };

    useImperativeHandle(ref, () => ({
      seek: (to) => { cancel(); t.current = Math.max(0, Math.min(dur(), to)); draw(); onTime?.(t.current, dur()); },
      pause: () => cancel(),
      play: () => {
        cancel();
        let last = performance.now();
        const step = (now: number) => {
          t.current = Math.min(dur(), t.current + (now - last) / 1000); last = now;
          draw(); onTime?.(t.current, dur());
          if (t.current < dur()) raf.current = requestAnimationFrame(step); else raf.current = null;
        };
        raf.current = requestAnimationFrame(step);
      },
    }), [flat, onTime]);

    useEffect(() => { cancel(); t.current = 0; draw(); onTime?.(0, dur()); return cancel; }, [flat]);

    return (
      <div ref={host} className="ed__canvas-host" style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", maxHeight: "100%", margin: "auto", containerType: "size", overflow: "hidden", background: "var(--color-mm-dark-brown)", boxShadow: "0 4px 24px rgba(0,0,0,0.4)" }}>
        <ArtStage ref={art} nightlight={night} reduced={false} transparentBg />
        <div className="cin"><div className="cin__stage"><div ref={textHost} className="cin__text" style={{ position: "absolute", inset: 0, maxWidth: "none" }} data-testid="canvas-text" /></div></div>
        <PosHandle hostRef={host} redraw={draw} />
        <ObjectsLayer hostRef={host} />
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
