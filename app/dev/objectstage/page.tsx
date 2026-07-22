"use client";
import { useEffect, useState } from "react";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { Scene } from "@/engine/deck/types";

// durationMs is widened well past the obj_reveal default (600ms per engine/deck/types.ts
// and engine/authoring/seek.ts's actionDuration) so the animated e2e test has a wide,
// reliably-observable window in which to sample a genuine mid-tween opacity value.
const scene: Scene = {
  id: "s1",
  objects: [{ id: "a", kind: "shape", shape: "rect", transform: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, name: "box" }],
  beats: [{ id: "b0", timeline: [{ kind: "obj_reveal", target: "a", in: "fade", durationMs: 2000 }] }],
};

export default function Page() {
  // Start static so the object paints immediately for a deterministic screenshot,
  // then flip animate on via ?animate=1 for the playback assertion.
  const [animate, setAnimate] = useState(false);
  useEffect(() => { setAnimate(new URLSearchParams(location.search).get("animate") === "1"); }, []);
  return <BeatStage sceneId="s1" beat={scene.beats[0]} scene={scene} beatIndex={0} animate={animate} />;
}
