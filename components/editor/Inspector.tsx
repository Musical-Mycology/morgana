"use client";
import { useEditor } from "@/lib/editor/store";
import { descriptorFor } from "@/lib/editor/registry";
import { getPath } from "@/lib/editor/paths";
import { Field } from "./Field";

export function Inspector() {
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const selectedAction = useEditor((s) => s.selectedAction);
  const updateAction = useEditor((s) => s.updateAction);
  const action = selectedAction != null ? beats[selected]?.beat.timeline[selectedAction] : undefined;
  if (!action) return <div className="ed__inspector" data-testid="inspector"><p style={{ opacity: 0.6 }}>Select an action to edit.</p></div>;
  const d = descriptorFor(action);
  return (
    <div className="ed__inspector" data-testid="inspector">
      <div style={{ fontFamily: "var(--ed-disp)", fontSize: 14, marginBottom: 11 }}>{d.label} action</div>
      {d.schema.length === 0 && <p style={{ opacity: 0.6, fontSize: 12 }}>No editable fields.</p>}
      {d.schema.map((f) => (
        <Field key={f.key} spec={f} value={getPath(action, f.key)} onChange={(v) => updateAction(selected, selectedAction!, f.key, v)} />
      ))}
    </div>
  );
}
