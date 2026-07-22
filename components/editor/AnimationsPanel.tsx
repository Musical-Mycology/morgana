// components/editor/AnimationsPanel.tsx
"use client";
import { useEditor } from "@/lib/editor/store";
import { descriptorFor } from "@/lib/editor/registry";
import { getObjectAt, type ObjectPath } from "@/lib/editor/object-tree";
import type { ObjectVerbKind } from "@/lib/editor/object-actions";

const VERBS: { kind: ObjectVerbKind; label: string; testid: string }[] = [
  { kind: "obj_reveal", label: "Add entrance", testid: "add-entrance" },
  { kind: "obj_move", label: "Add emphasis", testid: "add-emphasis" },
  { kind: "obj_out", label: "Add exit", testid: "add-exit" },
];
const OBJ_KINDS = new Set(["obj_reveal", "obj_move", "obj_out"]);

export function AnimationsPanel({ sceneId, objectPath }: { sceneId: string; objectPath: ObjectPath }) {
  const doc = useEditor((s) => s.doc);
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const addObjectAnimation = useEditor((s) => s.addObjectAnimation);
  const selectAction = useEditor((s) => s.selectAction);
  const deleteAction = useEditor((s) => s.deleteAction);

  const objects = doc?.scenes.find((sc) => sc.id === sceneId)?.objects ?? [];
  const obj = getObjectAt(objects, objectPath);
  if (!obj) return null;
  const timeline = beats[selected]?.beat.timeline ?? [];
  const rows = timeline
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => OBJ_KINDS.has(a.kind) && (a as { target?: string }).target === obj.id);

  return (
    <div data-testid="animations-panel" style={{ marginTop: 14, borderTop: "1px solid var(--ed-line)", paddingTop: 11 }}>
      <div style={{ fontFamily: "var(--ed-disp)", fontSize: 12.5, marginBottom: 7 }}>Animations</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 9 }}>
        {VERBS.map((v) => (
          <button key={v.kind} data-testid={v.testid} className="ed__btn" style={{ fontSize: 11 }}
            onClick={() => addObjectAnimation(selected, obj.id, v.kind)}>{v.label}</button>
        ))}
      </div>
      {rows.length === 0 && <p style={{ opacity: 0.6, fontSize: 11 }}>No animations on this beat.</p>}
      {rows.map(({ a, i }) => (
        <div key={i} data-testid="anim-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <button className="ed__link" style={{ fontSize: 12 }} onClick={() => selectAction(i)}>{descriptorFor(a).label}</button>
          <button className="ed__icon" data-testid="anim-delete" title="Delete animation" onClick={() => deleteAction(selected, i)}>✕</button>
        </div>
      ))}
    </div>
  );
}
