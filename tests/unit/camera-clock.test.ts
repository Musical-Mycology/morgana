import { describe, expect, test } from "vitest";
import {
  CAMERA_DEFAULT_MS, FULL_FRAME, cameraAt, cameraEase, cameraEvents, cameraTransform, clampFraming,
  type CameraEvent,
} from "@/engine/authoring/camera-clock";
import { power2InOut } from "@/engine/authoring/art-clock";
import type { Action } from "@/engine/deck/types";
import type { DeckDoc } from "@/engine/deck-doc";

const deck = (scenes: DeckDoc["scenes"]): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes });
const cam = (to: Extract<Action, { kind: "camera" }>["to"], durationMs?: number, ease?: "inOut" | "in" | "out" | "linear"): Action =>
  ({ kind: "camera", to, ...(durationMs !== undefined ? { durationMs } : {}), ...(ease ? { ease } : {}) });
const ev = (start: number, duration: number, to: CameraEvent["to"], ease: CameraEvent["ease"] = "linear"): CameraEvent => ({ start, duration, to, ease });

describe("clampFraming", () => {
  test("keeps the view inside the stage", () => {
    expect(clampFraming({ x: 0, y: 1, zoom: 2 })).toEqual({ x: 0.25, y: 0.75, zoom: 2 });
  });
  test("zoom is clamped to [1, 8]", () => {
    expect(clampFraming({ x: 0.5, y: 0.5, zoom: 0.5 }).zoom).toBe(1);
    expect(clampFraming({ x: 0.5, y: 0.5, zoom: 10 }).zoom).toBe(8);
  });
  test("at zoom 1, x and y are pinned to 0.5", () => {
    expect(clampFraming({ x: 0.1, y: 0.9, zoom: 1 })).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
  });
});

describe("cameraEase", () => {
  test("inOut", () => {
    expect(cameraEase("inOut", 0.5)).toBeCloseTo(0.5);
    expect(cameraEase("inOut", 0.25)).toBe(power2InOut(0.25));
  });
  test("in / out / linear", () => {
    expect(cameraEase("in", 0.5)).toBeCloseTo(0.125);
    expect(cameraEase("out", 0.5)).toBeCloseTo(0.875);
    expect(cameraEase("linear", 0.37)).toBe(0.37);
  });
});

describe("cameraEvents", () => {
  const D = deck([{ id: "s", beats: [
    { id: "a", timeline: [{ kind: "wait", ms: 4000 }] },
    { id: "b", timeline: [{ kind: "wait", ms: 1500 }, cam({ zoom: 2 }), { kind: "wait", ms: 500 }] },
  ] }]);

  test("start is scene start + beat start + window start", () => {
    const [e] = cameraEvents(D);
    expect(e.start).toBeCloseTo(5.5);
  });
  test("defaults: 1.2 s and inOut", () => {
    expect(CAMERA_DEFAULT_MS).toBe(1200);
    expect(cameraEvents(D)).toEqual([{ start: 5.5, duration: 1.2, to: { zoom: 2 }, ease: "inOut" }]);
  });
  test("explicit duration and ease", () => {
    const d = deck([{ id: "s", beats: [{ id: "a", timeline: [cam({ x: 0.3 }, 500, "out")] }] }]);
    expect(cameraEvents(d)).toEqual([{ start: 0, duration: 0.5, to: { x: 0.3 }, ease: "out" }]);
  });
  test("an action past a pinned scene's cut produces no event", () => {
    const d = deck([{ id: "s", durationSec: 2, beats: [{ id: "a", timeline: [cam({ zoom: 2 }), { kind: "wait", ms: 3000 }, cam({ zoom: 3 })] }] }]);
    expect(cameraEvents(d).map((e) => e.to.zoom)).toEqual([2]);
  });
  test("a beat starting past a pinned scene's cut produces no event", () => {
    const d = deck([{ id: "s", durationSec: 2, beats: [
      { id: "a", timeline: [{ kind: "wait", ms: 3000 }] },
      { id: "b", timeline: [cam({ zoom: 3 })] },
    ] }]);
    expect(cameraEvents(d)).toEqual([]);
  });
});

describe("cameraAt", () => {
  test("no events is FULL_FRAME", () => {
    expect(cameraAt([], 5)).toEqual(FULL_FRAME);
  });
  test("zoom interpolates in log space; x/y stay centred", () => {
    const evs = [ev(0, 2, { zoom: 4 })];
    const mid = cameraAt(evs, 1);
    expect(mid.zoom).toBeCloseTo(2);
    expect(mid.x).toBeCloseTo(0.5);
    expect(mid.y).toBeCloseTo(0.5);
    expect(cameraAt(evs, 2).zoom).toBeCloseTo(4);
    expect(cameraAt(evs, 10).zoom).toBeCloseTo(4);
  });
  test("a pan is clamped at its end", () => {
    const end = cameraAt([ev(0, 1, { x: 0.8, zoom: 2 })], 5);
    expect(end.x).toBeCloseTo(0.75);
    expect(end.zoom).toBeCloseTo(2);
  });
  test("omitted fields are kept from the previous framing", () => {
    const f = cameraAt([ev(0, 0, { zoom: 3 }), ev(1, 0, { x: 0.6 })], 5);
    expect(f.zoom).toBeCloseTo(3);
    expect(f.x).toBeCloseTo(0.6);
  });
  test("a 0 ms cut back to zoom 1 gives FULL_FRAME from that instant", () => {
    const evs = [ev(0, 0, { zoom: 3, x: 0.6 }), ev(2, 0, { zoom: 1 })];
    expect(cameraAt(evs, 1.999).zoom).toBeCloseTo(3);
    expect(cameraAt(evs, 2)).toEqual(FULL_FRAME);
  });
  test("Review Focus #1: an interrupted move continues without a jump", () => {
    const evs = [ev(0, 2, { zoom: 4 }), ev(1, 1, { zoom: 1 })];
    const before = cameraAt(evs, 1 - 1e-9);
    const at = cameraAt(evs, 1);
    expect(Math.abs(before.zoom - at.zoom)).toBeLessThan(1e-6);
    expect(at.zoom).toBeCloseTo(2); // A's T=1 value; B starts from it
    expect(cameraAt(evs, 1.5).zoom).toBeLessThan(2);
    expect(cameraAt(evs, 1.5).zoom).toBeGreaterThan(1);
    expect(cameraAt(evs, 2).zoom).toBeCloseTo(1);
  });
  test("Review Focus #2: a framing holds into a later scene with no camera actions", () => {
    const d = deck([
      { id: "s1", beats: [{ id: "a", timeline: [cam({ zoom: 2 }, 0), { kind: "wait", ms: 1000 }] }] },
      { id: "s2", beats: [{ id: "b", timeline: [{ kind: "wait", ms: 1000 }] }] },
      { id: "s3", beats: [{ id: "c", timeline: [{ kind: "wait", ms: 1000 }] }] },
    ]);
    const f = cameraAt(cameraEvents(d), 2.5);
    expect(f.zoom).toBeCloseTo(2);
  });
});

describe("cameraTransform", () => {
  test("FULL_FRAME is none", () => {
    expect(cameraTransform(FULL_FRAME)).toBe("none");
  });
  test("translate/scale from framing", () => {
    expect(cameraTransform({ x: 0.25, y: 0.75, zoom: 2 })).toBe("translate(0%, -100%) scale(2)");
  });
  test("never emits -0", () => {
    const s = cameraTransform({ x: 0.5, y: 0.5, zoom: 2 });
    expect(s).toBe("translate(-50%, -50%) scale(2)");
    expect(cameraTransform({ x: 0.25, y: 0.75, zoom: 2 })).not.toContain("-0%");
    expect(cameraTransform({ x: 0.5, y: 0.25, zoom: 2 })).not.toMatch(/(^|[^\d.])-0(?![\d.])/);
  });
});
