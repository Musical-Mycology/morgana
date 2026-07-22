import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Inspector } from "@/components/editor/Inspector";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1",
    objects: [
      { id: "logo", name: "Logo", kind: "image", src: "", transform: { x: 0, y: 0, w: 0.2, h: 0.2 } },
      { id: "cap", kind: "text", text: "hi", transform: { x: 0, y: 0, w: 0.3, h: 0.1 } },
    ],
    beats: [{ id: "b1", timeline: [{ kind: "obj_reveal", target: "logo", in: "fade" }] }] },
] });

beforeEach(() => useEditor.getState().load(doc()));
afterEach(cleanup);

test("objectRef field lists scene objects and writes the chosen id to target", () => {
  useEditor.getState().selectAction(0);
  render(<Inspector />);
  const select = screen.getByTestId("inspector").querySelector("select[data-testid='field-target']") as HTMLSelectElement;
  expect(Array.from(select.options).map((o) => o.value)).toEqual(["logo", "cap"]);
  expect(select.value).toBe("logo");
  fireEvent.change(select, { target: { value: "cap" } });
  expect(useEditor.getState().doc!.scenes[0].beats[0].timeline[0]).toMatchObject({ target: "cap" });
});
