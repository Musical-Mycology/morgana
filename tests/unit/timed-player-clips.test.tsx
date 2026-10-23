// @vitest-environment jsdom
// TimedPlayer drives DeckStage's clip mode: "play" while playing, "seek" when paused — and the
// switch reaches the art video at once (no waiting for the next rAF frame).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TimedPlayer } from "@/components/player/TimedPlayer";
import type { DeckDoc } from "@/engine/deck-doc";

let play: ReturnType<typeof vi.spyOn>;
let pause: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(1);
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(10);
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  // No rAF frames run: any play()/pause() seen below comes from the play-state switch itself.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const doc: DeckDoc = { version: 1, meta: { id: "v", title: "V" }, scenes: [{ id: "s", beats: [
  { id: "a", art: { to: "media:a.mp4", mode: "cut" }, timeline: [{ kind: "wait", ms: 5000 }] },
] }] };

test("play switches the art clip to play mode immediately; pause switches it back to seek", () => {
  render(<TimedPlayer doc={doc} initialT={1} />);
  const video = screen.getByTestId("play-stage").querySelector<HTMLVideoElement>("video.artstage__layer")!;
  expect(video).not.toBeNull();
  expect(play).not.toHaveBeenCalled();
  act(() => { fireEvent.keyDown(window, { key: " " }); }); // play
  expect(play.mock.contexts).toContain(video);
  pause.mockClear();
  act(() => { fireEvent.keyDown(window, { key: " " }); }); // pause
  expect(pause.mock.contexts).toContain(video);
});
