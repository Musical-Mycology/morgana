import { expect, test } from "vitest";
import { lintDeck } from "@/lib/editor/lint";
import type { DeckDoc } from "@/engine/deck-doc";
import type { Action } from "@/engine/deck/types";

const deck = (timeline: Action[], durationSec?: number): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" },
  scenes: [{ id: "s", ...(durationSec ? { durationSec } : {}), beats: [{ id: "a", timeline }] }] });
const rule = (d: DeckDoc, r: string) => lintDeck(d).filter((i) => i.rule === r);
const credits = (durationMs: number): Action => ({ kind: "credits", items: [{ role: "A", names: ["B"] }], durationMs });

test("credits-fast: (estimated blockH + areaH) at 1080p over the duration above 90 px/s", () => {
  // (0.036 + 0.05 + 0.63) × 1080 = 773.28 px; over 4 s = 193 px/s → at least 8600 ms.
  expect(rule(deck([credits(4000)]), "credits-fast")).toMatchObject([{ severity: "warning", at: { sceneIdx: 0, beatIdx: 0, actionIdx: 0 },
    message: "credits roll at 193 px/s at 1080p — hard to read; use durationMs ≥ 8600" }]);
  expect(rule(deck([credits(9000)]), "credits-fast")).toEqual([]);
});

test("draw-long: a draw line whose introDuration is above 8 s", () => {
  const draw = (n: number, speed?: number): Action => ({ kind: "text", value: "x".repeat(n), in: "draw", ...(speed ? { speed } : {}) });
  expect(rule(deck([draw(94)]), "draw-long")).toMatchObject([{ at: { actionIdx: 0 }, message: "draw line takes 8.0s — shorten it or raise its speed" }]);
  expect(rule(deck([draw(93)]), "draw-long")).toEqual([]);
  expect(rule(deck([draw(94, 2)]), "draw-long")).toEqual([]);
  expect(rule(deck([{ kind: "text", value: "x".repeat(300), in: "fade" }]), "draw-long")).toEqual([]);
  // A draw append fragment reveals (and is timed) as fade — draw-long skips it.
  expect(rule(deck([draw(5), { kind: "text", value: "x".repeat(300), in: "draw", append: true }]), "draw-long")).toEqual([]);
});

test("fade-unfinished: a screen fade still running at the deck's end", () => {
  const fade: Action = { kind: "screen_fade", to: 1 };
  expect(rule(deck([fade, { kind: "wait", ms: 500 }]), "fade-unfinished")).toMatchObject([{ at: { actionIdx: 0 },
    message: "screen fade is still running at the end of the deck — it ends 0.5s after the last frame" }]);
  expect(rule(deck([fade, { kind: "wait", ms: 1000 }]), "fade-unfinished")).toEqual([]);
  // Cut off by a pinned scene: never reached, never warned.
  expect(rule(deck([{ kind: "wait", ms: 2000 }, fade, { kind: "wait", ms: 100 }], 1), "fade-unfinished")).toEqual([]);
});
