"use client";
import { useRef, useState, type RefObject } from "react";
import { useEditor } from "@/lib/editor/store";
import type { SceneObject, TextObjectStyle, ObjectTransform } from "@/engine/deck/types";
import type { ObjectPath } from "@/lib/editor/object-tree";
import { getObjectAt } from "@/lib/editor/object-tree";
import { pointerFraction, round3, transformChanged } from "@/lib/editor/object-drag";
import { usePointerDrag } from "@/lib/editor/usePointerDrag";
import { SelectionOverlay } from "./SelectionOverlay";

const SIZE_PX: Record<NonNullable<TextObjectStyle["size"]>, number> = { lg: 34, md: 22, sm: 15 };

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
  const selectedObjectPath = useEditor((s) => s.selectedObjectPath);
  const selectObject = useEditor((s) => s.selectObject);
  const updateObjectTransform = useEditor((s) => s.updateObjectTransform);
  const startDrag = usePointerDrag(hostRef);
  const [preview, setPreview] = useState<Preview>(null);
  const sceneId = beats[selected]?.sceneId;
  const objects = doc?.scenes.find((sc) => sc.id === sceneId)?.objects ?? [];
  if (!objects.length) return null;

  const effOf = (t: ObjectTransform, path: ObjectPath): ObjectTransform =>
    preview && pathEq(preview.path, path) ? { ...t, ...preview.patch } : t;

  const bodyDown = (obj: SceneObject, path: ObjectPath) => (e: React.PointerEvent) => {
    if (obj.locked) return;
    selectObject(path);
    const t = obj.transform;
    let off = { x: 0, y: 0 };
    startDrag(e, {
      onStart: (c) => { const f = pointerFraction(c.rect, c.clientX, c.clientY); off = { x: f.x - t.x, y: f.y - t.y }; },
      onMove: (c) => { const f = pointerFraction(c.rect, c.clientX, c.clientY); setPreview({ path, patch: { x: round3(f.x - off.x), y: round3(f.y - off.y) } }); },
      onCommit: (c) => {
        if (c.moved) {
          const f = pointerFraction(c.rect, c.clientX, c.clientY);
          const patch = { x: round3(f.x - off.x), y: round3(f.y - off.y) };
          if (transformChanged(t, patch)) updateObjectTransform(sceneId!, path, patch);
        }
        setPreview(null);
      },
    });
  };

  const selObj = selectedObjectPath ? getObjectAt(objects, selectedObjectPath) : undefined;
  const showOverlay = selObj && !selObj.locked && !selObj.hidden && selectedObjectPath;

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
        if (obj.kind === "group" && !pathEq(selectedObjectPath, path)) return null;
        const t = obj.transform;
        const eff = effOf(t, path);
        const selectedCls = pathEq(selectedObjectPath, path) ? " ed__obj--selected" : "";
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
      return null;
  }
}
