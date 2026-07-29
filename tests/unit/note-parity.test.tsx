import { describe, it, expect } from "vitest";
import { render, act } from "@testing-library/react";
import { createRef } from "react";
import { BeatStage } from "@/engine/authoring/BeatStage";
import { DeckCanvas, type CanvasHandle } from "@/components/editor/DeckCanvas";
import { useEditor } from "@/lib/editor/store";
import { beatDuration } from "@/engine/authoring/beat-clock";
import type { Scene, Action } from "@/engine/deck/types";
import type { DeckDoc } from "@/engine/deck-doc";

const emitter: Action = { kind: "note_emitter", color: "#00ff00", pos: { x: 0.4, y: 0.6 }, dir: 90, var: 30, decay: 1200, freq: 3 };
const ring: Action = { kind: "note_circle", pos: { x: 0.5, y: 0.5 }, width: 0.3, height: 0.2, hex: ["#fff", "#0ff"], notes: 5, speed: 3000 };
const scene: Scene = { id: "s", beats: [{ id: "b0", timeline: [emitter, ring, { kind: "wait", ms: 4000 }] }] };

const doc: DeckDoc = {
  version: 1, meta: { id: "d", title: "T" },
  scenes: [scene],
} as DeckDoc;

const painted = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('[data-testid="notefield"] span'))
    .filter((n) => n.style.display !== "none")
    .map((n) => `${n.style.left}|${n.style.top}|${n.style.opacity}|${n.style.transform}`)
    .sort();

describe("note rendering parity across entry points", () => {
  // Design spec §7 "Testing" (Parity): drive one scene through BOTH integration entry points —
  // DeckCanvas's seek() path and BeatStage's proxy-tween path — at the SAME sampled time, and
  // assert identical painted state (not merely an equal sprite count; a positional/opacity
  // divergence must fail loudly). The two hosts differ in shape (DeckCanvas: a 16:9 aspect-ratio
  // box; BeatStage: position:fixed;inset:0), but NoteField anchors sprites to a shared 16:9
  // `.notefield__stage` letterbox in container-query units specifically so normalized
  // left/top/opacity/transform strings come out identical across both mounts (§3 of the design
  // spec). This test is the in-scope echo of §7c's cross-path parity gate.
  it("DeckCanvas and BeatStage paint identical sprites for the same scene at the same time", () => {
    act(() => useEditor.getState().load(doc));
    const span = beatDuration(scene.beats[0].timeline);

    const canvasRef = createRef<CanvasHandle>();
    const flat = useEditor.getState().beats[0];
    const { container: canvasEl } = render(<DeckCanvas ref={canvasRef} flat={flat} />);
    act(() => canvasRef.current!.seek(span));

    const { container: beatEl } = render(
      <BeatStage sceneId="s" beat={scene.beats[0]} scene={scene} beatIndex={0} animate={false} contained />,
    );

    const canvasPainted = painted(canvasEl);
    const beatPainted = painted(beatEl);
    expect(beatPainted.length).toBeGreaterThan(0);
    expect(beatPainted).toEqual(canvasPainted);
  });

  it("BeatStage paints the settled state when not animating", () => {
    const { container } = render(
      <BeatStage sceneId="s" beat={scene.beats[0]} scene={scene} beatIndex={0} animate={false} contained />,
    );
    expect(painted(container).length).toBeGreaterThan(0);
  });
});
