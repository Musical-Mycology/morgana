import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { ObjectsLayer } from "@/components/editor/ObjectsLayer";
import { useEditor } from "@/lib/editor/store";
import { primaryPath } from "@/lib/editor/selection";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "a", kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    { id: "b", kind: "shape", shape: "rect", locked: true, transform: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(doc()); });
afterEach(cleanup);

function boxFor(id: string) { return screen.getAllByTestId("obj").find((b) => b.getAttribute("data-obj-id") === id)!; }

test("pointer-down on an object selects it", () => {
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  fireEvent.pointerDown(boxFor("a"));
  expect(primaryPath(useEditor.getState().selectedObjectPaths)).toEqual([0]);
});

test("a locked object does not select on pointer-down", () => {
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  fireEvent.pointerDown(boxFor("b"));
  expect(primaryPath(useEditor.getState().selectedObjectPaths)).toBeNull();
});

test("pointer-down on the deselect catcher (shown only while selected) deselects", () => {
  useEditor.getState().selectObject([0]);
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  fireEvent.pointerDown(screen.getByTestId("objects-deselect"));
  expect(primaryPath(useEditor.getState().selectedObjectPaths)).toBeNull();
});

test("no deselect catcher exists when nothing is selected", () => {
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  expect(screen.queryByTestId("objects-deselect")).toBeNull();
});

test("a selected, unlocked object mounts the resize/rotate overlay", () => {
  useEditor.getState().selectObject([0]);
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  expect(screen.getByTestId("obj-selection")).toBeTruthy();
  expect(screen.getByTestId("obj-handle-se")).toBeTruthy();
  expect(screen.getByTestId("obj-handle-rotate")).toBeTruthy();
});
