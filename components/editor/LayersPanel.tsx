"use client";
import { useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { flattenForPanel, pathInList, primaryPath } from "@/lib/editor/selection";
import type { ObjectPath } from "@/lib/editor/object-tree";
import type { SceneObject } from "@/engine/deck/types";

const glyph = (kind: SceneObject["kind"]): string => ({ text: "T", image: "▣", shape: "◆", group: "❏" }[kind]);

export function LayersPanel() {
  const doc = useEditor((s) => s.doc);
  const selected = useEditor((s) => s.selected);
  const beats = useEditor((s) => s.beats);
  const selectedObjectPaths = useEditor((s) => s.selectedObjectPaths);
  const selectObject = useEditor((s) => s.selectObject);
  const toggleObjectSelection = useEditor((s) => s.toggleObjectSelection);
  const updateObject = useEditor((s) => s.updateObject);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);

  const sceneId = beats[selected]?.sceneId;
  const objects = doc?.scenes.find((sc) => sc.id === sceneId)?.objects ?? [];
  const primary = primaryPath(selectedObjectPaths);
  const rows = flattenForPanel(objects, collapsed);

  const clickRow = (path: ObjectPath) => (e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) toggleObjectSelection(path);
    else selectObject(path);
  };
  const toggleCollapse = (id: string) => setCollapsed((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const commitRename = (path: ObjectPath, value: string) => {
    if (sceneId) updateObject(sceneId, path, "name", value.trim() || undefined);
    setEditingId(null);
  };

  return (
    <div className="ed__layers" data-testid="layers-panel">
      <div className="ed__lbl">Layers</div>
      {rows.length === 0 && <div style={{ padding: "6px 12px", color: "var(--ed-fg-muted)", fontSize: 12 }}>No objects</div>}
      {rows.map(({ obj, path, depth }) => {
        const label = obj.name ?? `${obj.kind} · ${obj.id}`;
        const isPrimary = !!primary && pathInList([primary], path);
        const isSelected = pathInList(selectedObjectPaths, path);
        const cls = `ed__layer${isSelected ? " ed__layer--selected" : ""}${obj.hidden ? " ed__layer--hidden" : ""}${obj.locked ? " ed__layer--locked" : ""}`;
        return (
          <div
            key={obj.id}
            data-testid="layer-row"
            data-obj-id={obj.id}
            className={cls}
            aria-current={isPrimary ? "true" : undefined}
            onClick={clickRow(path)}
            style={{ paddingLeft: 8 + depth * 14, cursor: "pointer" }}
          >
            {obj.kind === "group" ? (
              <button className="ed__layer-chevron" data-testid="layer-collapse" title="Collapse/expand"
                onClick={(e) => { e.stopPropagation(); toggleCollapse(obj.id); }}>
                {collapsed.has(obj.id) ? "▸" : "▾"}
              </button>
            ) : <span className="ed__layer-chevron" aria-hidden />}
            <span className="ed__layer-kind" aria-hidden>{glyph(obj.kind)}</span>
            {editingId === obj.id ? (
              <input
                className="ed__layer-input"
                data-testid="layer-rename-input"
                autoFocus
                defaultValue={obj.name ?? ""}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => commitRename(path, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(path, e.currentTarget.value);
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
              <span className="ed__layer-name" data-testid="layer-name"
                onDoubleClick={(e) => { e.stopPropagation(); setEditingId(obj.id); }}>{label}</span>
            )}
            <span className="ed__layer-toggles">
              <button className="ed__icon" data-testid="layer-hide" title={obj.hidden ? "Show" : "Hide"}
                onClick={(e) => { e.stopPropagation(); if (sceneId) updateObject(sceneId, path, "hidden", !obj.hidden); }}>
                {obj.hidden ? "◌" : "●"}
              </button>
              <button className="ed__icon" data-testid="layer-lock" title={obj.locked ? "Unlock" : "Lock"}
                onClick={(e) => { e.stopPropagation(); if (sceneId) updateObject(sceneId, path, "locked", !obj.locked); }}>
                {obj.locked ? "🔒" : "🔓"}
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
