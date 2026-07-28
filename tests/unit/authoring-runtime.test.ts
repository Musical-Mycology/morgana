import { expect, test } from "vitest";
import { createRef } from "react";
import { makeAuthoringRuntime } from "@/engine/authoring/runtime";
import type { ArtStageHandle } from "@/engine/components/ArtStage";

const runtime = () => makeAuthoringRuntime({
  art: createRef<ArtStageHandle>(),
  setNight: () => {},
  resolveEntry: () => [],
  resolveEnd: () => [],
  onGate: () => {},
  onWaiting: () => {},
});

test("the authoring runtime carries no note-source hooks", () => {
  const rt = runtime() as unknown as Record<string, unknown>;
  for (const k of ["cue", "emitter", "noteCircle", "stopNotes", "stopCircles"]) {
    expect(k in rt).toBe(false);
  }
});

test("the authoring runtime still carries the art / gate / nav surface", () => {
  const rt = runtime() as unknown as Record<string, unknown>;
  for (const k of ["art", "applyArt", "setNightlight", "onGate", "revealArrows", "pulseArrow", "onWaiting", "resolveEntry", "resolveEnd", "jumpTo"]) {
    expect(typeof rt[k]).toBe("function");
  }
});
