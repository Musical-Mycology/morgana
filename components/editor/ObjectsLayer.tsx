"use client";
import type { RefObject } from "react";
import { useEditor } from "@/lib/editor/store";
import type { SceneObject, TextObjectStyle } from "@/engine/deck/types";
import type { ObjectPath } from "@/lib/editor/object-tree";

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
  void hostRef; // used for drag in a later task
  const doc = useEditor((s) => s.doc);
  const selected = useEditor((s) => s.selected);
  const beats = useEditor((s) => s.beats);
  const selectedObjectPath = useEditor((s) => s.selectedObjectPath);
  const sceneId = beats[selected]?.sceneId;
  const objects = doc?.scenes.find((sc) => sc.id === sceneId)?.objects ?? [];
  if (!objects.length) return null;

  return (
    <div className="ed__objects" style={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: "none" }}>
      {flatten(objects).map(({ obj, path }) => {
        if (obj.hidden) return null;
        if (obj.kind === "group" && !pathEq(selectedObjectPath, path)) return null; // groups draw only when selected
        const t = obj.transform;
        const selectedCls = pathEq(selectedObjectPath, path) ? " ed__obj--selected" : "";
        const style: React.CSSProperties = {
          position: "absolute", left: `${t.x * 100}%`, top: `${t.y * 100}%`, width: `${t.w * 100}%`, height: `${t.h * 100}%`,
          transform: t.rot ? `rotate(${t.rot}deg)` : undefined, transformOrigin: t.anchor === "top-left" ? "0 0" : "50% 50%",
          opacity: obj.opacity ?? 1,
        };
        return (
          <div key={obj.id} data-testid="obj" data-obj-id={obj.id} className={`ed__obj ed__obj--${obj.kind}${selectedCls}`} style={style}>
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
        ? <img src={obj.src} alt="" style={{ width: "100%", height: "100%", objectFit: obj.fit ?? "contain", borderRadius: obj.round ? "50%" : 0 }} />
        : <span className="ed__obj-ph">image</span>;
    case "shape": {
      const stroke = obj.stroke ? `${Math.max(1, obj.stroke.width * 400)}px solid ${obj.stroke.color}` : undefined;
      return <span style={{ display: "block", width: "100%", height: "100%", background: obj.fill ?? "transparent", border: stroke, borderRadius: obj.shape === "ellipse" ? "50%" : (obj.radius ? `${obj.radius * 100}%` : 0) }} />;
    }
    case "group":
      return null; // frame comes from the .ed__obj--group border
  }
}
