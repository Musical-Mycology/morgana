"use client";
import { useEffect, useRef, useState } from "react";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { SlideTransport } from "@/engine/components/layouts/CinematicSlide";
import type { Action, Beat, Scene } from "@/engine/deck/types";
import { beatDuration } from "@/engine/authoring/beat-clock";

// A deliberately busy beat: SplitText-heavy lines, a counter, a moving media tile, and a dense
// note emitter — the worst case for the timed Player's per-frame forward seek (spec §1 gate).
const INS = ["letterFly", "wordUp", "typewriter", "blurIn"] as const;
const timeline: Action[] = [
  ...Array.from({ length: 8 }, (_, i): Action => ({ kind: "text", value: `Line ${i} of a fairly long benchmarking sentence`, in: INS[i % 4] })),
  { kind: "counter_show", pos: { x: 0.7, y: 0.2 }, value: 0, prefix: "$" },
  { kind: "counter_to", value: 1000000, durationMs: 2000 },
  { kind: "media", id: "m1", pos: { x: 0.8, y: 0.6 }, label: "Tile", durationMs: 600 },
  { kind: "media_move", id: "m1", to: { x: 0.3, y: 0.6 }, durationMs: 1500 },
  { kind: "note_emitter", color: "#ffcc66", pos: { x: 0.5, y: 0.8 }, dir: 0, var: 40, decay: 2000, freq: 12 },
  { kind: "wait", ms: 3000 },
];
const beat: Beat = { id: "bench", timeline };
const scene: Scene = { id: "bench", beats: [beat] };
const FRAMES = 600; // 10s at 60fps

export default function Page() {
  const transport = useRef<SlideTransport>(null);
  const [result, setResult] = useState("running");
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const dur = beatDuration(timeline);
      let total = 0, max = 0;
      for (let i = 0; i <= FRAMES; i++) {
        const t0 = performance.now();
        transport.current?.seek((i / FRAMES) * dur);
        const dt = performance.now() - t0;
        total += dt; max = Math.max(max, dt);
      }
      setResult(`mean=${(total / (FRAMES + 1)).toFixed(3)} max=${max.toFixed(3)}`);
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <>
      <BeatStage sceneId="bench" beat={beat} scene={scene} beatIndex={0} autoplay={false} transport={transport} />
      <output data-testid="bench-result" style={{ position: "fixed", bottom: 8, left: 8, zIndex: 10, color: "#fff" }}>{result}</output>
    </>
  );
}
