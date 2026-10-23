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

test("runtime.art forwards the entry transition's clip options to ArtStage.show", () => {
  const calls: unknown[][] = [];
  const art = { current: { show: (...a: unknown[]) => calls.push(a), apply: () => {}, snap: () => {}, renderState: () => {} } as ArtStageHandle };
  const rt = makeAuthoringRuntime({ art, setNight: () => {}, resolveEntry: () => [], resolveEnd: () => [], onGate: () => {}, onWaiting: () => {} });
  rt.art(["media:a.mp4"], "fade", 500, { "media:a.mp4": { in: 1 } });
  expect(calls).toEqual([[["media:a.mp4"], "fade", 500, { "media:a.mp4": { in: 1 } }]]);
});
