"use client";
import type { RefObject } from "react";
import { useEditor } from "@/lib/editor/store";
import type { CanvasHandle } from "./DeckCanvas";
import { actionDuration } from "@/engine/authoring/seek";

export function Timeline({ canvasRef, time }: { canvasRef: RefObject<CanvasHandle | null>; time: { t: number; duration: number } }) {
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const timeline = beats[selected]?.beat.timeline ?? [];
  return (
    <div className="ed__timeline" data-testid="timeline">
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button onClick={() => canvasRef.current?.play()}>&#9654; Play</button>
        <button onClick={() => canvasRef.current?.pause()}>&#9646;&#9646; Pause</button>
        <span style={{ opacity: 0.6, alignSelf: "center" }}>{time.t.toFixed(2)}s / {time.duration.toFixed(2)}s</span>
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
        {timeline.map((a, i) => (
          <span key={i} style={{ padding: "2px 8px", borderRadius: 4, background: "rgba(255,255,255,0.1)", fontSize: 12, fontFamily: "var(--font-body)" }}>
            {a.kind}{a.kind === "text" ? `:${a.in}` : ""}{a.kind === "wait" ? ` ${a.ms}ms` : ""} <span style={{ opacity: 0.5 }}>({actionDuration(a).toFixed(1)}s)</span>
          </span>
        ))}
        {!timeline.length && <span style={{ opacity: 0.5 }}>empty beat</span>}
      </div>
      <input type="range" min={0} max={time.duration || 0} step={0.01} value={time.t}
        onChange={(e) => canvasRef.current?.seek(parseFloat(e.target.value))} style={{ width: "100%" }} data-testid="scrub" />
    </div>
  );
}
