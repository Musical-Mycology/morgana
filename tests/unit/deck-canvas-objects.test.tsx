import { describe, it, expect, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { createRef } from "react";
import { DeckCanvas, type CanvasHandle } from "@/components/editor/DeckCanvas";
import { useEditor } from "@/lib/editor/store";
import type { DeckDoc } from "@/engine/deck-doc";

const doc: DeckDoc = {
  version: 1, meta: { id: "d", title: "T" },
  scenes: [{
    id: "s1",
    objects: [{ id: "a", kind: "shape", shape: "rect", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }],
    beats: [{ id: "b0", timeline: [{ kind: "obj_reveal", target: "a" }] }],
  }],
} as DeckDoc;

describe("DeckCanvas object rendering + mode-swap", () => {
  beforeEach(() => act(() => useEditor.getState().load(doc)));

  it("shows the authoring overlay at rest and ObjectStage on scrub", () => {
    const ref = createRef<CanvasHandle>();
    const flat = useEditor.getState().beats[0];
    const { container } = render(<DeckCanvas ref={ref} flat={flat} />);
    const stage = () => container.querySelector('[data-testid="object-stage"]') as HTMLElement;
    // at rest (t=0): stage hidden
    expect(stage().style.display).toBe("none");
    // scrub into the reveal window: stage visible + object painted
    act(() => ref.current!.seek(0.6));
    expect(stage().style.display).toBe("block");
    expect((container.querySelector('[data-testid="object-stage"] [data-obj-id="a"]') as HTMLElement).style.display).toBe("block");
  });
});
