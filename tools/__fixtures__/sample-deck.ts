import type { Scene } from "@/engine/deck/types";

// Generic, non-MM content — safe to commit publicly.
export const sampleScenes: Scene[] = [
  { id: "open", beats: [
    { id: "b1", timeline: [{ kind: "text", value: "A tiny show", in: "fade" }] },
    { id: "b2", timeline: [{ kind: "text", value: "two beats long.", in: "flyUp" }] },
  ] },
];
