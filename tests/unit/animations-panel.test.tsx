// tests/unit/animations-panel.test.tsx
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Inspector } from "@/components/editor/Inspector";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [{ id: "logo", kind: "image", src: "", transform: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 } }],
    beats: [{ id: "b1", timeline: [] }] },
] });

beforeEach(() => useEditor.getState().load(doc()));
afterEach(cleanup);

test("Add entrance appends an obj_reveal targeting the selected object", () => {
  useEditor.getState().selectObject([0]);
  render(<Inspector />);
  fireEvent.click(screen.getByTestId("add-entrance"));
  const tl = useEditor.getState().doc!.scenes[0].beats[0].timeline;
  expect(tl).toHaveLength(1);
  expect(tl[0]).toMatchObject({ kind: "obj_reveal", target: "logo" });
});

test("the panel lists only current-beat obj_* actions targeting this object", () => {
  useEditor.getState().load(doc());
  useEditor.getState().addObjectAnimation(0, "logo", "obj_reveal");
  useEditor.getState().selectObject([0]);
  render(<Inspector />);
  const rows = screen.getAllByTestId("anim-row");
  expect(rows).toHaveLength(1);
  expect(rows[0].textContent).toMatch(/reveal/i);
});

test("deleting an animation row removes the action", () => {
  useEditor.getState().load(doc());
  useEditor.getState().addObjectAnimation(0, "logo", "obj_out");
  useEditor.getState().selectObject([0]);
  render(<Inspector />);
  fireEvent.click(screen.getByTestId("anim-delete"));
  expect(useEditor.getState().doc!.scenes[0].beats[0].timeline).toHaveLength(0);
});
