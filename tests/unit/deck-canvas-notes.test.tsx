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

  // Regression for the paint-order bug: `.cin` (the caption-text wrapper) used to be an
  // unstyled, statically-positioned div. A statically-positioned element ignores z-index
  // entirely and always paints BELOW positioned siblings regardless of DOM order, so it
  // painted below NoteField's `.notefield` (position: absolute; z-index: 2) even though
  // it sits later in the tree — text was covered by note sprites.
  //
  // jsdom's `getComputedStyle` does not fill in CSS-spec defaults for unset properties —
  // it returns "" rather than "static" / "auto" — so a naive `.not.toBe("static")` check
  // would pass vacuously on the broken markup too. `isPositioned` and `stackLevel` below
  // treat "" (and any non-positioning value) as unpositioned/unstacked explicitly, so this
  // fails on the old markup for the right reason and passes only once `.cin` is actually
  // given `position` + a `zIndex` above NoteField's.
  const POSITIONED = new Set(["absolute", "relative", "fixed", "sticky"]);
  const isPositioned = (el: HTMLElement) => POSITIONED.has(getComputedStyle(el).position);
  const stackLevel = (el: HTMLElement) => {
    if (!isPositioned(el)) return -Infinity;
    const z = getComputedStyle(el).zIndex;
    return z === "" || z === "auto" ? 0 : Number(z);
  };

  it("stacks the caption-text wrapper above the notes layer", () => {
    const ref = createRef<CanvasHandle>();
    const flat = useEditor.getState().beats[0];
    const { container } = render(<DeckCanvas ref={ref} flat={flat} />);
    const notefield = container.querySelector('[data-testid="notefield"]') as HTMLElement;
    const cin = container.querySelector(".cin") as HTMLElement;
    expect(notefield).toBeTruthy();
    expect(cin).toBeTruthy();

    expect(isPositioned(notefield)).toBe(true);
    expect(isPositioned(cin)).toBe(true);
    expect(stackLevel(cin)).toBeGreaterThan(stackLevel(notefield));
  });
});
