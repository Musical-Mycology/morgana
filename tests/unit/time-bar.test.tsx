import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TimeBar, timeBarScale } from "@/components/timing/TimeBar";
import type { DeckLayout } from "@/engine/authoring/deck-clock";

afterEach(cleanup);

/** jsdom has no global PointerEvent, so fireEvent.pointer* falls back to a bare Event that
 *  drops clientX. Dispatch a MouseEvent under the pointer type string instead (same pattern as
 *  objects-layer-drag.test.tsx); the handler only reads type, buttons and clientX. */
function firePointer(target: EventTarget, type: "pointerdown" | "pointermove", clientX: number) {
  target.dispatchEvent(new MouseEvent(type, { clientX, buttons: 1, bubbles: true, cancelable: true }));
}

const layout: DeckLayout = { total: 10, scenes: [
  { sceneIdx: 0, start: 0, length: 4, contentLength: 3, pinned: true, beats: [] },
  { sceneIdx: 1, start: 4, length: 0, contentLength: 0, pinned: false, beats: [] },
  { sceneIdx: 2, start: 4, length: 6, contentLength: 7.5, pinned: true, beats: [] },
] };

test("segments, hold, overrun, target, playhead", () => {
  render(<TimeBar layout={layout} sceneIds={["opening", "gap", "credits"]} value={5} targetSec={12} onScrub={() => {}} testId="tb" />);
  const segs = screen.getAllByTestId("timebar-scene");
  expect(segs.map((s) => s.textContent)).toEqual(["opening", "credits"]); // zero-length scene not drawn
  expect(segs[0].style.width).toBe(`${(4 / 12) * 100}%`);
  expect(screen.getAllByTestId("timebar-hold")).toHaveLength(1);
  expect(screen.getByTestId("timebar-overrun").getAttribute("title")).toBe("1.5s over");
  expect(screen.getByTestId("timebar-target").style.left).toBe("100%");
  expect(screen.getByTestId("timebar-playhead").style.left).toBe(`${(5 / 12) * 100}%`);
});

test("pointer scrubs in deck time, clamped to total", () => {
  const onScrub = vi.fn();
  render(<TimeBar layout={layout} sceneIds={["a", "b", "c"]} value={0} targetSec={12} onScrub={onScrub} testId="tb" />);
  const bar = screen.getByTestId("tb");
  bar.getBoundingClientRect = () => ({ left: 0, width: 120, top: 0, height: 20, right: 120, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
  bar.setPointerCapture = () => {};
  firePointer(bar, "pointerdown", 30);
  expect(onScrub).toHaveBeenLastCalledWith(3);
  firePointer(bar, "pointermove", 115);
  expect(onScrub).toHaveBeenLastCalledWith(10); // 11.5 clamped to total
});

test("timeBarScale", () => {
  expect(timeBarScale(layout, 12)).toBe(12);
  expect(timeBarScale(layout)).toBe(10);
});
