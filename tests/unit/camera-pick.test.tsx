import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CameraPick } from "@/components/editor/CameraPick";
import { DeckCanvas } from "@/components/editor/DeckCanvas";
import { Inspector } from "@/components/editor/Inspector";
import { useEditor } from "@/lib/editor/store";
import { clampFraming } from "@/engine/authoring/camera-clock";
import type { DeckDoc } from "@/engine/deck-doc";

// jsdom's fireEvent.pointerMove drops clientX/clientY; dispatch a MouseEvent of the pointer type.
function firePointer(target: EventTarget, type: "pointermove" | "pointerdown", clientX: number, clientY: number) {
  target.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true }));
}
const W = 1000, H = 500;
function stubRect(el: HTMLElement) {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: W, bottom: H, width: W, height: H, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

afterEach(cleanup);

describe("CameraPick", () => {
  it("draws the zoom-sized view rect centred on the pointer, clamped like clampFraming", () => {
    render(<CameraPick zoom={4} onPick={() => {}} onCancel={() => {}} />);
    const overlay = screen.getByTestId("camera-pick-overlay");
    stubRect(overlay);
    expect(overlay.style.cursor).toBe("crosshair");
    act(() => firePointer(overlay, "pointermove", 0.9 * W, 0.1 * H)); // continuous event: flush the update
    const rect = screen.getByTestId("camera-pick-rect");
    expect(rect.style.width).toBe("25%");
    expect(rect.style.height).toBe("25%");
    // Centre clamped to x = 0.875, y = 0.125: left = (0.875 − 0.125)·100, top = (0.125 − 0.125)·100.
    expect(rect.style.left).toBe("75%");
    expect(rect.style.top).toBe("0%");
    expect(rect.style.outline).toMatch(/2px/);
  });

  it("a click calls onPick once with the clamped centre", () => {
    const onPick = vi.fn();
    render(<CameraPick zoom={4} onPick={onPick} onCancel={() => {}} />);
    const overlay = screen.getByTestId("camera-pick-overlay");
    stubRect(overlay);
    act(() => firePointer(overlay, "pointermove", 0.9 * W, 0.1 * H)); // continuous event: flush the update
    fireEvent.click(overlay, { clientX: 0.9 * W, clientY: 0.1 * H });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith({ x: 0.875, y: 0.125 });
  });

  it("rounding never lands outside the clamp (zoom 7, picked at the corners)", () => {
    const onPick = vi.fn();
    render(<CameraPick zoom={7} onPick={onPick} onCancel={() => {}} />);
    const overlay = screen.getByTestId("camera-pick-overlay");
    stubRect(overlay);
    fireEvent.click(overlay, { clientX: 0.01 * W, clientY: 0.99 * H });
    fireEvent.click(overlay, { clientX: 0.99 * W, clientY: 0.01 * H });
    const m = 0.5 / 7;
    for (const [p] of onPick.mock.calls as [{ x: number; y: number }][]) {
      for (const v of [p.x, p.y]) {
        expect(v).toBeGreaterThanOrEqual(m);
        expect(v).toBeLessThanOrEqual(1 - m);
        expect(Math.round(v * 1e4) / 1e4).toBe(v); // still 4-decimal tidy
      }
      expect(clampFraming({ zoom: 7, ...p })).toEqual({ zoom: 7, ...p });
    }
    expect(onPick).toHaveBeenCalledTimes(2);
  });

  it("Esc calls onCancel and stops propagation (the editor's window Escape handler never sees it)", () => {
    const onCancel = vi.fn();
    const windowEsc = vi.fn();
    window.addEventListener("keydown", windowEsc);
    try {
      render(<CameraPick zoom={2} onPick={() => {}} onCancel={onCancel} />);
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(windowEsc).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", windowEsc);
    }
  });
});

const doc = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [
  { id: "s1", beats: [{ id: "b1", timeline: [
    { kind: "camera", to: { zoom: 4, x: 0.5, y: 0.5 }, durationMs: 800, ease: "out" },
    { kind: "wait", ms: 1000 },
  ] }] },
] }) as DeckDoc;

describe("Inspector: Pick on canvas", () => {
  beforeEach(() => act(() => { useEditor.getState().load(doc()); useEditor.getState().selectAction(0); }));

  it("the Camera action shows a Pick on canvas button that enters pick mode", () => {
    render(<Inspector />);
    const btn = screen.getByTestId("camera-pick");
    expect(btn.textContent).toMatch(/Pick on canvas/);
    fireEvent.click(btn);
    expect(useEditor.getState().cameraPick).toBe(true);
  });

  it("other actions show no pick button", () => {
    act(() => useEditor.getState().selectAction(1));
    render(<Inspector />);
    expect(screen.queryByTestId("camera-pick")).toBeNull();
  });

  it("a canvas click writes `to` as one object ({...to, x, y}) in a single undo step and leaves pick mode", () => {
    render(<><Inspector /><DeckCanvas flat={useEditor.getState().beats[0]} /></>);
    fireEvent.click(screen.getByTestId("camera-pick"));
    const overlay = screen.getByTestId("camera-pick-overlay");
    stubRect(overlay);
    const before = useEditor.getState().past.length;
    fireEvent.click(overlay, { clientX: 0.9 * W, clientY: 0.1 * H });
    const s = useEditor.getState();
    expect(s.doc!.scenes[0].beats[0].timeline[0]).toEqual({ kind: "camera", to: { zoom: 4, x: 0.875, y: 0.125 }, durationMs: 800, ease: "out" });
    expect(s.past.length).toBe(before + 1);
    expect(s.cameraPick).toBe(false);
    expect(screen.queryByTestId("camera-pick-overlay")).toBeNull();
    act(() => s.undo());
    expect(useEditor.getState().doc!.scenes[0].beats[0].timeline[0]).toMatchObject({ to: { zoom: 4, x: 0.5, y: 0.5 } });
  });

  it("a no-op pick (same x/y as `to`) writes nothing — no undo entry — and leaves pick mode", () => {
    render(<><Inspector /><DeckCanvas flat={useEditor.getState().beats[0]} /></>);
    fireEvent.click(screen.getByTestId("camera-pick"));
    const overlay = screen.getByTestId("camera-pick-overlay");
    stubRect(overlay);
    const before = useEditor.getState();
    fireEvent.click(overlay, { clientX: 0.5 * W, clientY: 0.5 * H }); // to is already {x 0.5, y 0.5}
    const s = useEditor.getState();
    expect(s.past.length).toBe(before.past.length);
    expect(s.doc).toBe(before.doc);
    expect(s.cameraPick).toBe(false);
  });

  it("Esc on the canvas cancels pick mode without writing", () => {
    render(<><Inspector /><DeckCanvas flat={useEditor.getState().beats[0]} /></>);
    fireEvent.click(screen.getByTestId("camera-pick"));
    const before = useEditor.getState().past.length;
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(useEditor.getState().cameraPick).toBe(false);
    expect(useEditor.getState().past.length).toBe(before);
    expect(screen.queryByTestId("camera-pick-overlay")).toBeNull();
  });

  it("changing the selection leaves pick mode", () => {
    act(() => useEditor.getState().setCameraPick(true));
    act(() => useEditor.getState().selectAction(1));
    expect(useEditor.getState().cameraPick).toBe(false);
  });
});
