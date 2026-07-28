"use client";
import { useRef, useState } from "react";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import type { Beat, Scene } from "@/engine/deck/types";

// A gate-bearing fixture (design spec §7b Task 10): "before gate" settles, then click_gate
// pauses playback, then "after gate" + a note_emitter fire together immediately past it — the
// exact shape that exposed the old proxy-timeline desync (notes racing ahead of a paused gate,
// or lagging behind once resumed). "Hello Morgana" is kept first so e2e/beatstage.spec.ts
// (which asserts on that exact line and that ArrowRight isn't hijacked) still passes unchanged.
const beat: Beat = {
  id: "demo",
  timeline: [
    { kind: "text", value: "Hello Morgana", in: "fade" },
    { kind: "text", value: "before gate", in: "fade" },
    { kind: "click_gate" },
    { kind: "text", value: "after gate", in: "fade" },
    { kind: "note_emitter", color: "#ffcc66", pos: { x: 0.5, y: 0.5 }, dir: 0, decay: 1500, freq: 6 },
    { kind: "wait", ms: 2000 },
  ],
};
const scene: Scene = { id: "demo", beats: [beat] };

export default function Page() {
  const transport = useRef<SlideTransport>(null);
  const [t, setT] = useState(0);
  return (
    <>
      <BeatStage sceneId="demo" beat={beat} scene={scene} beatIndex={0} transport={transport} />
      <input
        data-testid="scrub" type="range" min={0} max={5} step={0.1} value={t}
        onChange={(e) => {
          const v = Number(e.target.value);
          setT(v);
          // pause() before seek(): CinematicSlide autoplays on mount, and seek() alone does not
          // stop that ticker — its next real-time tick would otherwise immediately overwrite a
          // manual seek using a gate boundary captured back when play() started (the same
          // pause-then-seek order the protected test "seeking to a gate's exact time..." in
          // tests/unit/slide-render-at.test.tsx uses). A scrub control taking manual control of
          // the clock is exactly the case that should stop autoplay.
          transport.current?.pause();
          transport.current?.seek(v);
        }}
        style={{ position: "fixed", bottom: 12, left: 12, right: 12, zIndex: 10 }}
      />
    </>
  );
}
