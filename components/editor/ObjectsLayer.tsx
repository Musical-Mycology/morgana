"use client";
import { useState, type RefObject } from "react";
import { useEditor } from "@/lib/editor/store";
import type { SceneObject, TextObjectStyle } from "@/engine/deck/types";
import type { ObjectPath } from "@/lib/editor/object-tree";
import { pointerFraction } from "@/lib/editor/object-drag";

const SIZE_PX: Record<NonNullable<TextObjectStyle["size"]>, number> = { lg: 34, md: 22, sm: 15 };

/** Flatten the tree to a paint-ordered list (depth-first, parent before children). */
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

export function ObjectsLayer({ hostRef }: { hostRef: RefObject<HTMLDivElement | null> }) {
  const doc = useEditor((s) => s.doc);
  const selected = useEditor((s) => s.selected);
  const beats = useEditor((s) => s.beats);
  const selectedObjectPath = useEditor((s) => s.selectedObjectPath);
  const selectObject = useEditor((s) => s.selectObject);
  const updateObjectTransform = useEditor((s) => s.updateObjectTransform);
  const [drag, setDrag] = useState<{ path: ObjectPath; x: number; y: number } | null>(null);
  const sceneId = beats[selected]?.sceneId;
  const objects = doc?.scenes.find((sc) => sc.id === sceneId)?.objects ?? [];
  if (!objects.length) return null;

  return (
    <div className="ed__objects" style={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: "none" }}>
      {selectedObjectPath && (
        <div
          data-testid="objects-deselect"
          style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}
          onPointerDown={() => selectObject(null)}
        />
      )}
      {flatten(objects).map(({ obj, path }) => {
        if (obj.hidden) return null;
        if (obj.kind === "group" && !pathEq(selectedObjectPath, path)) return null; // groups draw only when selected
        const t = obj.transform;
        const dragging = drag && pathEq(drag.path, path);
        const eff = dragging ? { ...t, x: drag.x, y: drag.y } : t;
        const selectedCls = pathEq(selectedObjectPath, path) ? " ed__obj--selected" : "";
        const style: React.CSSProperties = {
          position: "absolute", left: `${eff.x * 100}%`, top: `${eff.y * 100}%`, width: `${t.w * 100}%`, height: `${t.h * 100}%`,
          transform: t.rot ? `rotate(${t.rot}deg)` : undefined, transformOrigin: t.anchor === "top-left" ? "0 0" : "50% 50%",
          opacity: obj.opacity ?? 1,
        };
        return (
          <div
            key={obj.id}
            data-testid="obj"
            data-obj-id={obj.id}
            className={`ed__obj ed__obj--${obj.kind}${selectedCls}`}
            onPointerDown={(e) => {
              if (obj.locked) return;
              e.preventDefault();
              e.stopPropagation();
              selectObject(path);
              const rect = hostRef.current?.getBoundingClientRect();
              if (!rect || rect.width === 0) return;
              // grab offset between pointer and the object's top-left, in fractions
              const start = pointerFraction(rect, e.clientX, e.clientY);
              const off = { x: start.x - t.x, y: start.y - t.y };
              const move = (ev: PointerEvent) => {
                const r = hostRef.current?.getBoundingClientRect();
                if (!r || r.width === 0) return;
                const f = pointerFraction(r, ev.clientX, ev.clientY);
                setDrag({ path, x: Number((f.x - off.x).toFixed(3)), y: Number((f.y - off.y).toFixed(3)) });
              };
              const up = (ev: PointerEvent) => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                const r = hostRef.current?.getBoundingClientRect();
                if (r && r.width > 0) {
                  const f = pointerFraction(r, ev.clientX, ev.clientY);
                  const nx = Number((f.x - off.x).toFixed(3));
                  const ny = Number((f.y - off.y).toFixed(3));
                  // a pure click (no net movement) must not create a history entry / autosave
                  // (round both sides the same way so a >3-decimal stored transform can't spuriously commit)
                  if (nx !== Number(t.x.toFixed(3)) || ny !== Number(t.y.toFixed(3))) {
                    updateObjectTransform(sceneId!, path, { x: nx, y: ny });
                  }
                }
                setDrag(null);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
            style={{ ...style, pointerEvents: obj.locked ? "none" : "auto", cursor: "move" }}
          >
            {renderContent(obj)}
          </div>
        );
      })}
    </div>
  );
}

function renderContent(obj: SceneObject) {
  switch (obj.kind) {
    case "text":
      return (
        <span style={{
          display: "block", width: "100%", height: "100%", overflow: "hidden",
          fontSize: SIZE_PX[obj.style?.size ?? "md"], textAlign: obj.style?.align ?? "left",
          color: obj.style?.color ?? "var(--ed-fg)", fontWeight: obj.style?.bold ? 700 : 400, fontStyle: obj.style?.italic ? "italic" : "normal",
        }}>{obj.text}</span>
      );
    case "image":
      return obj.src
        ? <img src={obj.src} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: obj.fit ?? "contain", borderRadius: obj.round ? "50%" : 0 }} />
        : <span className="ed__obj-ph">image</span>;
    case "shape": {
      const stroke = obj.stroke ? `${Math.max(1, obj.stroke.width * 400)}px solid ${obj.stroke.color}` : undefined;
      return <span style={{ display: "block", width: "100%", height: "100%", background: obj.fill ?? "transparent", border: stroke, borderRadius: obj.shape === "ellipse" ? "50%" : (obj.radius ? `${obj.radius * 100}%` : 0) }} />;
    }
    case "group":
      return null; // frame comes from the .ed__obj--group border
  }
}
