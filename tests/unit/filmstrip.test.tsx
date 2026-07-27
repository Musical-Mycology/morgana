import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEditor } from "@/lib/editor/store";
import { Filmstrip } from "@/components/editor/Filmstrip";
import type { DeckDoc } from "@/engine/deck-doc";

const deck = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "a", timeline: [] }, { id: "b", timeline: [] }] },
  { id: "gap", beats: [] },
  { id: "s2", beats: [{ id: "c", timeline: [] }] },
] });

beforeEach(() => useEditor.getState().load(deck()));
afterEach(cleanup);

test("renders every scene, including one with no beats", () => {
  render(<Filmstrip />);
  expect(screen.getAllByTestId("scene-row")).toHaveLength(3);
  expect(screen.getByTestId("scene-empty-row")).toBeTruthy();
});

test("scene delete removes that scene by index", () => {
  render(<Filmstrip />);
  fireEvent.click(screen.getAllByTestId("scene-delete")[1]);   // the "gap" scene
  expect(useEditor.getState().doc!.scenes.map((s) => s.id)).toEqual(["s1", "s2"]);
});

test("scene down reorders scenes", () => {
  render(<Filmstrip />);
  fireEvent.click(screen.getAllByTestId("scene-down")[0]);
  expect(useEditor.getState().doc!.scenes.map((s) => s.id)).toEqual(["gap", "s1", "s2"]);
});

test("scene up reorders scenes", () => {
  render(<Filmstrip />);
  fireEvent.click(screen.getAllByTestId("scene-up")[2]);
  expect(useEditor.getState().doc!.scenes.map((s) => s.id)).toEqual(["s1", "s2", "gap"]);
});

test("the empty scene's add-beat button fills it", () => {
  render(<Filmstrip />);
  fireEvent.click(screen.getAllByTestId("scene-add-beat")[1]);
  expect(useEditor.getState().doc!.scenes[1].beats).toHaveLength(1);
});

test("beat controls still appear only on the selected beat", () => {
  render(<Filmstrip />);
  expect(screen.queryAllByTestId("beat-delete")).toHaveLength(1); // beat 0 is selected on load
});
