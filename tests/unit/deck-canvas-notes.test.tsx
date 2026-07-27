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
    beats: [{ id: "b0", timeline: [
      { kind: "note_emitter", color: "#ff0000", pos: { x: 0.5, y: 0.5 }, dir: 0, decay: 1000, freq: 4 },
      { kind: "wait", ms: 4000 },
    ] }],
  }],
} as DeckDoc;

const visible = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('[data-testid="notefield"] span')).filter((n) => n.style.display !== "none");

describe("DeckCanvas note rendering", () => {
  beforeEach(() => act(() => useEditor.getState().load(doc)));

  it("paints notes as the scrubber advances", () => {
    const ref = createRef<CanvasHandle>();
    const flat = useEditor.getState().beats[0];
    const { container } = render(<DeckCanvas ref={ref} flat={flat} />);
    act(() => ref.current!.seek(1.5));
    expect(visible(container).length).toBeGreaterThan(0);
  });

  it("scrubbing away and back repaints an identical frame", () => {
    const ref = createRef<CanvasHandle>();
    const flat = useEditor.getState().beats[0];
    const { container } = render(<DeckCanvas ref={ref} flat={flat} />);
    act(() => ref.current!.seek(1.5));
    const snap = visible(container).map((n) => `${n.style.left}|${n.style.top}|${n.style.opacity}`);
    act(() => ref.current!.seek(3.2));
    act(() => ref.current!.seek(1.5));
    expect(visible(container).map((n) => `${n.style.left}|${n.style.top}|${n.style.opacity}`)).toEqual(snap);
  });
});
