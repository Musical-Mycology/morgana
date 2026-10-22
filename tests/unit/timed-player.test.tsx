import { afterEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TimedPlayer } from "@/components/player/TimedPlayer";
import type { DeckDoc } from "@/engine/deck-doc";

afterEach(cleanup);

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
