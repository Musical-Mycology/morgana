"use client";
import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { ObjectTransform } from "@/engine/deck/types";
import type { ObjectPath } from "@/lib/editor/object-tree";
import { usePointerDrag } from "@/lib/editor/usePointerDrag";
import { resizeTransform, rotateTransform, transformChanged, type ResizeHandle } from "@/lib/editor/object-drag";

const HANDLES: { id: ResizeHandle; cx: number; cy: number; cursor: string }[] = [
  { id: "nw", cx: 0, cy: 0, cursor: "nwse-resize" },
  { id: "n", cx: 0.5, cy: 0, cursor: "ns-resize" },
  { id: "ne", cx: 1, cy: 0, cursor: "nesw-resize" },
  { id: "e", cx: 1, cy: 0.5, cursor: "ew-resize" },
  { id: "se", cx: 1, cy: 1, cursor: "nwse-resize" },
  { id: "s", cx: 0.5, cy: 1, cursor: "ns-resize" },
  { id: "sw", cx: 0, cy: 1, cursor: "nesw-resize" },
  { id: "w", cx: 0, cy: 0.5, cursor: "ew-resize" },
];

export interface SelectionOverlayProps {
  hostRef: RefObject<HTMLDivElement | null>;
  transform: ObjectTransform;
  sceneId: string;
  path: ObjectPath;
  onPreview: (patch: Partial<ObjectTransform>) => void;
  onPreviewEnd: () => void;
  commit: (sceneId: string, path: ObjectPath, patch: Partial<ObjectTransform>) => void;
}

export function SelectionOverlay({
  hostRef, transform, sceneId, path, onPreview, onPreviewEnd, commit,
}: SelectionOverlayProps) {
  const startDrag = usePointerDrag(hostRef);
  const startT = useRef<ObjectTransform>(transform);

  const shift = (e: DragCtxEvent) => "shiftKey" in e && e.shiftKey;

  const resizeDown = (handle: ResizeHandle) => (e: ReactPointerEvent) => {
    startDrag(e, {
      onStart: () => { startT.current = transform; },
      onMove: (c) => onPreview(resizeTransform(startT.current, handle, c.rect, c.clientX, c.clientY, { aspect: shift(c.e) })),
      onCommit: (c) => {
        if (c.moved) {
          const patch = resizeTransform(startT.current, handle, c.rect, c.clientX, c.clientY, { aspect: shift(c.e) });
          if (transformChanged(startT.current, patch)) commit(sceneId, path, patch);
        }
        onPreviewEnd();
      },
    });
  };

  const rotateDown = (e: ReactPointerEvent) => {
    startDrag(e, {
      onStart: () => { startT.current = transform; },
      onMove: (c) => onPreview(rotateTransform(startT.current, c.rect, c.clientX, c.clientY, { snap: shift(c.e) })),
      onCommit: (c) => {
        if (c.moved) {
          const patch = rotateTransform(startT.current, c.rect, c.clientX, c.clientY, { snap: shift(c.e) });
          if (transformChanged(startT.current, patch)) commit(sceneId, path, patch);
        }
        onPreviewEnd();
      },
    });
  };

  const frameStyle: CSSProperties = {
    position: "absolute",
    left: `${transform.x * 100}%`, top: `${transform.y * 100}%`,
    width: `${transform.w * 100}%`, height: `${transform.h * 100}%`,
    transform: transform.rot ? `rotate(${transform.rot}deg)` : undefined,
    transformOrigin: transform.anchor === "top-left" ? "0 0" : "50% 50%",
    pointerEvents: "none",
  };

  return (
    <div data-testid="obj-selection" className="ed__sel-frame" style={frameStyle}>
      <div
        data-testid="obj-handle-rotate" className="ed__handle ed__handle--rotate"
        onPointerDown={rotateDown}
        style={{ position: "absolute", left: "50%", top: 0, pointerEvents: "auto" }}
      />
      {HANDLES.map((h) => (
        <div
          key={h.id} data-testid={`obj-handle-${h.id}`} className="ed__handle"
          onPointerDown={resizeDown(h.id)}
          style={{ position: "absolute", left: `${h.cx * 100}%`, top: `${h.cy * 100}%`, cursor: h.cursor, pointerEvents: "auto" }}
        />
      ))}
    </div>
  );
}

type DragCtxEvent = PointerEvent | ReactPointerEvent;
