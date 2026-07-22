import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Inspector } from "@/components/editor/Inspector";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [{ id: "o-1", kind: "text", text: "Hi", transform: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 } }], beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => { useEditor.getState().load(doc()); });
afterEach(cleanup);

test("with an object selected, the inspector shows the object's text field and writes back", () => {
  useEditor.getState().selectObject([0]);
  render(<Inspector />);
  const ta = screen.getByTestId("inspector").querySelector("textarea")!;
  expect((ta as HTMLTextAreaElement).value).toBe("Hi");
  fireEvent.change(ta, { target: { value: "Bye" } });
  expect(useEditor.getState().doc!.scenes[0].objects![0]).toMatchObject({ text: "Bye" });
});

test("the object delete button removes it and clears selection", () => {
  useEditor.getState().selectObject([0]);
  render(<Inspector />);
  fireEvent.click(screen.getByTestId("object-delete"));
  expect(useEditor.getState().doc!.scenes[0].objects ?? []).toHaveLength(0);
  expect(useEditor.getState().selectedObjectPath).toBeNull();
});

test("with nothing selected, it shows the empty state", () => {
  render(<Inspector />);
  expect(screen.getByTestId("inspector").textContent).toMatch(/select/i);
});
