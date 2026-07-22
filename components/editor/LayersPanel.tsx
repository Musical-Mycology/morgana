"use client";
import { useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { flattenForPanel, pathInList, primaryPath, sameParentSiblings } from "@/lib/editor/selection";
import { getObjectAt, getObjectListAt, type ObjectPath } from "@/lib/editor/object-tree";
import { isGated } from "@/lib/editor/object-gating";
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
  const reorderObject = useEditor((s) => s.reorderObject);
  const groupObjects = useEditor((s) => s.groupObjects);
  const ungroupObject = useEditor((s) => s.ungroupObject);
  const deleteObject = useEditor((s) => s.deleteObject);
  const addObject = useEditor((s) => s.addObject);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);

  const sceneId = beats[selected]?.sceneId;
  const scene = doc?.scenes.find((sc) => sc.id === sceneId);
  const objects = scene?.objects ?? [];
  const primary = primaryPath(selectedObjectPaths);
  const rows = flattenForPanel(objects, collapsed);
  const primaryObj = primary ? getObjectAt(objects, primary) : undefined;
  const canGroup = sameParentSiblings(selectedObjectPaths);
  const canUngroup = selectedObjectPaths.length === 1 && primaryObj?.kind === "group";
  const primaryList = primary ? getObjectListAt(objects, primary.slice(0, -1)) : undefined;
  const primaryIdx = primary ? primary[primary.length - 1] : -1;
  const canRaise = !!primary && primaryList != null && primaryIdx < primaryList.length - 1;
  const canLower = !!primary && primaryList != null && primaryIdx > 0;

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
      <div className="ed__layer-toolbar">
        <button className="ed__icon" data-testid="layer-raise" title="Raise" disabled={!canRaise}
          onClick={() => primary && sceneId && reorderObject(sceneId, primary, 1)}>↑</button>
        <button className="ed__icon" data-testid="layer-lower" title="Lower" disabled={!canLower}
          onClick={() => primary && sceneId && reorderObject(sceneId, primary, -1)}>↓</button>
        <button className="ed__icon" data-testid="layer-group" title="Group" disabled={!canGroup}
          onClick={() => sceneId && groupObjects(sceneId, selectedObjectPaths)}>❏</button>
        <button className="ed__icon" data-testid="layer-ungroup" title="Ungroup" disabled={!canUngroup}
          onClick={() => primary && sceneId && ungroupObject(sceneId, primary)}>⤢</button>
        <button className="ed__icon" data-testid="layer-delete" title="Delete" disabled={!primary}
          onClick={() => primary && sceneId && deleteObject(sceneId, primary)}>✕</button>
        <select className="ed__layer-add" data-testid="layer-object-add" value=""
          onChange={(e) => { if (e.target.value && sceneId) addObject(sceneId, e.target.value as "text" | "image" | "shape"); }}>
          <option value="">＋ Object…</option>
          <option value="text">Text</option>
          <option value="image">Image</option>
          <option value="shape">Shape</option>
        </select>
      </div>
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
            {scene && isGated(scene, obj.id) && (
              <span data-testid="gated-badge" title="Hidden until revealed" style={{ fontSize: 9, opacity: 0.7, marginLeft: 4 }}>⏱</span>
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
