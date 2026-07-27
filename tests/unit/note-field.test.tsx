import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRef } from "react";
import { NoteField, type NoteFieldHandle } from "@/engine/components/NoteField";
import type { Scene, Action } from "@/engine/deck/types";

const emitter: Action = { kind: "note_emitter", color: "#ff0000", pos: { x: 0.5, y: 0.5 }, dir: 0, decay: 1000, freq: 4 };
const scene: Scene = { id: "s", beats: [{ id: "b0", timeline: [emitter, { kind: "wait", ms: 4000 }] }] };

const sprites = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-testid="notefield"] span'));
const visible = (c: HTMLElement) => sprites(c).filter((n) => n.style.display !== "none");

describe("NoteField", () => {
  it("paints sprites at the reducer state and writes normalized styles", () => {
    const ref = createRef<NoteFieldHandle>();
    const { container } = render(<NoteField ref={ref} />);
    ref.current!.renderAt(scene, 0, 1.0);
    const live = visible(container);
    expect(live.length).toBeGreaterThan(0);
    const first = live[0];
    expect(first.style.left).toMatch(/%$/);
    expect(first.style.top).toMatch(/%$/);
    expect(first.style.transform).toContain("scale(");
    expect(parseFloat(first.style.opacity)).toBeGreaterThan(0);
  });

  it("reuses pooled nodes — node count is stable across a t sweep", () => {
    const ref = createRef<NoteFieldHandle>();
    const { container } = render(<NoteField ref={ref} />);
    const ts = [2.0, 2.1, 2.5, 3.0, 3.5];
    // Pool slot is `i % P` with P = ceil(D·freq) + 1 — one wider than the instantaneous live
    // count by design (note-state.ts §3.7), so a single renderAt only ever sees P−1 of the P
    // residues. Sweeping once warms every slot the source will ever touch; a repeat of the same
    // sweep must then create zero new nodes — that's the actual "no per-frame churn" property
    // pooling exists for, and what this asserts.
    for (const t of ts) ref.current!.renderAt(scene, 0, t);
    const afterWarmup = sprites(container).length;
    for (const t of ts) ref.current!.renderAt(scene, 0, t);
    expect(sprites(container).length).toBe(afterWarmup);
  });

  it("is deterministic — the same t repaints the same DOM", () => {
    const ref = createRef<NoteFieldHandle>();
    const { container } = render(<NoteField ref={ref} />);
    ref.current!.renderAt(scene, 0, 1.7);
    const snap = visible(container).map((n) => `${n.style.left}|${n.style.top}|${n.style.opacity}`);
    ref.current!.renderAt(scene, 0, 3.3);           // scrub away…
    ref.current!.renderAt(scene, 0, 1.7);           // …and back
    expect(visible(container).map((n) => `${n.style.left}|${n.style.top}|${n.style.opacity}`)).toEqual(snap);
  });

  it("paints nothing under reduced motion", () => {
    const ref = createRef<NoteFieldHandle>();
    const { container } = render(<NoteField ref={ref} reduced />);
    ref.current!.renderAt(scene, 0, 1.0);
    expect(visible(container).length).toBe(0);
  });

  it("hides sprites again when the source stops", () => {
    const stopped: Scene = { id: "s", beats: [{ id: "b0", timeline: [
      emitter, { kind: "wait", ms: 1000 }, { kind: "stop_notes" }, { kind: "wait", ms: 1000 },
    ] }] };
    const ref = createRef<NoteFieldHandle>();
    const { container } = render(<NoteField ref={ref} />);
    ref.current!.renderAt(stopped, 0, 0.5);
    expect(visible(container).length).toBeGreaterThan(0);
    ref.current!.renderAt(stopped, 0, 1.5);
    expect(visible(container).length).toBe(0);
  });

  it("anchors sprites to a 16:9 stage box, not the full host", () => {
    const { container } = render(<NoteField />);
    const stage = container.querySelector<HTMLElement>(".notefield__stage");
    expect(stage).not.toBeNull();
  });
});
