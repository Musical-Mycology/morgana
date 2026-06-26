"use client";
import type { RefObject } from "react";
import { useEditor } from "@/lib/editor/store";
import type { CanvasHandle } from "./DeckCanvas";
import { actionDuration } from "@/engine/authoring/seek";
import { ADDABLE_KINDS, newAction } from "@/lib/editor/registry";
import type { Action } from "@/engine/deck/types";

export function Timeline({ canvasRef, time }: { canvasRef: RefObject<CanvasHandle | null>; time: { t: number; duration: number } }) {
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const selectedAction = useEditor((s) => s.selectedAction);
  const selectAction = useEditor((s) => s.selectAction);
  const addAction = useEditor((s) => s.addAction);
  const deleteAction = useEditor((s) => s.deleteAction);
  const moveAction = useEditor((s) => s.moveAction);
  const duplicateAction = useEditor((s) => s.duplicateAction);
  const timeline = beats[selected]?.beat.timeline ?? [];
  const hasBeat = beats.length > 0;

  const onAdd = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const kind = e.target.value as Action["kind"];
    if (!kind) return;
    addAction(selected, selectedAction ?? timeline.length - 1, newAction(kind));
    e.target.value = "";
  };

  return (
    <div className="ed__timeline" data-testid="timeline">
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="ed__pill ed__pill--ghost" onClick={() => canvasRef.current?.play()}>&#9654; Play</button>
        <button className="ed__pill ed__pill--ghost" onClick={() => canvasRef.current?.pause()}>&#9646;&#9646; Pause</button>
        <span style={{ fontFamily: "var(--ed-mono)", fontSize: 12, color: "var(--ed-fg-muted)", alignSelf: "center" }}>
          {time.t.toFixed(2)}s / {time.duration.toFixed(2)}s
        </span>
        <select className="ed__pill ed__pill--ghost" data-testid="action-add" defaultValue="" onChange={onAdd} disabled={!hasBeat} style={{ marginLeft: "auto" }}>
          <option value="">＋ Add action…</option>
          {ADDABLE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
        {selectedAction != null && (
          <span style={{ display: "flex", gap: 2 }}>
            <button className="ed__icon" title="Move left" data-testid="action-left" onClick={() => moveAction(selected, selectedAction, -1)}>←</button>
            <button className="ed__icon" title="Move right" data-testid="action-right" onClick={() => moveAction(selected, selectedAction, 1)}>→</button>
            <button className="ed__icon" title="Duplicate" data-testid="action-dupe" onClick={() => duplicateAction(selected, selectedAction)}>⧉</button>
            <button className="ed__icon" title="Delete" data-testid="action-delete" onClick={() => deleteAction(selected, selectedAction)}>✕</button>
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
        {timeline.map((a, i) => (
          <button key={i} className={`ed__chip${a.kind === "click_gate" ? " ed__chip--gate" : ""}`} onClick={() => selectAction(i)} aria-current={i === selectedAction ? "true" : undefined}>
            {a.kind === "click_gate" ? "┃ gate ┃" : <>{a.kind}{a.kind === "text" ? `:${a.in}` : ""}{a.kind === "wait" ? ` ${a.ms}ms` : ""}{" "}
            <span style={{ color: "var(--ed-fg-muted)" }}>({actionDuration(a).toFixed(1)}s)</span></>}
          </button>
        ))}
        {!timeline.length && <span style={{ color: "var(--ed-fg-muted)" }}>empty beat</span>}
      </div>
      <input type="range" min={0} max={time.duration || 0} step={0.01} value={time.t}
        onChange={(e) => canvasRef.current?.seek(parseFloat(e.target.value))} style={{ width: "100%" }} data-testid="scrub" />
    </div>
  );
}
