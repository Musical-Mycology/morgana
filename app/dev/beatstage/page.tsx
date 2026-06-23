"use client";
import { BeatStage } from "@/engine/authoring/BeatStage";
import type { Beat } from "@/engine/deck/types";

const beat: Beat = { id: "demo", timeline: [{ kind: "text", value: "Hello Morgana", in: "fade" }] };

export default function Page() {
  return <BeatStage sceneId="demo" beat={beat} />;
}
