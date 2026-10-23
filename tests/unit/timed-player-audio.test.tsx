import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TimedPlayer } from "@/components/player/TimedPlayer";
import { __resetSoundtrackCache } from "@/lib/audio/use-soundtrack";
import type { Soundtrack } from "@/lib/audio/soundtrack";
import type { DeckDoc } from "@/engine/deck-doc";

afterEach(() => { cleanup(); __resetSoundtrackCache(); vi.useRealTimers(); });

const doc: DeckDoc = { version: 1, meta: { id: "p", title: "P", timing: { targetSec: 12 }, soundtrack: { media: "0123456789abcdef.mp3" },
  markers: [{ id: "m1", label: "drop", t: 6 }] }, scenes: [
  { id: "a", durationSec: 6, beats: [{ id: "b1", timeline: [{ kind: "text", value: "First", in: "fade" }, { kind: "wait", ms: 1000 }] }] },
  { id: "b", durationSec: 6, beats: [{ id: "b2", timeline: [{ kind: "text", value: "Second", in: "fade" }, { kind: "wait", ms: 1000 }] }] },
] };

function fakeTrack(duration = 10) {
  let audioNow: number | null = null;
  const t = {
    duration, peaks: new Float32Array([0.1, 0.5]),
    play: vi.fn((from: number) => { audioNow = from < duration ? from : null; }),
    pause: vi.fn(() => { audioNow = null; }),
    now: () => audioNow, setMuted: vi.fn(), dispose: vi.fn(),
    set: (v: number | null) => { audioNow = v; },
  };
  return t;
}
const clock = () => screen.getByTestId("play-clock").textContent;
const clockSec = () => Number(clock()!.slice(2, 6)); // seconds of "0:SS.S / …"

test("while playing, T follows the audio clock", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
  const track = fakeTrack();
  render(<TimedPlayer doc={doc} loadTrack={() => Promise.resolve(track as unknown as Soundtrack)} />);
  await act(async () => {});
  act(() => { fireEvent.keyDown(window, { key: " " }); });
  expect(track.play).toHaveBeenCalledWith(0);
  track.set(4.25);
  act(() => { vi.advanceTimersToNextFrame(); });
  expect(clock()).toBe("0:04.3 / 0:12");
  act(() => { fireEvent.keyDown(window, { key: " " }); });
  expect(track.pause).toHaveBeenCalled();
});

test("seeking while playing restarts the audio at the new T", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
  const track = fakeTrack();
  render(<TimedPlayer doc={doc} initialT={2} loadTrack={() => Promise.resolve(track as unknown as Soundtrack)} />);
  await act(async () => {});
  act(() => { fireEvent.keyDown(window, { key: " " }); });
  act(() => { fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true }); });
  expect(track.play).toHaveBeenLastCalledWith(7);
  act(() => { fireEvent.keyDown(window, { key: "Home" }); });
  expect(track.play).toHaveBeenLastCalledWith(0);
});

test("past the track's end the clock continues on the timer", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "performance"] });
  const track = fakeTrack(3);
  render(<TimedPlayer doc={doc} initialT={2.9} loadTrack={() => Promise.resolve(track as unknown as Soundtrack)} />);
  await act(async () => {});
  act(() => { fireEvent.keyDown(window, { key: " " }); });
  track.set(null); // audio finished
  act(() => { vi.advanceTimersByTime(1000); });
  expect(clockSec()).toBeGreaterThan(3.5);
});

test("an audio clock that never advances (autoplay blocked) hands over to the timer, then re-syncs when it moves", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "performance"] });
  const track = fakeTrack();
  render(<TimedPlayer doc={doc} initialT={2} loadTrack={() => Promise.resolve(track as unknown as Soundtrack)} />);
  await act(async () => {});
  act(() => { fireEvent.keyDown(window, { key: " " }); });
  expect(track.play).toHaveBeenLastCalledWith(2); // the fake's now() now sits at 2.0 and never moves
  // Under the 0.5 s threshold the picture holds on the (stuck) audio clock — a real context
  // takes ~170 ms to start, and stepping on the timer there would jump back when it does.
  act(() => { vi.advanceTimersByTime(300); });
  expect(clock()).toBe("0:02.0 / 0:12");
  // ≥ 0.5 s stuck → the timer drives T. (Held ~0.5 s, then ~0.7 s on the timer.)
  act(() => { vi.advanceTimersByTime(900); });
  expect(clockSec()).toBeGreaterThan(2.5);
  const calls = track.play.mock.calls.length;
  // The audio starts moving: it is re-synced to the picture's T and takes over again.
  track.set(2.1);
  act(() => { vi.advanceTimersToNextFrame(); });
  expect(track.play.mock.calls.length).toBe(calls + 1);
  const resyncAt = track.play.mock.lastCall![0];
  expect(resyncAt).toBeGreaterThan(2.5);
  track.set(resyncAt + 0.25);
  act(() => { vi.advanceTimersToNextFrame(); });
  expect(clockSec()).toBeCloseTo(Math.round((resyncAt + 0.25) * 10) / 10, 5);
});

test("a decode failure shows the notice and still plays silently", async () => {
  render(<TimedPlayer doc={doc} loadTrack={() => Promise.reject(new Error("bad"))} />);
  await act(async () => {});
  expect(screen.getByTestId("play-audio-status").textContent).toBe("Soundtrack unavailable — playing silent");
  act(() => { fireEvent.keyDown(window, { key: " " }); });
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
});

test("loading notice, mute toggle (M and button), waveform + markers on the scrubber", async () => {
  let resolve!: (t: Soundtrack) => void;
  const track = fakeTrack();
  render(<TimedPlayer doc={doc} loadTrack={() => new Promise<Soundtrack>((r) => { resolve = r; })} />);
  expect(screen.getByTestId("play-audio-status").textContent).toBe("loading audio…");
  await act(async () => { resolve(track as unknown as Soundtrack); });
  expect(screen.queryByTestId("play-audio-status")).toBeNull();
  act(() => { fireEvent.keyDown(window, { key: "m" }); });
  expect(track.setMuted).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByTestId("play-mute"));
  expect(track.setMuted).toHaveBeenLastCalledWith(false);
  expect(screen.getByTestId("timebar-waveform")).toBeTruthy();
  expect(screen.getByTestId("timebar-marker").getAttribute("title")).toBe("drop");
});

const clockSrc = () => screen.getByTestId("play-clock").getAttribute("data-clock");

test("data-clock reports which clock painted T: audio while it advances, timer when stalled or paused", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "performance"] });
  const track = fakeTrack();
  render(<TimedPlayer doc={doc} loadTrack={() => Promise.resolve(track as unknown as Soundtrack)} />);
  await act(async () => {});
  expect(clockSrc()).toBe("timer"); // idle
  act(() => { fireEvent.keyDown(window, { key: " " }); });
  track.set(1);
  act(() => { vi.advanceTimersToNextFrame(); });
  track.set(1.1);
  act(() => { vi.advanceTimersToNextFrame(); });
  expect(clockSrc()).toBe("audio");
  // The audio clock freezes: after >0.5 s the timer takes over.
  act(() => { vi.advanceTimersByTime(900); });
  expect(clockSrc()).toBe("timer");
  act(() => { fireEvent.keyDown(window, { key: " " }); });
  expect(clockSrc()).toBe("timer"); // paused
});

test("data-clock is timer when there is no soundtrack playing", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "performance"] });
  render(<TimedPlayer doc={doc} loadTrack={() => Promise.reject(new Error("bad"))} />);
  await act(async () => {});
  act(() => { fireEvent.keyDown(window, { key: " " }); });
  act(() => { vi.advanceTimersByTime(200); });
  expect(clockSrc()).toBe("timer");
});

test("data-clock is timer while the audio reading is frozen (suspended context), audio once it advances", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "performance"] });
  const track = fakeTrack();
  render(<TimedPlayer doc={doc} initialT={2} loadTrack={() => Promise.resolve(track as unknown as Soundtrack)} />);
  await act(async () => {});
  act(() => { fireEvent.keyDown(window, { key: " " }); }); // now() is frozen at 2.0
  for (let i = 0; i < 4; i++) {
    act(() => { vi.advanceTimersToNextFrame(); });
    expect(clockSrc()).toBe("timer"); // from the very first frame, inside the 0.5 s grace window
  }
  track.set(2.1);
  act(() => { vi.advanceTimersToNextFrame(); });
  expect(clockSrc()).toBe("audio");
  track.set(2.2);
  act(() => { vi.advanceTimersToNextFrame(); });
  expect(clockSrc()).toBe("audio");
});
