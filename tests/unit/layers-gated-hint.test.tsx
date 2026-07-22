import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LayersPanel } from "@/components/editor/LayersPanel";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", objects: [
      { id: "logo", kind: "image", src: "", transform: { x: 0, y: 0, w: 0.2, h: 0.2 } },
      { id: "cap", kind: "text", text: "hi", transform: { x: 0, y: 0, w: 0.3, h: 0.1 } },
    ],
    beats: [{ id: "b1", timeline: [{ kind: "obj_reveal", target: "cap" }] }] },
] });

beforeEach(() => useEditor.getState().load(doc()));
afterEach(cleanup);

test("a gated object (revealed by an obj_reveal) shows a gated badge; others do not", () => {
  render(<LayersPanel />);
  const badges = screen.queryAllByTestId("gated-badge");
  expect(badges).toHaveLength(1);
});
