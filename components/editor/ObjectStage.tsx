"use client";
import { forwardRef, useImperativeHandle, useRef } from "react";
import type { Scene } from "@/engine/deck/types";
import { objectStateAt, flattenObjects, type ObjectRenderState } from "@/lib/editor/object-state";
import { renderContent } from "./object-content";

export interface ObjectStageHandle {
  renderAt(scene: Scene, beatIndex: number, t: number): void;
}

/** Pure DOM writer — the ONLY place reducer output touches an object node. */
export function applyObjectState(node: HTMLElement, s: ObjectRenderState): void {
  if (!s.visible || s.opacity <= 0) { node.style.display = "none"; return; }
  node.style.display = "block";
  node.style.left = `${s.x * 100}%`;
  node.style.top = `${s.y * 100}%`;
  node.style.width = `${s.w * 100}%`;
  node.style.height = `${s.h * 100}%`;
  node.style.opacity = String(s.opacity);
  node.style.transform = `rotate(${s.rot}deg) scale(${s.scale})`;
}

export const ObjectStage = forwardRef<ObjectStageHandle, { scene: Scene; active?: boolean }>(
  function ObjectStage({ scene, active = true }, ref) {
    const nodes = useRef<Map<string, HTMLElement>>(new Map());
    const flat = flattenObjects(scene.objects ?? []);

    useImperativeHandle(ref, () => ({
      renderAt: (sc, beatIndex, t) => {
        const state = objectStateAt(sc, beatIndex, t);
        for (const [id, node] of nodes.current) {
          const st = state.get(id);
          if (st) applyObjectState(node, st); else node.style.display = "none";
        }
      },
    }), []);

    return (
      <div className="ed__objstage" style={{ position: "absolute", inset: 0, zIndex: 6, pointerEvents: "none", display: active ? "block" : "none" }} data-testid="object-stage">
        {flat.map(({ obj }) => (
          <div
            key={obj.id}
            data-obj-id={obj.id}
            ref={(el) => { if (el) nodes.current.set(obj.id, el); else nodes.current.delete(obj.id); }}
            className={`ed__obj ed__obj--${obj.kind}`}
            style={{ position: "absolute", transformOrigin: obj.transform.anchor === "top-left" ? "0 0" : "50% 50%", display: "none" }}
          >
            {renderContent(obj)}
          </div>
        ))}
      </div>
    );
  },
);
