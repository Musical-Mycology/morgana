"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArtStage, type ArtStageHandle } from "@/engine/components/ArtStage";
import { beatDuration, renderBeatAt } from "@/engine/authoring/seek";
import type { FlatBeat } from "@/lib/editor/flatten-beats";

export interface CanvasHandle { seek: (t: number) => void; play: () => void; pause: () => void; }

export const DeckCanvas = forwardRef<CanvasHandle, { flat: FlatBeat | null; onTime?: (t: number, duration: number) => void }>(
  function DeckCanvas({ flat, onTime }, ref) {
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
      <div className="ed__canvas-host" style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", maxHeight: "100%", margin: "auto", containerType: "size", overflow: "hidden", background: "var(--color-mm-dark-brown)", boxShadow: "0 4px 24px rgba(0,0,0,0.4)" }}>
        <ArtStage ref={art} nightlight={night} reduced={false} transparentBg />
        <div className="cin"><div className="cin__stage"><div ref={textHost} className="cin__text" data-testid="canvas-text" /></div></div>
      </div>
    );
  },
);
