"use client";
import type { RefObject } from "react";
import { useEditor } from "@/lib/editor/store";
import type { CanvasHandle } from "./DeckCanvas";
import { actionDuration } from "@/engine/authoring/seek";
import { REGISTRY } from "@/lib/editor/registry";

const ADD_KIND_OPTIONS = Object.values(REGISTRY).map((d) => ({ value: d.kind, label: d.label }));

export function Timeline({ canvasRef, time }: { canvasRef: RefObject<CanvasHandle | null>; time: { t: number; duration: number } }) {
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const selectedAction = useEditor((s) => s.selectedAction);
  const selectAction = useEditor((s) => s.selectAction);
  const addAction = useEditor((s) => s.addAction);
  const duplicateAction = useEditor((s) => s.duplicateAction);
  const deleteAction = useEditor((s) => s.deleteAction);
  const moveAction = useEditor((s) => s.moveAction);
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
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        {timeline.map((a, i) => (
          <span key={i} style={{ display: "flex", alignItems: "center" }}>
            <button className="ed__chip" onClick={() => selectAction(i)} aria-current={i === selectedAction ? "true" : undefined}>
              {a.kind}{a.kind === "text" ? `:${a.in}` : ""}{a.kind === "wait" ? ` ${a.ms}ms` : ""}{" "}
              <span style={{ color: "var(--ed-fg-muted)" }}>({actionDuration(a).toFixed(1)}s)</span>
            </button>
            {i === selectedAction && (
              <span style={{ display: "flex", gap: 2, paddingLeft: 2 }}>
                <button className="ed__icon" title="Move up" data-testid="action-up" onClick={() => moveAction(selected, i, -1)}>↑</button>
                <button className="ed__icon" title="Move down" data-testid="action-down" onClick={() => moveAction(selected, i, 1)}>↓</button>
                <button className="ed__icon" title="Duplicate" data-testid="action-dupe" onClick={() => duplicateAction(selected, i)}>⧉</button>
                <button className="ed__icon" title="Delete" data-testid="action-delete" onClick={() => deleteAction(selected, i)}>✕</button>
              </span>
            )}
          </span>
        ))}
        {!timeline.length && <span style={{ color: "var(--ed-fg-muted)" }}>empty beat</span>}
        <select
          data-testid="action-add"
          value=""
          onChange={(e) => { if (e.target.value) addAction(selected, selectedAction, e.target.value); }}
          style={{ fontSize: 12 }}
        >
          <option value="">＋ Add action…</option>
          {ADD_KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <input type="range" min={0} max={time.duration || 0} step={0.01} value={time.t}
        onChange={(e) => canvasRef.current?.seek(parseFloat(e.target.value))} style={{ width: "100%" }} data-testid="scrub" />
    </div>
  );
}
