"use client";
import { useEffect, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { sceneGroups } from "@/lib/editor/flatten-beats";
import { deckLayout, sceneOverrun } from "@/engine/authoring/deck-clock";

function SceneLength({ sceneIdx, value, contentLength, over, onCommit }: { sceneIdx: number; value: number | undefined; contentLength: number; over: boolean; onCommit: (v: number | null) => void }) {
  const [draft, setDraft] = useState(value !== undefined ? String(value) : "");
  useEffect(() => { setDraft(value !== undefined ? String(value) : ""); }, [value]);
  const commit = () => {
    if (draft.trim() === "") { onCommit(null); return; }
    const v = Number(draft);
    if (Number.isFinite(v) && v > 0) onCommit(v); else setDraft(value !== undefined ? String(value) : "");
  };
  return (
    <div className="ed__scene-length">
      <input data-testid="scene-length" data-scene-idx={sceneIdx} inputMode="decimal" placeholder="auto" value={draft} title="Scene length (seconds)"
        onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      <span data-testid="scene-length-content" data-over={over ? "true" : undefined}>content {contentLength.toFixed(1)}s</span>
    </div>
  );
}

export function Filmstrip() {
  const doc = useEditor((s) => s.doc);
  const selected = useEditor((s) => s.selected);
  const select = useEditor((s) => s.select);
  const addBeat = useEditor((s) => s.addBeat);
  const duplicateBeat = useEditor((s) => s.duplicateBeat);
  const deleteBeat = useEditor((s) => s.deleteBeat);
  const moveBeat = useEditor((s) => s.moveBeat);
  const addScene = useEditor((s) => s.addScene);
  const moveScene = useEditor((s) => s.moveScene);
  const deleteScene = useEditor((s) => s.deleteScene);
  const addBeatToScene = useEditor((s) => s.addBeatToScene);

  const setSceneDuration = useEditor((s) => s.setSceneDuration);

  const groups = doc ? sceneGroups(doc) : [];
  const layout = doc ? deckLayout(doc) : null;
  const timed = !!doc?.meta.timing;

  return (
    <div className="ed__film" data-testid="filmstrip">
      {groups.map((g) => (
        <div key={g.sceneId}>
          <div className="ed__scene-row" data-testid="scene-row">
            <span className="ed__lbl" style={{ flex: 1, padding: 0 }}>{g.sceneId}</span>
            <button className="ed__icon" title="Move scene up" data-testid="scene-up" onClick={() => moveScene(g.sceneIdx, -1)}>↑</button>
            <button className="ed__icon" title="Move scene down" data-testid="scene-down" onClick={() => moveScene(g.sceneIdx, 1)}>↓</button>
            <button className="ed__icon" title="Add beat" data-testid="scene-add-beat" onClick={() => addBeatToScene(g.sceneIdx)}>＋</button>
            <button className="ed__icon" title="Delete scene" data-testid="scene-delete" onClick={() => deleteScene(g.sceneIdx)}>✕</button>
          </div>
          {doc && layout && (timed || doc.scenes[g.sceneIdx].durationSec !== undefined) && (
            <SceneLength
              sceneIdx={g.sceneIdx}
              value={doc.scenes[g.sceneIdx].durationSec}
              contentLength={layout.scenes[g.sceneIdx].contentLength}
              over={sceneOverrun(layout.scenes[g.sceneIdx]) > 0}
              onCommit={(v) => setSceneDuration(g.sceneIdx, v)}
            />
          )}
          {g.items.length === 0 && (
            <div className="ed__scene-empty" data-testid="scene-empty-row">No beats</div>
          )}
          {g.items.map(({ flatIdx, beatId }) => (
            <div key={`${g.sceneId}-${beatId}-${flatIdx}`} style={{ display: "flex", alignItems: "center" }}>
              <button onClick={() => select(flatIdx)} aria-current={flatIdx === selected} className="ed__beat" style={{ flex: 1 }}>
                <span style={{ color: "var(--ed-fg-muted)", marginRight: 8 }}>{String(flatIdx + 1).padStart(2, "0")}</span>
                {beatId}
              </button>
              {flatIdx === selected && (
                <span style={{ display: "flex", gap: 2, paddingRight: 6 }}>
                  <button className="ed__icon" title="Move up" data-testid="beat-up" onClick={() => moveBeat(flatIdx, -1)}>↑</button>
                  <button className="ed__icon" title="Move down" data-testid="beat-down" onClick={() => moveBeat(flatIdx, 1)}>↓</button>
                  <button className="ed__icon" title="Duplicate" data-testid="beat-dupe" onClick={() => duplicateBeat(flatIdx)}>⧉</button>
                  <button className="ed__icon" title="Add after" data-testid="beat-add" onClick={() => addBeat(flatIdx)}>＋</button>
                  <button className="ed__icon" title="Delete" data-testid="beat-delete" onClick={() => deleteBeat(flatIdx)}>✕</button>
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
      <button className="ed__pill ed__pill--ghost" data-testid="scene-add" style={{ margin: 10 }} onClick={() => addScene()}>＋ Scene</button>
    </div>
  );
}
