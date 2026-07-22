import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { ObjectsLayer } from "@/components/editor/ObjectsLayer";
import { useEditor } from "@/lib/editor/store";
import { primaryPath } from "@/lib/editor/selection";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "g", kind: "group", transform: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, children: [
      { id: "c0", kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } },
    ] },
    { id: "solo", kind: "shape", shape: "rect", transform: { x: 0.7, y: 0.7, w: 0.1, h: 0.1 } },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

const boxFor = (id: string) => screen.getAllByTestId("obj").find((b) => b.getAttribute("data-obj-id") === id)!;

beforeEach(() => { useEditor.getState().load(doc()); });
afterEach(cleanup);

test("clicking a grouped child selects the top-level group", () => {
  // group renders its child box; select the group first so the child is visible/hittable
  useEditor.getState().selectObject([0]);
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  fireEvent.pointerDown(boxFor("c0"));
  expect(primaryPath(useEditor.getState().selectedObjectPaths)).toEqual([0]);
});

test("double-clicking a group enters it so a child becomes selectable", () => {
  useEditor.getState().selectObject([0]);
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  fireEvent.doubleClick(boxFor("c0"));
  expect(useEditor.getState().enteredGroupPath).toEqual([0]);
  expect(primaryPath(useEditor.getState().selectedObjectPaths)).toEqual([0, 0]);
});

test("the resize/rotate overlay is suppressed while multiple objects are selected", () => {
  useEditor.getState().setObjectSelection([[0], [1]]);
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  expect(screen.queryByTestId("obj-selection")).toBeNull();
});
