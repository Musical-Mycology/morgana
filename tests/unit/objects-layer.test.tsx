import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { ObjectsLayer } from "@/components/editor/ObjectsLayer";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
    { id: "bg", kind: "shape", shape: "rect", fill: "#222", transform: { x: 0, y: 0, w: 1, h: 1 } },
    { id: "title", kind: "text", text: "Hello", transform: { x: 0.1, y: 0.2, w: 0.4, h: 0.15 } },
    { id: "hidden1", kind: "text", text: "no", hidden: true, transform: { x: 0.1, y: 0.5, w: 0.2, h: 0.1 } },
    { id: "grp", kind: "group", transform: { x: 0.3, y: 0.3, w: 0.4, h: 0.3 }, children: [
      { id: "child", kind: "text", text: "In group", transform: { x: 0.3, y: 0.3, w: 0.3, h: 0.1 } },
    ] },
  ], beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(doc()); });
afterEach(cleanup);

test("renders visible objects as positioned boxes, skipping hidden ones", () => {
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  // bg, title, child are drawn; a selected group frame is not (nothing selected); hidden1 is skipped
  const boxes = screen.getAllByTestId("obj");
  const ids = boxes.map((b) => b.getAttribute("data-obj-id"));
  expect(ids).toContain("bg");
  expect(ids).toContain("title");
  expect(ids).toContain("child");
  expect(ids).not.toContain("hidden1");
  expect(screen.getByText("Hello")).toBeTruthy();
});

test("positions a box by its normalized transform", () => {
  render(<ObjectsLayer hostRef={createRef<HTMLDivElement>()} />);
  const title = screen.getAllByTestId("obj").find((b) => b.getAttribute("data-obj-id") === "title")!;
  expect(title.style.left).toBe("10%");
  expect(title.style.top).toBe("20%");
  expect(title.style.width).toBe("40%");
});
