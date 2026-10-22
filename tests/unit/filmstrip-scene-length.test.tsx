import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEditor } from "@/lib/editor/store";
import { Filmstrip } from "@/components/editor/Filmstrip";
import type { DeckDoc } from "@/engine/deck-doc";

const deck = (timed: boolean): DeckDoc => ({ version: 1, meta: { id: "d", title: "D", ...(timed ? { timing: { targetSec: 10 } } : {}) }, scenes: [
  { id: "s1", durationSec: 2, beats: [{ id: "a", timeline: [{ kind: "wait", ms: 3000 }] }] },
  { id: "s2", beats: [{ id: "b", timeline: [{ kind: "wait", ms: 1000 }] }] },
] });
afterEach(cleanup);

test("timed decks show a Length field per scene with content length and overrun", () => {
  useEditor.getState().load(deck(true));
  render(<Filmstrip />);
  const inputs = screen.getAllByTestId("scene-length") as HTMLInputElement[];
  expect(inputs.map((i) => i.value)).toEqual(["2", ""]);
  const content = screen.getAllByTestId("scene-length-content");
  expect(content[0].textContent).toBe("content 3.0s");
  expect(content[0].getAttribute("data-over")).toBe("true");
  expect(content[1].getAttribute("data-over")).toBeNull();
});

test("editing Length pins; clearing it un-pins", () => {
  useEditor.getState().load(deck(true));
  render(<Filmstrip />);
  const second = (screen.getAllByTestId("scene-length") as HTMLInputElement[])[1];
  fireEvent.change(second, { target: { value: "4.5" } });
  fireEvent.blur(second);
  expect(useEditor.getState().doc!.scenes[1].durationSec).toBe(4.5);
  fireEvent.change(second, { target: { value: "" } });
  fireEvent.blur(second);
  expect(useEditor.getState().doc!.scenes[1].durationSec).toBeUndefined();
});

test("untimed decks hide Length unless a scene is already pinned", () => {
  useEditor.getState().load(deck(false));
  render(<Filmstrip />);
  expect(screen.getAllByTestId("scene-length")).toHaveLength(1); // only the pinned s1
});

const hist = () => { const st = useEditor.getState(); return [st.past.length, st.revision]; };

test("blur without edits, or re-committing the same value, records no history", () => {
  useEditor.getState().load(deck(true));
  render(<Filmstrip />);
  const [pinned, auto] = screen.getAllByTestId("scene-length") as HTMLInputElement[];
  const before = hist();
  fireEvent.focus(auto); fireEvent.blur(auto); // empty draft on an unpinned scene
  fireEvent.focus(pinned); fireEvent.blur(pinned); // unchanged pinned value
  expect(hist()).toEqual(before);
  fireEvent.change(pinned, { target: { value: "2.0" } }); // same number, different spelling
  fireEvent.blur(pinned);
  expect(hist()).toEqual(before);
  expect(pinned.value).toBe("2");
});

test("Enter then blur commits exactly once", () => {
  useEditor.getState().load(deck(true));
  render(<Filmstrip />);
  const second = (screen.getAllByTestId("scene-length") as HTMLInputElement[])[1];
  const [past0] = hist();
  fireEvent.change(second, { target: { value: "4.5" } });
  fireEvent.keyDown(second, { key: "Enter" });
  fireEvent.blur(second);
  expect(hist()[0]).toBe(past0 + 1);
});
