import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TimedPlayer } from "@/components/player/TimedPlayer";
import type { DeckDoc } from "@/engine/deck-doc";

afterEach(() => { cleanup(); vi.useRealTimers(); });

/** Opacity of the stage's text line — 0 until the beat has been seeked past its fade-in, so it
 *  distinguishes "painted at the seeked localT" from "mounted blank at t=0". */
const lineOpacity = (text: string) => {
  const p = Array.from(screen.getByTestId("play-stage").querySelectorAll("p.cin__line")).find((el) => el.textContent === text) as HTMLElement;
  return p.style.opacity;
};

const doc: DeckDoc = { version: 1, meta: { id: "p", title: "P", timing: { targetSec: 12 } }, scenes: [
  { id: "opening", durationSec: 4, beats: [{ id: "a", timeline: [{ kind: "text", value: "Opening line", in: "fade" }, { kind: "wait", ms: 1000 }] }] },
  { id: "middle", durationSec: 6, beats: [{ id: "b", timeline: [{ kind: "text", value: "Second scene", in: "fade" }, { kind: "wait", ms: 2000 }] }] },
  { id: "credits", beats: [{ id: "c", timeline: [{ kind: "text", value: "Credits", in: "fade" }, { kind: "wait", ms: 1000 }] }] },
] };

test("initialT lands in the right scene and shows the clock against the target", () => {
  render(<TimedPlayer doc={doc} initialT={5} />);
  expect(screen.getByTestId("play-clock").textContent).toBe("0:05.0 / 0:12");
  expect(screen.getByTestId("play-scene").textContent).toBe("middle");
  expect(screen.getByTestId("play-stage").textContent).toContain("Second scene");
  expect(screen.getByTestId("play-stage").textContent).not.toContain("Opening line");
  expect(lineOpacity("Second scene")).toBe("1"); // already at localT=1, not a blank t=0 frame
});

test("arrow keys seek ±1s / ±5s, Home returns to 0, and backward across a beat swaps back", () => {
  render(<TimedPlayer doc={doc} initialT={5} />);
  act(() => { fireEvent.keyDown(window, { key: "ArrowRight" }); });
  expect(screen.getByTestId("play-clock").textContent).toBe("0:06.0 / 0:12");
  act(() => { fireEvent.keyDown(window, { key: "ArrowLeft", shiftKey: true }); });
  expect(screen.getByTestId("play-clock").textContent).toBe("0:01.0 / 0:12");
  expect(screen.getByTestId("play-scene").textContent).toBe("opening");
  expect(screen.getByTestId("play-stage").textContent).toContain("Opening line");
  expect(lineOpacity("Opening line")).toBe("1"); // swapped back to the earlier beat AT its seeked localT
  act(() => { fireEvent.keyDown(window, { key: "Home" }); });
  expect(screen.getByTestId("play-clock").textContent).toBe("0:00.0 / 0:12");
});

test("keys typed into an input are ignored", () => {
  render(<><input data-testid="other" /><TimedPlayer doc={doc} initialT={5} /></>);
  const input = screen.getByTestId("other");
  input.focus();
  act(() => { fireEvent.keyDown(input, { key: "ArrowRight" }); });
  expect(screen.getByTestId("play-clock").textContent).toBe("0:05.0 / 0:12");
});

test("past the target the clock is flagged", () => {
  const long: DeckDoc = { ...doc, meta: { ...doc.meta, timing: { targetSec: 3 } } };
  render(<TimedPlayer doc={long} initialT={5} />);
  expect(screen.getByTestId("play-clock").getAttribute("data-over")).toBe("true");
});

test("untimed decks show elapsed / total", () => {
  const untimed: DeckDoc = { ...doc, meta: { id: "p", title: "P" } };
  render(<TimedPlayer doc={untimed} initialT={0} />);
  expect(screen.getByTestId("play-clock").textContent).toBe("0:00.0 / 0:11"); // 4 + 6 + 1.8 = 11.8 → floor
});

test("a deck with nothing to play shows the empty message", () => {
  render(<TimedPlayer doc={{ ...doc, scenes: [{ id: "gap", beats: [] }] }} />);
  expect(screen.getByTestId("play-empty").textContent).toContain("Nothing to play");
});

const hudHidden = () => screen.getByTestId("play-hud").classList.contains("play__hud--hidden");

test("while paused the HUD never auto-hides, even after pointer movement", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { container } = render(<TimedPlayer doc={doc} initialT={5} />);
  act(() => { fireEvent.pointerMove(container.firstElementChild!); });
  act(() => { vi.advanceTimersByTime(5000); });
  expect(hudHidden()).toBe(false);
});

test("pausing within the idle window cancels the pending hide", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { container } = render(<TimedPlayer doc={doc} initialT={0} />);
  act(() => { fireEvent.keyDown(window, { key: " " }); }); // play
  act(() => { fireEvent.pointerMove(container.firstElementChild!); });
  act(() => { fireEvent.keyDown(window, { key: " " }); }); // pause before the timer fires
  act(() => { vi.advanceTimersByTime(5000); });
  expect(hudHidden()).toBe(false);
});

test("the scene label follows the clock across adjacent empty pinned scenes", () => {
  const gaps: DeckDoc = { ...doc, meta: { id: "p", title: "P" }, scenes: [
    { id: "gap1", durationSec: 2, beats: [] },
    { id: "gap2", durationSec: 2, beats: [] },
    doc.scenes[0],
  ] };
  render(<TimedPlayer doc={gaps} initialT={1.5} />);
  expect(screen.getByTestId("play-scene").textContent).toBe("gap1");
  act(() => { fireEvent.keyDown(window, { key: "ArrowRight" }); });
  expect(screen.getByTestId("play-scene").textContent).toBe("gap2");
});

test("the play button restarts from 0 when the deck has finished", () => {
  render(<TimedPlayer doc={doc} initialT={100} />);
  expect(screen.getByTestId("play-clock").textContent).toBe("0:11.8 / 0:12");
  act(() => { fireEvent.click(screen.getByRole("button", { name: "Play" })); });
  expect(screen.getByTestId("play-clock").textContent).toBe("0:00.0 / 0:12");
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
});

// --- Final review fixes -------------------------------------------------------------------

/** The asset keys ArtStage currently has on screen (`data-asset` on each `.artstage__layer`). */
const artLayers = () =>
  Array.from(screen.getByTestId("play-stage").querySelectorAll<HTMLElement>(".artstage__layer")).map((el) => el.dataset.asset);

// Beats 2s each: a [0,2) own art 1.01 · b [2,4) inherits · c [4,6) own art 3.01 · d [6,8) inherits.
const artDoc: DeckDoc = { version: 1, meta: { id: "art", title: "Art" }, scenes: [{ id: "s", beats: [
  { id: "a", art: { to: "1.01", mode: "cut" }, timeline: [{ kind: "wait", ms: 2000 }] },
  { id: "b", timeline: [{ kind: "wait", ms: 2000 }] },
  { id: "c", art: { to: "3.01", mode: "cut" }, timeline: [{ kind: "wait", ms: 2000 }] },
  { id: "d", timeline: [{ kind: "wait", ms: 2000 }] },
] }] };

test("a deep link into an inheriting beat shows the inherited art", () => {
  render(<TimedPlayer doc={artDoc} initialT={3} />); // beat b inherits 1.01 from a
  expect(artLayers()).toEqual(["1.01"]);
});

test("jumping forward into, and backward to, inheriting beats shows each one's inherited art", () => {
  render(<TimedPlayer doc={artDoc} initialT={1} />);
  expect(artLayers()).toEqual(["1.01"]);
  act(() => { fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true }); }); // 6 → d, inherits 3.01 (c never visited)
  expect(artLayers()).toEqual(["3.01"]);
  act(() => { fireEvent.keyDown(window, { key: "ArrowRight" }); }); // 7 → still d
  act(() => { fireEvent.keyDown(window, { key: "ArrowLeft", shiftKey: true }); }); // 2 → b, inherits 1.01
  expect(artLayers()).toEqual(["1.01"]);
});

test("Alt+Arrow and Ctrl/Cmd+F are left to the browser", () => {
  const fs = vi.fn(async () => {});
  (document.documentElement as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen = fs;
  render(<TimedPlayer doc={doc} initialT={5} />);
  act(() => { fireEvent.keyDown(window, { key: "ArrowRight", altKey: true }); });
  expect(screen.getByTestId("play-clock").textContent).toBe("0:05.0 / 0:12");
  act(() => { fireEvent.keyDown(window, { key: "ArrowRight", metaKey: true }); });
  act(() => { fireEvent.keyDown(window, { key: "Home", ctrlKey: true }); });
  expect(screen.getByTestId("play-clock").textContent).toBe("0:05.0 / 0:12");
  act(() => { fireEvent.keyDown(window, { key: "f", ctrlKey: true }); });
  act(() => { fireEvent.keyDown(window, { key: "f", metaKey: true }); });
  expect(fs).not.toHaveBeenCalled();
  act(() => { fireEvent.keyDown(window, { key: "f" }); });
  expect(fs).toHaveBeenCalledTimes(1);
});

test("Space with the play button focused toggles exactly once", () => {
  render(<TimedPlayer doc={doc} initialT={5} />);
  const btn = screen.getByRole("button", { name: "Play" });
  btn.focus();
  // The browser's own Space activation on a focused button = keydown, keyup, then click.
  act(() => { fireEvent.keyDown(btn, { key: " " }); });
  act(() => { fireEvent.keyUp(btn, { key: " " }); });
  act(() => { fireEvent.click(btn); });
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  // A mouse click must not leave the button focused (so a later Space can't reach it at all).
  expect(fireEvent.mouseDown(btn)).toBe(false); // default prevented
});

test("the first playing frame never steps the clock backwards", () => {
  let frame: FrameRequestCallback | null = null;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { frame = cb; return 1; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(performance, "now").mockReturnValue(1000);
  render(<TimedPlayer doc={doc} initialT={5} />);
  act(() => { fireEvent.keyDown(window, { key: " " }); }); // play
  expect(frame).not.toBeNull();
  act(() => { frame!(900); }); // rAF timestamp from before the effect's performance.now()
  expect(screen.getByTestId("play-clock").textContent).toBe("0:05.0 / 0:12");
  vi.restoreAllMocks();
});
