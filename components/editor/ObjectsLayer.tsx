"use client";
import { useState, type RefObject } from "react";
import { useEditor } from "@/lib/editor/store";
import type { SceneObject, ObjectTransform } from "@/engine/deck/types";
import type { ObjectPath } from "@/lib/editor/object-tree";
import { getObjectAt, isPrefix } from "@/lib/editor/object-tree";
import { pointerFraction, round3, transformChanged } from "@/lib/editor/object-drag";
import { usePointerDrag } from "@/lib/editor/usePointerDrag";
import { SelectionOverlay } from "./SelectionOverlay";
import { primaryPath, pathInList, resolveCanvasSelection } from "@/lib/editor/selection";
import { renderContent } from "./object-content";

function flatten(objects: SceneObject[], base: ObjectPath = []): { obj: SceneObject; path: ObjectPath }[] {
  const out: { obj: SceneObject; path: ObjectPath }[] = [];
  objects.forEach((obj, i) => {
    const path = [...base, i];
    out.push({ obj, path });
    if (obj.kind === "group") out.push(...flatten(obj.children, path));
  });
  return out;
}

const pathEq = (a: ObjectPath | null, b: ObjectPath) => !!a && a.length === b.length && a.every((v, i) => v === b[i]);

type Preview = { path: ObjectPath; patch: Partial<ObjectTransform> } | null;

export function ObjectsLayer({ hostRef }: { hostRef: RefObject<HTMLDivElement | null> }) {
  const doc = useEditor((s) => s.doc);
  const selected = useEditor((s) => s.selected);
  const beats = useEditor((s) => s.beats);
  const selectedObjectPaths = useEditor((s) => s.selectedObjectPaths);
  const selectedObjectPath = primaryPath(selectedObjectPaths);
  const selectObject = useEditor((s) => s.selectObject);
  const enteredGroupPath = useEditor((s) => s.enteredGroupPath);
  const enterGroup = useEditor((s) => s.enterGroup);
  const exitGroup = useEditor((s) => s.exitGroup);
  const toggleObjectSelection = useEditor((s) => s.toggleObjectSelection);
  const updateObjectTransform = useEditor((s) => s.updateObjectTransform);
  const translateObjectBy = useEditor((s) => s.translateObjectBy);
  const startDrag = usePointerDrag(hostRef);
  const [preview, setPreview] = useState<Preview>(null);
  const sceneId = beats[selected]?.sceneId;
  const objects = doc?.scenes.find((sc) => sc.id === sceneId)?.objects ?? [];
  if (!objects.length) return null;

  const effOf = (t: ObjectTransform, path: ObjectPath): ObjectTransform =>
    preview && pathEq(preview.path, path) ? { ...t, ...preview.patch } : t;

  const bodyDown = (obj: SceneObject, path: ObjectPath) => (e: React.PointerEvent) => {
    if (obj.locked) return;
    const resolved = resolveCanvasSelection(path, enteredGroupPath);
    if (e.shiftKey || e.metaKey || e.ctrlKey) { toggleObjectSelection(resolved); return; }
    const stayEntered = !!enteredGroupPath && isPrefix(enteredGroupPath, resolved) && resolved.length > enteredGroupPath.length;
    selectObject(resolved);
    if (stayEntered && enteredGroupPath) enterGroup(enteredGroupPath);
    const targetPath = resolved;
    const targetObj = getObjectAt(objects, targetPath) ?? obj;
    const t = targetObj.transform;
    let off = { x: 0, y: 0 };
    startDrag(e, {
      onStart: (c) => { const f = pointerFraction(c.rect, c.clientX, c.clientY); off = { x: f.x - t.x, y: f.y - t.y }; },
      onMove: (c) => { const f = pointerFraction(c.rect, c.clientX, c.clientY); setPreview({ path: targetPath, patch: { x: round3(f.x - off.x), y: round3(f.y - off.y) } }); },
      onCommit: (c) => {
        if (c.moved) {
          const f = pointerFraction(c.rect, c.clientX, c.clientY);
          const nx = round3(f.x - off.x), ny = round3(f.y - off.y);
          if (targetObj.kind === "group") {
            const dx = round3(nx - t.x), dy = round3(ny - t.y);
            if (dx !== 0 || dy !== 0) translateObjectBy(sceneId!, targetPath, dx, dy);
          } else if (transformChanged(t, { x: nx, y: ny })) {
            updateObjectTransform(sceneId!, targetPath, { x: nx, y: ny });
          }
        }
        setPreview(null);
      },
    });
  };

  const selObj = selectedObjectPath ? getObjectAt(objects, selectedObjectPath) : undefined;
  const showOverlay = selectedObjectPaths.length === 1 && selObj && !selObj.locked && !selObj.hidden;

  return (
    <div className="ed__objects" style={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: "none" }}>
      {(selectedObjectPaths.length > 0 || enteredGroupPath) && (
        <div
          data-testid="objects-deselect"
          style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}
          onPointerDown={() => exitGroup()}
        />
      )}
      {flatten(objects).map(({ obj, path }) => {
        if (obj.hidden) return null;
        if (obj.kind === "group" && !pathInList(selectedObjectPaths, path) && !pathEq(enteredGroupPath, path)) return null;
        const t = obj.transform;
        const eff = effOf(t, path);
        const selectedCls = pathInList(selectedObjectPaths, path) ? " ed__obj--selected" : "";
        const style: React.CSSProperties = {
          position: "absolute", left: `${eff.x * 100}%`, top: `${eff.y * 100}%`, width: `${eff.w * 100}%`, height: `${eff.h * 100}%`,
          transform: eff.rot ? `rotate(${eff.rot}deg)` : undefined, transformOrigin: eff.anchor === "top-left" ? "0 0" : "50% 50%",
          opacity: obj.opacity ?? 1,
        };
        return (
          <div
            key={obj.id}
            data-testid="obj"
            data-obj-id={obj.id}
            className={`ed__obj ed__obj--${obj.kind}${selectedCls}`}
            onPointerDown={bodyDown(obj, path)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              const resolved = resolveCanvasSelection(path, enteredGroupPath);
              const ro = getObjectAt(objects, resolved);
              if (ro?.kind === "group") { selectObject(path); enterGroup(resolved); }
            }}
            style={{ ...style, pointerEvents: obj.locked ? "none" : "auto", cursor: "move" }}
          >
            {renderContent(obj)}
          </div>
        );
      })}
      {showOverlay && (
        <SelectionOverlay
          hostRef={hostRef}
          transform={effOf(selObj!.transform, selectedObjectPath!)}
          sceneId={sceneId!}
          path={selectedObjectPath!}
          onPreview={(patch) => setPreview({ path: selectedObjectPath!, patch })}
          onPreviewEnd={() => setPreview(null)}
          commit={updateObjectTransform}
        />
      )}
    </div>
  );
}
