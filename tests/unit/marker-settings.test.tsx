import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { useEditor } from "@/lib/editor/store";
import { MarkerSettings } from "@/components/editor/MarkerSettings";
import { DeckRuler } from "@/components/editor/DeckRuler";
import type { DeckDoc } from "@/engine/deck-doc";

const deck = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D", timing: { targetSec: 12 }, markers: [{ id: "m2", label: "b", t: 10 }, { id: "m1", label: "a", t: 2 }] }, scenes: [
  { id: "opening", durationSec: 4, beats: [{ id: "a", timeline: [{ kind: "wait", ms: 1000 }] }] },
  { id: "middle", durationSec: 6, beats: [{ id: "b", timeline: [{ kind: "wait", ms: 2000 }] }, { id: "c", timeline: [{ kind: "wait", ms: 2000 }] }] },
] });
afterEach(cleanup);
const past = () => useEditor.getState().past.length;
const markers = () => useEditor.getState().doc!.meta.markers;

test("rows are sorted by time", () => {
  useEditor.getState().load(deck());
  render(<MarkerSettings />);
  const labels = screen.getAllByTestId("marker-label").map((i) => (i as HTMLInputElement).value);
  expect(labels).toEqual(["a", "b"]);
  expect(screen.getAllByTestId("marker-row")).toHaveLength(2);
});

test("renaming commits on blur and records one history entry; unchanged blur records none", () => {
  useEditor.getState().load(deck());
  render(<MarkerSettings />);
  const before = past();
  const input = screen.getAllByTestId("marker-label")[0] as HTMLInputElement;
  fireEvent.blur(input);
  expect(past()).toBe(before);
  fireEvent.change(input, { target: { value: "drop" } });
  fireEvent.blur(input);
  expect(markers()!.find((m) => m.id === "m1")!.label).toBe("drop");
  expect(past()).toBe(before + 1);
});

test("an empty or over-long label reverts without history", () => {
  useEditor.getState().load(deck());
  render(<MarkerSettings />);
  const before = past();
  const input = screen.getAllByTestId("marker-label")[0] as HTMLInputElement;
  fireEvent.change(input, { target: { value: "   " } });
  fireEvent.blur(input);
  expect(input.value).toBe("a");
  fireEvent.change(input, { target: { value: "x".repeat(41) } });
  fireEvent.blur(input);
  expect(input.value).toBe("a");
  expect(past()).toBe(before);
});

test("retiming parses m:ss; nonsense reverts with no history", () => {
  useEditor.getState().load(deck());
  render(<MarkerSettings />);
  const before = past();
  const input = screen.getAllByTestId("marker-time")[0] as HTMLInputElement;
  expect(input.value).toBe("0:02.0");
  fireEvent.change(input, { target: { value: "0:05" } });
  fireEvent.blur(input);
  expect(markers()!.find((m) => m.id === "m1")!.t).toBe(5);
  expect(past()).toBe(before + 1);
  const again = screen.getAllByTestId("marker-time")[0] as HTMLInputElement; // m1 (5s) still sorts before m2 (10s)
  fireEvent.change(again, { target: { value: "nonsense" } });
  fireEvent.blur(again);
  expect(again.value).toBe("0:05.0");
  expect(past()).toBe(before + 1);
});

test("delete removes the marker", () => {
  useEditor.getState().load(deck());
  render(<MarkerSettings />);
  fireEvent.click(screen.getAllByTestId("marker-delete")[0]);
  expect(markers()!.map((m) => m.id)).toEqual(["m2"]);
});

test("+ Marker on the ruler adds a marker at the ruler's current time", () => {
  useEditor.getState().load(deck());
  useEditor.getState().select(2); // beat c starts at 4 + 2 = 6
  render(<DeckRuler canvasRef={createRef()} beatT={0.5} />);
  fireEvent.click(screen.getByTestId("add-marker"));
  expect(markers()).toContainEqual({ id: "m3", label: "marker 3", t: 6.5 });
});
