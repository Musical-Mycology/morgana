"use client";
import { useCallback, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

export interface DragCtx {
  rect: DOMRect;
  clientX: number;
  clientY: number;
  e: PointerEvent | ReactPointerEvent;
}
export interface DragHandlers {
  onStart?: (ctx: DragCtx) => void;
  onMove: (ctx: DragCtx) => void;
  onCommit: (ctx: DragCtx & { moved: boolean }) => void;
}

const MOVE_THRESHOLD_PX = 2;

/**
 * Window-level pointer-drag lifecycle shared by move + resize + rotate.
 * Returns a starter `(reactPointerDownEvent, handlers)` so each object/handle
 * can supply its own closures at pointer-down time (no hooks-in-a-loop).
 * Bails if the host rect is missing or zero-size (jsdom / not laid out yet).
 */
export function usePointerDrag(hostRef: RefObject<HTMLDivElement | null>) {
  return useCallback((e: ReactPointerEvent, handlers: DragHandlers) => {
    e.preventDefault();
    e.stopPropagation();
    const rect0 = hostRef.current?.getBoundingClientRect();
    if (!rect0 || rect0.width === 0 || rect0.height === 0) return;
    const startX = e.clientX, startY = e.clientY;
    handlers.onStart?.({ rect: rect0, clientX: e.clientX, clientY: e.clientY, e });

    const move = (ev: PointerEvent) => {
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      handlers.onMove({ rect, clientX: ev.clientX, clientY: ev.clientY, e: ev });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const rect = hostRef.current?.getBoundingClientRect() ?? rect0;
      const moved =
        Math.abs(ev.clientX - startX) > MOVE_THRESHOLD_PX ||
        Math.abs(ev.clientY - startY) > MOVE_THRESHOLD_PX;
      handlers.onCommit({ rect, clientX: ev.clientX, clientY: ev.clientY, e: ev, moved });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [hostRef]);
}
