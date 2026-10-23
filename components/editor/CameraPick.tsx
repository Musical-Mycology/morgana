"use client";
import { useEffect, useRef, useState } from "react";
import { clampFraming } from "@/engine/authoring/camera-clock";

export interface CameraPickPoint { x: number; y: number }

/** Round a clamped coordinate to 4 decimals without leaving its clamp range [m, 1 − m]: a bound like
 *  0.5/7 = 0.071428… would round to 0.0714, just outside, so an out-of-range result rounds inward. */
function snap4(v: number, zoom: number): number {
  const m = 0.5 / zoom;
  const r = Math.round(v * 1e4) / 1e4;
  if (r < m) return Math.ceil(m * 1e4) / 1e4;
  if (r > 1 - m) return Math.floor((1 - m) * 1e4) / 1e4;
  return r;
}

/** "Pick on canvas" for a camera action (spec §4): covers the editor canvas with a crosshair layer
 *  and draws the view `zoom` would show as an outline rect, centred on the pointer and clamped like
 *  `clampFraming` so it never leaves the stage. A click picks that clamped centre; Esc cancels.
 *  Fractions are of this layer's own box, which fills the 16:9 canvas host. */
export function CameraPick({ zoom, at, onPick, onCancel }: {
  zoom: number;
  /** Where the rect starts before the pointer moves (the action's current `to.x`/`to.y`). */
  at?: Partial<CameraPickPoint>;
  onPick(p: CameraPickPoint): void;
  onCancel(): void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const centre = (x: number, y: number) => clampFraming({ zoom, x, y });
  const [pt, setPt] = useState<CameraPickPoint>(() => centre(at?.x ?? 0.5, at?.y ?? 0.5));
  const f = centre(pt.x, pt.y); // re-clamped: zoom may change while picking

  // Esc owns the key while picking: the editor's window handler would also exit a group.
  // (document's listener runs before window's in the bubble phase — the AssetPicker pattern.)
  const cancel = useRef(onCancel);
  useEffect(() => { cancel.current = onCancel; }, [onCancel]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancel.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const fromEvent = (e: { clientX: number; clientY: number }): CameraPickPoint | null => {
    const r = layer.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return null;
    const c = centre((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    return { x: c.x, y: c.y };
  };

  const m = 0.5 / f.zoom;
  return (
    <div
      ref={layer}
      data-testid="camera-pick-overlay"
      title="Click to frame the camera here (Esc cancels)"
      style={{ position: "absolute", inset: 0, zIndex: 11, cursor: "crosshair", pointerEvents: "auto" }}
      onPointerMove={(e) => { const p = fromEvent(e); if (p) setPt(p); }}
      onClick={(e) => {
        e.preventDefault();
        const p = fromEvent(e);
        if (p) onPick({ x: snap4(p.x, f.zoom), y: snap4(p.y, f.zoom) });
      }}
    >
      <div
        data-testid="camera-pick-rect"
        style={{
          position: "absolute", pointerEvents: "none", boxSizing: "border-box",
          left: `${(f.x - m) * 100}%`, top: `${(f.y - m) * 100}%`, width: `${100 / f.zoom}%`, height: `${100 / f.zoom}%`,
          outline: "2px solid var(--ed-accent)", outlineOffset: -2, boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
        }}
      />
    </div>
  );
}
