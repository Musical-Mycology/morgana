import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRef } from "react";
import { BeatStage } from "@/engine/authoring/BeatStage";
import { NoteField, type NoteFieldHandle } from "@/engine/components/NoteField";
import { noteFieldStateAt } from "@/engine/components/effects/note-state";
import type { Scene, Action } from "@/engine/deck/types";

const emitter: Action = { kind: "note_emitter", color: "#00ff00", pos: { x: 0.4, y: 0.6 }, dir: 90, var: 30, decay: 1200, freq: 3 };
const ring: Action = { kind: "note_circle", pos: { x: 0.5, y: 0.5 }, width: 0.3, height: 0.2, hex: ["#fff", "#0ff"], notes: 5, speed: 3000 };
const scene: Scene = { id: "s", beats: [{ id: "b0", timeline: [emitter, ring, { kind: "wait", ms: 4000 }] }] };

const painted = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('[data-testid="notefield"] span'))
    .filter((n) => n.style.display !== "none")
    .map((n) => `${n.style.left}|${n.style.top}|${n.style.opacity}|${n.style.transform}`)
    .sort();

describe("note rendering parity across entry points", () => {
  it("a standalone NoteField and the reducer agree at sampled times", () => {
    const ref = createRef<NoteFieldHandle>();
    const { container } = render(<NoteField ref={ref} />);
    for (const t of [0, 0.4, 1.1, 2.7, 3.9]) {
      ref.current!.renderAt(scene, 0, t);
      // NoteField paints every sprite the reducer returns (opacity is encoded as a CSS value,
      // never as DOM absence) — so parity is against the full sprite list, not an opacity>0
      // subset. At t=0 one emitter sprite is born with an exact opacity of 0 (its birth-tween
      // value backOut2(0) === 0); it is still painted (display:block, opacity:"0"), so filtering
      // it out here would make this assertion disagree with NoteField's actual, documented
      // behavior. See tests/unit/note-field.test.tsx for the pooling contract this mirrors.
      expect(painted(container).length).toBe(noteFieldStateAt(scene, 0, t).length);
    }
  });

  it("BeatStage paints the settled state when not animating", () => {
    const { container } = render(
      <BeatStage sceneId="s" beat={scene.beats[0]} scene={scene} beatIndex={0} animate={false} contained />,
    );
    expect(painted(container).length).toBeGreaterThan(0);
  });
});
