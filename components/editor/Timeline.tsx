"use client";
import type { RefObject } from "react";
import { useEditor } from "@/lib/editor/store";
import type { CanvasHandle } from "./DeckCanvas";
import { actionDuration } from "@/engine/authoring/seek";

export function Timeline({ canvasRef, time }: { canvasRef: RefObject<CanvasHandle | null>; time: { t: number; duration: number } }) {
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const selectedAction = useEditor((s) => s.selectedAction);
  const selectAction = useEditor((s) => s.selectAction);
  const timeline = beats[selected]?.beat.timeline ?? [];
  return (
    <div className="ed__timeline" data-testid="timeline">
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <button className="ed__pill ed__pill--ghost" onClick={() => canvasRef.current?.play()}>&#9654; Play</button>
        <button className="ed__pill ed__pill--ghost" onClick={() => canvasRef.current?.pause()}>&#9646;&#9646; Pause</button>
        <span style={{ fontFamily: "var(--ed-mono)", fontSize: 12, color: "var(--ed-fg-muted)", alignSelf: "center" }}>
          {time.t.toFixed(2)}s / {time.duration.toFixed(2)}s
        </span>
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
        {timeline.map((a, i) => (
          <button key={i} className="ed__chip" onClick={() => selectAction(i)} aria-current={i === selectedAction ? "true" : undefined}>
            {a.kind}{a.kind === "text" ? `:${a.in}` : ""}{a.kind === "wait" ? ` ${a.ms}ms` : ""}{" "}
            <span style={{ color: "var(--ed-fg-muted)" }}>({actionDuration(a).toFixed(1)}s)</span>
          </button>
        ))}
        {!timeline.length && <span style={{ color: "var(--ed-fg-muted)" }}>empty beat</span>}
      </div>
      <input type="range" min={0} max={time.duration || 0} step={0.01} value={time.t}
        onChange={(e) => canvasRef.current?.seek(parseFloat(e.target.value))} style={{ width: "100%" }} data-testid="scrub" />
    </div>
  );
}
