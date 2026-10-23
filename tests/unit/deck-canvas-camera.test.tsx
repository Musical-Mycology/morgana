import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { createRef } from "react";
import { DeckCanvas, type CanvasHandle } from "@/components/editor/DeckCanvas";
import { useEditor } from "@/lib/editor/store";
import { cameraAt, cameraEvents, cameraTransform } from "@/engine/authoring/camera-clock";
import type { DeckDoc } from "@/engine/deck-doc";

// Two scenes: the second beat starts at deck time S = 1. Its camera move runs 0.5 → 1.5 s local,
// so local t = 1 (deck T = 2) is mid-move — a framing that depends on S, not on t alone.
const doc: DeckDoc = {
  version: 1, meta: { id: "d", title: "T" },
  scenes: [
    { id: "s0", beats: [{ id: "b0", timeline: [{ kind: "wait", ms: 1000 }] }] },
    { id: "s1", beats: [{ id: "b1", timeline: [
      { kind: "wait", ms: 500 },
      { kind: "camera", to: { zoom: 2, x: 0.3, y: 0.4 }, durationMs: 1000, ease: "linear" },
      { kind: "wait", ms: 2000 },
    ] }] },
  ],
} as DeckDoc;
const S = 1;

const world = (c: HTMLElement) => c.querySelector<HTMLElement>(".artstage__world")!;
const notesWorld = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="notefield"]')!.parentElement!;
const fullFrame = (tf: string) => tf === "" || tf === "none";
/** Every element from `el` up to (and including) the canvas host carries no transform. */
const untransformed = (el: HTMLElement) => {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (!fullFrame(n.style.transform)) return false;
    if (n.classList.contains("ed__canvas-host")) return true;
  }
  return true;
};

describe("DeckCanvas camera preview", () => {
  beforeEach(() => act(() => { useEditor.getState().load(doc); useEditor.getState().select(1); }));
  afterEach(cleanup);

  it("paints cameraAt(cameraEvents(doc), S + t) on the ArtStage world and the NoteField wrapper", () => {
    const ref = createRef<CanvasHandle>();
    const flat = useEditor.getState().beats[1];
    const { container } = render(<DeckCanvas ref={ref} flat={flat} />);
    act(() => ref.current!.seek(1));
    const want = cameraTransform(cameraAt(cameraEvents(doc), S + 1));
    expect(want).not.toBe(cameraTransform(cameraAt(cameraEvents(doc), 1))); // S matters
    expect(world(container).style.transform).toBe(want);
    const nw = notesWorld(container);
    expect(nw.classList.contains("beat__world")).toBe(true);
    expect(nw.style.zIndex).toBe("2");
    expect(nw.style.transform).toBe(want);
  });

  it("leaves the editor ObjectStage and the text layer at full frame", () => {
    const ref = createRef<CanvasHandle>();
    const flat = useEditor.getState().beats[1];
    const { container } = render(<DeckCanvas ref={ref} flat={flat} />);
    act(() => ref.current!.seek(2));
    expect(world(container).style.transform).toContain("scale(2)");
    expect(untransformed(container.querySelector<HTMLElement>('[data-testid="object-stage"]')!)).toBe(true);
    expect(untransformed(container.querySelector<HTMLElement>('[data-testid="canvas-text"]')!)).toBe(true);
  });

  it("previews at FULL_FRAME while picking, and restores the camera on cancel", () => {
    const ref = createRef<CanvasHandle>();
    const flat = useEditor.getState().beats[1];
    const { container, queryByTestId } = render(<DeckCanvas ref={ref} flat={flat} />);
    act(() => ref.current!.seek(2));
    expect(world(container).style.transform).toContain("scale(2)");
    act(() => { useEditor.getState().selectAction(1); useEditor.getState().setCameraPick(true); });
    expect(queryByTestId("camera-pick-overlay")).not.toBeNull();
    expect(fullFrame(world(container).style.transform)).toBe(true);
    expect(fullFrame(notesWorld(container).style.transform)).toBe(true);
    // A seek while picking stays at full frame.
    act(() => ref.current!.seek(1.5));
    expect(fullFrame(world(container).style.transform)).toBe(true);
    act(() => useEditor.getState().setCameraPick(false));
    expect(queryByTestId("camera-pick-overlay")).toBeNull();
    expect(world(container).style.transform).toBe(cameraTransform(cameraAt(cameraEvents(doc), S + 1.5)));
  });

  it("entering pick mode during canvas playback pauses it and holds FULL_FRAME, even if a queued frame fires", () => {
    let frame: FrameRequestCallback | null = null;
    let nextId = 0;
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { frame = cb; return ++nextId; });
    const caf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    try {
      const ref = createRef<CanvasHandle>();
      const flat = useEditor.getState().beats[1];
      const { container } = render(<DeckCanvas ref={ref} flat={flat} />);
      act(() => ref.current!.seek(1.2));
      act(() => ref.current!.play());
      const t0 = performance.now();
      act(() => frame!(t0 + 300)); // a playing frame: mid-move, camera framing painted
      expect(world(container).style.transform).toContain("scale(");
      const playingId = nextId;
      act(() => { useEditor.getState().selectAction(1); useEditor.getState().setCameraPick(true); });
      expect(caf).toHaveBeenCalledWith(playingId); // playback paused
      expect(fullFrame(world(container).style.transform)).toBe(true);
      // A frame already in flight (closing over the pre-pick render) still paints the full frame.
      act(() => frame!(t0 + 400));
      expect(fullFrame(world(container).style.transform)).toBe(true);
      expect(fullFrame(notesWorld(container).style.transform)).toBe(true);
    } finally {
      raf.mockRestore();
      caf.mockRestore();
    }
  });

  it("shows no pick overlay when the selected action is not a camera", () => {
    const flat = useEditor.getState().beats[1];
    const { queryByTestId } = render(<DeckCanvas flat={flat} />);
    act(() => { useEditor.getState().selectAction(0); useEditor.getState().setCameraPick(true); });
    expect(queryByTestId("camera-pick-overlay")).toBeNull();
  });
});
