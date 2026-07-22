/** Map client pixel coords to a clamped 0–1 fraction of `rect` (the 16:9 stage host). */
export function pointerFraction(rect: DOMRect, clientX: number, clientY: number): { x: number; y: number } {
  const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
  return { x, y };
}
