"use client";
import { useEditor } from "@/lib/editor/store";
import { descriptorFor, REGISTRY } from "@/lib/editor/registry";
import { descriptorForObject } from "@/lib/editor/object-registry";
import { getObjectAt } from "@/lib/editor/object-tree";
import { getPath } from "@/lib/editor/paths";
import { Field } from "./Field";

const CONVERT_KIND_OPTIONS = Object.values(REGISTRY).map((d) => ({ value: d.kind, label: d.label }));

export function Inspector() {
  const doc = useEditor((s) => s.doc);
  const beats = useEditor((s) => s.beats);
  const selected = useEditor((s) => s.selected);
  const selectedAction = useEditor((s) => s.selectedAction);
  const selectedObjectPath = useEditor((s) => s.selectedObjectPath);
  const updateAction = useEditor((s) => s.updateAction);
  const convertAction = useEditor((s) => s.convertAction);
  const updateObject = useEditor((s) => s.updateObject);
  const deleteObject = useEditor((s) => s.deleteObject);
  const sceneId = beats[selected]?.sceneId;

  // Object selection takes precedence (mutually exclusive with action selection).
  if (selectedObjectPath && sceneId) {
    const objects = doc?.scenes.find((sc) => sc.id === sceneId)?.objects ?? [];
    const obj = getObjectAt(objects, selectedObjectPath);
    if (obj) {
      const d = descriptorForObject(obj);
      return (
        <div className="ed__inspector" data-testid="inspector">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
            <div style={{ fontFamily: "var(--ed-disp)", fontSize: 14 }}>{d.label} object</div>
            <button className="ed__icon" data-testid="object-delete" title="Delete object" onClick={() => deleteObject(sceneId, selectedObjectPath)}>✕</button>
          </div>
          {d.schema.map((f) => (
            <Field key={f.key} spec={f} value={getPath(obj, f.key)} onChange={(v) => updateObject(sceneId, selectedObjectPath, f.key, v)} />
          ))}
        </div>
      );
    }
  }

  const action = selectedAction != null ? beats[selected]?.beat.timeline[selectedAction] : undefined;
  if (!action) return <div className="ed__inspector" data-testid="inspector"><p style={{ opacity: 0.6 }}>Select an object or action to edit.</p></div>;
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
