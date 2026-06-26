import { expect, test } from "vitest";
import { actionDuration, isSeekable, beatTimeline, renderBeatAt } from "@/engine/authoring/seek";
import type { Action } from "@/engine/deck/types";

test("actionDuration mirrors the engine's reservations", () => {
  expect(actionDuration({ kind: "wait", ms: 400 })).toBeCloseTo(0.4);
  expect(actionDuration({ kind: "media", id: "m", pos: { x: 0, y: 0 }, durationMs: 600 })).toBeCloseTo(0.6);
  expect(actionDuration({ kind: "fade_out", durationMs: 500 })).toBeCloseTo(0.5);
  expect(actionDuration({ kind: "text", value: "hi", in: "fade" })).toBeCloseTo(0.8, 1);
});

test("seekability: tween effects are seekable, particles are not", () => {
  expect(isSeekable({ kind: "text", value: "x", in: "fade" })).toBe(true);
  expect(isSeekable({ kind: "art", art: { to: "3.02", mode: "fade" } })).toBe(true);
  expect(isSeekable({ kind: "note_emitter", color: "#fff", pos: { x: 0, y: 0 }, dir: 0, decay: 1000, freq: 5 })).toBe(false);
});

test("beatTimeline assigns sequential [start,end) windows", () => {
  const tl: Action[] = [
    { kind: "text", value: "a", in: "fade" },           // dur 0.8 → start 0
    { kind: "wait", ms: 200 },                            // dur 0.2 → start 0.8
    { kind: "art", art: { to: "3.02", mode: "fade" } },   // dur 0   → start 1.0
  ];
  const win = beatTimeline(tl);
  expect(win[0].start).toBeCloseTo(0);
  expect(win[1].start).toBeCloseTo(0.8, 1);
  expect(win[2].start).toBeCloseTo(1.0, 1);   // art has 0 duration but starts at 1.0
});

test("a text action with pos renders absolutely at its normalized point", () => {
  const host = document.createElement("div");
  renderBeatAt([{ kind: "text", value: "Placed", in: "fade", pos: { x: 0.5, y: 0.3 } }], 99, { textHost: host, art: null });
  const p = host.querySelector("p")!;
  expect(p.style.position).toBe("absolute");
  expect(p.style.left).toBe("50%");
  expect(p.style.top).toBe("30%");
});
