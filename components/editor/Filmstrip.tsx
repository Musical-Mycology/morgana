"use client";
import { useEditor } from "@/lib/editor/store";

export function Filmstrip() {
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const select = useEditor((s) => s.select);
  const addBeat = useEditor((s) => s.addBeat);
  const duplicateBeat = useEditor((s) => s.duplicateBeat);
  const deleteBeat = useEditor((s) => s.deleteBeat);
  const moveBeat = useEditor((s) => s.moveBeat);
  const addScene = useEditor((s) => s.addScene);
  const deleteScene = useEditor((s) => s.deleteScene);

  // group consecutive flat beats by sceneId, preserving the flat index
  const groups: { sceneId: string; items: { flatIdx: number; id: string }[] }[] = [];
  beats.forEach((b, i) => {
    const last = groups[groups.length - 1];
    if (last && last.sceneId === b.sceneId) last.items.push({ flatIdx: i, id: b.beat.id });
    else groups.push({ sceneId: b.sceneId, items: [{ flatIdx: i, id: b.beat.id }] });
  });

  return (
    <div className="ed__film" data-testid="filmstrip">
      {groups.map((g) => (
        <div key={g.sceneId}>
          <div className="ed__lbl" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{g.sceneId}</span>
            {groups.length > 1 && (
              <button className="ed__icon" title="Delete scene" data-testid="scene-delete" onClick={() => deleteScene(g.items[0].flatIdx)}>✕</button>
            )}
          </div>
          {g.items.map(({ flatIdx, id }) => (
            <div key={`${g.sceneId}-${id}-${flatIdx}`} style={{ display: "flex", alignItems: "center" }}>
              <button onClick={() => select(flatIdx)} aria-current={flatIdx === selected} className="ed__beat" style={{ flex: 1 }}>
                <span style={{ color: "var(--ed-fg-muted)", marginRight: 8 }}>{String(flatIdx + 1).padStart(2, "0")}</span>
                {id}
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
