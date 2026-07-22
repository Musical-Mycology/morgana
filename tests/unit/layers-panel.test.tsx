import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LayersPanel } from "@/components/editor/LayersPanel";
import { useEditor } from "@/lib/editor/store";
import { primaryPath } from "@/lib/editor/selection";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "a", kind: "shape", shape: "rect", transform: { x: 0, y: 0, w: 0.1, h: 0.1 } },
    { id: "g", kind: "group", name: "My Group", transform: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, children: [
      { id: "c0", kind: "text", text: "hi", transform: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } },
    ] },
    { id: "b", kind: "shape", shape: "rect", transform: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

const rows = () => screen.getAllByTestId("layer-row");
const rowFor = (id: string) => rows().find((r) => r.getAttribute("data-obj-id") === id)!;

beforeEach(() => { useEditor.getState().load(doc()); });
afterEach(cleanup);

test("renders one row per object, front-of-z first with the group above its child", () => {
  render(<LayersPanel />);
  expect(rows().map((r) => r.getAttribute("data-obj-id"))).toEqual(["b", "g", "c0", "a"]);
});

test("a row shows the object's name when present, else kind + id", () => {
  render(<LayersPanel />);
  expect(rowFor("g").textContent).toContain("My Group");
  expect(rowFor("a").textContent).toContain("shape");
});

test("clicking a row selects that exact object at its depth", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("c0"));
  expect(primaryPath(useEditor.getState().selectedObjectPaths)).toEqual([1, 0]);
});

test("shift-clicking toggles multi-selection", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("a"));
  fireEvent.click(rowFor("b"), { shiftKey: true });
  expect(useEditor.getState().selectedObjectPaths).toEqual([[0], [2]]);
});

test("the primary row is aria-current", () => {
  render(<LayersPanel />);
  fireEvent.click(rowFor("a"));
  expect(rowFor("a").getAttribute("aria-current")).toBe("true");
});
