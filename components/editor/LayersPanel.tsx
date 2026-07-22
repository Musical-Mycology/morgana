"use client";
import { useEditor } from "@/lib/editor/store";
import { flattenForPanel, pathInList, primaryPath } from "@/lib/editor/selection";
import type { ObjectPath } from "@/lib/editor/object-tree";
import type { SceneObject } from "@/engine/deck/types";

export function LayersPanel() {
  const doc = useEditor((s) => s.doc);
  const selected = useEditor((s) => s.selected);
  const beats = useEditor((s) => s.beats);
  const selectedObjectPaths = useEditor((s) => s.selectedObjectPaths);
  const selectObject = useEditor((s) => s.selectObject);
  const toggleObjectSelection = useEditor((s) => s.toggleObjectSelection);

  const sceneId = beats[selected]?.sceneId;
  const objects = doc?.scenes.find((sc) => sc.id === sceneId)?.objects ?? [];
  const primary = primaryPath(selectedObjectPaths);
  const rows = flattenForPanel(objects, new Set<string>());

  const clickRow = (path: ObjectPath) => (e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) toggleObjectSelection(path);
    else selectObject(path);
  };

  return (
    <div className="ed__layers" data-testid="layers-panel">
      <div className="ed__lbl">Layers</div>
      {rows.length === 0 && <div style={{ padding: "6px 12px", color: "var(--ed-fg-muted)", fontSize: 12 }}>No objects</div>}
      {rows.map(({ obj, path, depth }) => {
        const label = obj.name ?? `${obj.kind} · ${obj.id}`;
        const isPrimary = !!primary && pathInList([primary], path);
        const isSelected = pathInList(selectedObjectPaths, path);
        return (
          <div
            key={obj.id}
            data-testid="layer-row"
            data-obj-id={obj.id}
            className={`ed__layer${isSelected ? " ed__layer--selected" : ""}`}
            aria-current={isPrimary ? "true" : undefined}
            onClick={clickRow(path)}
            style={{ paddingLeft: 8 + depth * 14, cursor: "pointer" }}
          >
            <span className="ed__layer-kind" aria-hidden>{glyph(obj.kind)}</span>
            <span className="ed__layer-name">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function glyph(kind: SceneObject["kind"]): string {
  return { text: "T", image: "▣", shape: "◆", group: "❏" }[kind];
}
