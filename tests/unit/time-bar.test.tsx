import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TimeBar, timeBarScale } from "@/components/timing/TimeBar";
import type { DeckLayout } from "@/engine/authoring/deck-clock";

afterEach(cleanup);

/** jsdom has no global PointerEvent, so fireEvent.pointer* falls back to a bare Event that
 *  drops clientX. Dispatch a MouseEvent under the pointer type string instead (same pattern as
 *  objects-layer-drag.test.tsx); the handler only reads type, buttons and clientX. */
function firePointer(target: EventTarget, type: "pointerdown" | "pointermove" | "pointerup", clientX: number) {
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

test("draws the waveform under the segments when peaks are given", () => {
  const peaks = Float32Array.from([0, 0.5, 1, 0.5]);
  render(<TimeBar layout={layout} sceneIds={["a", "b", "c"]} value={0} targetSec={12} onScrub={() => {}} testId="tb" peaks={peaks} peaksDuration={6} />);
  const svg = screen.getByTestId("timebar-waveform");
  expect(svg.querySelectorAll("path")).toHaveLength(1);
  expect(svg.style.width).toBe(`${(6 / 12) * 100}%`); // covers [0, peaksDuration] on the bar's scale
  expect(svg.getAttribute("pointer-events")).toBe("none");
  expect(svg.querySelector("path")!.getAttribute("fill")).toBe("rgba(255,255,255,0.9)");
});

test("no waveform without peaks", () => {
  render(<TimeBar layout={layout} sceneIds={["a", "b", "c"]} value={0} onScrub={() => {}} testId="tb" />);
  expect(screen.queryByTestId("timebar-waveform")).toBeNull();
});

test("markers render as labelled ticks; clicking one jumps there instead of scrubbing", () => {
  const onScrub = vi.fn();
  const onMarkerClick = vi.fn();
  render(<TimeBar layout={layout} sceneIds={["a", "b", "c"]} value={0} targetSec={12} onScrub={onScrub} testId="tb"
    markers={[{ id: "m1", label: "drop", t: 6 }]} onMarkerClick={onMarkerClick} />);
  const tick = screen.getByTestId("timebar-marker");
  expect(tick.getAttribute("title")).toBe("drop");
  expect(tick.style.left).toBe("50%");
  expect(tick.textContent).toContain("drop");
  fireEvent.click(tick);
  expect(onMarkerClick).toHaveBeenCalledWith(6);
  // the tick's pointerdown must not also start a scrub
  firePointer(tick, "pointerdown", 10);
  expect(onScrub).not.toHaveBeenCalled();
});

test("waveform crops to the bar's scale when the track runs longer than the bar", () => {
  const peaks = Float32Array.from([0, 0.5, 1, 0.5, 0, 0.5, 1, 0.5]);
  render(<TimeBar layout={layout} sceneIds={["a", "b", "c"]} value={0} targetSec={12} onScrub={() => {}} testId="tb" peaks={peaks} peaksDuration={24} />);
  const svg = screen.getByTestId("timebar-waveform");
  expect(svg.style.width).toBe("100%"); // 24 s of audio on a 12 s bar: the bar shows the first 12 s
  expect(svg.getAttribute("viewBox")).toBe(`0 0 ${peaks.length / 2} 2`); // first half of the peaks, not squashed
});

test("the waveform path is not recomputed when only the playhead moves", () => {
  const raw = Float32Array.from([0, 0.5, 1, 0.5]);
  let reads = 0;
  const peaks = new Proxy(raw, {
    get(t, p) {
      if (typeof p === "string" && /^\d+$/.test(p)) reads++;
      const v = Reflect.get(t, p, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  const { rerender } = render(<TimeBar layout={layout} sceneIds={["a", "b", "c"]} value={0} targetSec={12} onScrub={() => {}} testId="tb" peaks={peaks} peaksDuration={6} />);
  const d = screen.getByTestId("timebar-waveform").querySelector("path")!.getAttribute("d");
  reads = 0;
  rerender(<TimeBar layout={layout} sceneIds={["a", "b", "c"]} value={3} targetSec={12} onScrub={() => {}} testId="tb" peaks={peaks} peaksDuration={6} />);
  expect(reads).toBe(0); // no sample was read, so the path was not rebuilt
  expect(screen.getByTestId("timebar-waveform").querySelector("path")!.getAttribute("d")).toBe(d);
});

test("a drag that starts on a marker does not scrub", () => {
  const onScrub = vi.fn();
  render(<TimeBar layout={layout} sceneIds={["a", "b", "c"]} value={0} targetSec={12} onScrub={onScrub} testId="tb"
    markers={[{ id: "m1", label: "drop", t: 6 }]} onMarkerClick={() => {}} />);
  // a real width, so the root's scrub handler would act on the move if it were reached
  screen.getByTestId("tb").getBoundingClientRect = () => ({ left: 0, width: 120, top: 0, height: 20, right: 120, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
  const tick = screen.getByTestId("timebar-marker");
  firePointer(tick, "pointerdown", 60);
  firePointer(tick, "pointermove", 90);
  expect(onScrub).not.toHaveBeenCalled();
});

test("a drag that starts on a marker does not scrub once the pointer leaves the tick", () => {
  const onScrub = vi.fn();
  render(<TimeBar layout={layout} sceneIds={["a", "b", "c"]} value={0} targetSec={12} onScrub={onScrub} testId="tb"
    markers={[{ id: "m1", label: "drop", t: 6 }]} onMarkerClick={() => {}} />);
  const bar = screen.getByTestId("tb");
  bar.getBoundingClientRect = () => ({ left: 0, width: 120, top: 0, height: 20, right: 120, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
  firePointer(screen.getByTestId("timebar-marker"), "pointerdown", 60);
  firePointer(bar, "pointermove", 90); // over the bar background, not the tick
  expect(onScrub).not.toHaveBeenCalled();
});

test("a press on the bar scrubs until released; the gate resets after pointerup", () => {
  const onScrub = vi.fn();
  render(<TimeBar layout={layout} sceneIds={["a", "b", "c"]} value={0} targetSec={12} onScrub={onScrub} testId="tb" />);
  const bar = screen.getByTestId("tb");
  bar.getBoundingClientRect = () => ({ left: 0, width: 120, top: 0, height: 20, right: 120, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
  bar.setPointerCapture = () => {};
  firePointer(bar, "pointerdown", 30);
  expect(onScrub).toHaveBeenLastCalledWith(3);
  firePointer(bar, "pointermove", 60);
  expect(onScrub).toHaveBeenLastCalledWith(6);
  firePointer(bar, "pointerup", 60);
  onScrub.mockClear();
  firePointer(bar, "pointermove", 90); // button still reported held, but no press is active
  expect(onScrub).not.toHaveBeenCalled();
});
