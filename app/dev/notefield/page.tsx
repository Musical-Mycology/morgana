"use client";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { Scene } from "@/engine/deck/types";

// A ring is used for the static assertion because ring notes never expire — the settled
// state (animate=false → t = the beat's span) always has all `notes` sprites painted,
// which makes the e2e deterministic without sampling a mid-flight emitter.
const scene: Scene = {
  id: "s1",
  beats: [{ id: "b0", timeline: [
    { kind: "note_circle", pos: { x: 0.5, y: 0.5 }, width: 0.3, height: 0.3, hex: ["#d4a843"], notes: 6, speed: 4000 },
    { kind: "wait", ms: 2000 },
  ] }],
};

export default function Page() {
  return <BeatStage sceneId="s1" beat={scene.beats[0]} scene={scene} beatIndex={0} animate={false} />;
}
