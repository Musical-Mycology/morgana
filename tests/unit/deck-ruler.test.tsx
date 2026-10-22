import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { useEditor } from "@/lib/editor/store";
import { DeckRuler } from "@/components/editor/DeckRuler";
import type { CanvasHandle } from "@/components/editor/DeckCanvas";
import type { DeckDoc } from "@/engine/deck-doc";

const timed = (on: boolean): DeckDoc => ({ version: 1, meta: { id: "d", title: "D", ...(on ? { timing: { targetSec: 12 } } : {}) }, scenes: [
  { id: "opening", durationSec: 4, beats: [{ id: "a", timeline: [{ kind: "wait", ms: 1000 }] }] },
  { id: "middle", durationSec: 6, beats: [{ id: "b", timeline: [{ kind: "wait", ms: 2000 }] }, { id: "c", timeline: [{ kind: "wait", ms: 2000 }] }] },
] });
afterEach(cleanup);

/** jsdom has no global PointerEvent, so fireEvent.pointer* drops clientX. Dispatch a MouseEvent
 *  under the pointer type string instead (same pattern as time-bar.test.tsx). */
function firePointer(target: EventTarget, type: "pointerdown" | "pointermove", clientX: number) {
  target.dispatchEvent(new MouseEvent(type, { clientX, buttons: 1, bubbles: true, cancelable: true }));
}

test("untimed decks show a hint, not a ruler", () => {
  useEditor.getState().load(timed(false));
  render(<DeckRuler canvasRef={createRef()} beatT={0} />);
  expect(screen.getByTestId("ruler-hint")).toBeTruthy();
  expect(screen.queryByTestId("deck-ruler")).toBeNull();
});

test("playhead follows the selected beat and its local time", () => {
  useEditor.getState().load(timed(true));
  useEditor.getState().select(2); // beat c starts at 4 + 2 = 6
  render(<DeckRuler canvasRef={createRef()} beatT={0.5} />);
  expect(screen.getByTestId("ruler-clock").textContent).toBe("0:06.5 / 0:12");
  expect(screen.getByTestId("play-from-here").getAttribute("href")).toMatch(/\/play\?deck=d&t=6\.50$/);
});

test("scrubbing selects the beat under T and seeks the canvas to localT", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
  useEditor.getState().load(timed(true));
  const seek = vi.fn();
  const ref = createRef<CanvasHandle>() as { current: CanvasHandle | null };
  ref.current = { seek, play: () => {}, pause: () => {} };
  render(<DeckRuler canvasRef={ref} beatT={0} />);
  const bar = screen.getByTestId("deck-ruler");
  bar.getBoundingClientRect = () => ({ left: 0, width: 120, top: 0, height: 20, right: 120, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
  bar.setPointerCapture = () => {};
  act(() => { firePointer(bar, "pointerdown", 70); }); // T = 7 → beat c (flat 2), localT 1
  act(() => { vi.advanceTimersToNextFrame(); });
  expect(useEditor.getState().selected).toBe(2);
  expect(seek).toHaveBeenLastCalledWith(1);
  vi.useRealTimers();
});
