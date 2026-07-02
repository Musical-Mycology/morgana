"use client";
import { useEditor } from "@/lib/editor/store";
import { descriptorFor, REGISTRY } from "@/lib/editor/registry";
import { getPath } from "@/lib/editor/paths";
import { Field } from "./Field";

const CONVERT_KIND_OPTIONS = Object.values(REGISTRY).map((d) => ({ value: d.kind, label: d.label }));

export function Inspector() {
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const selectedAction = useEditor((s) => s.selectedAction);
  const updateAction = useEditor((s) => s.updateAction);
  const convertAction = useEditor((s) => s.convertAction);
  const action = selectedAction != null ? beats[selected]?.beat.timeline[selectedAction] : undefined;
  if (!action) return <div className="ed__inspector" data-testid="inspector"><p style={{ opacity: 0.6 }}>Select an action to edit.</p></div>;
  const d = descriptorFor(action);
  return (
    <div className="ed__inspector" data-testid="inspector">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
        <div style={{ fontFamily: "var(--ed-disp)", fontSize: 14 }}>{d.label} action</div>
        <select
          data-testid="action-convert"
          value={action.kind}
          onChange={(e) => { if (e.target.value !== action.kind) convertAction(selected, selectedAction!, e.target.value); }}
          style={{ fontSize: 12 }}
        >
          {CONVERT_KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      {d.schema.length === 0 && <p style={{ opacity: 0.6, fontSize: 12 }}>No editable fields.</p>}
      {d.schema.map((f) => (
        <Field key={f.key} spec={f} value={getPath(action, f.key)} onChange={(v) => updateAction(selected, selectedAction!, f.key, v)} />
      ))}
    </div>
  );
}
