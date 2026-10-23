import { expect, test } from "vitest";
import { lintDeck } from "@/lib/editor/lint";
import type { DeckDoc } from "@/engine/deck-doc";
import type { Action, ArtTransition } from "@/engine/deck/types";

type Cam = Extract<Action, { kind: "camera" }>;
const cam = (zoom: number, durationMs?: number): Cam => ({ kind: "camera", to: { zoom }, ...(durationMs !== undefined ? { durationMs } : {}) });
const wait = (ms: number): Action => ({ kind: "wait", ms });
const deck = (timeline: Action[], art?: ArtTransition): DeckDoc => ({
  version: 1, meta: { id: "d", title: "D" },
  scenes: [{ id: "s", beats: [{ id: "a", art, timeline }] }],
});
const rule = (d: DeckDoc, r: string) => lintDeck(d).filter((i) => i.rule === r);

const OVERLAP = "camera move starts before the previous one finishes (interrupts it)";

test("camera-overlap fires at the later action when it interrupts a running move", () => {
  const d = deck([cam(2, 1000), wait(400), cam(3, 500), wait(1000)]);
  expect(rule(d, "camera-overlap")).toMatchObject([{ severity: "warning", at: { sceneIdx: 0, beatIdx: 0, actionIdx: 2 }, message: OVERLAP }]);
});

test("camera-overlap: back-to-back moves, a cut after a finished move, and same-start merges are clean", () => {
  expect(rule(deck([cam(2, 1200), wait(1200), cam(3, 1200)]), "camera-overlap")).toEqual([]);
  expect(rule(deck([cam(2, 1000), wait(2000), cam(1, 0), wait(100)]), "camera-overlap")).toEqual([]);
  expect(rule(deck([cam(2, 1000), cam(3, 1000), wait(100)]), "camera-overlap")).toEqual([]);
});

test("camera-overlap: the first move never warns, and a cut cannot be interrupted", () => {
  expect(rule(deck([cam(2), wait(100)]), "camera-overlap")).toEqual([]);
  expect(rule(deck([cam(2, 0), wait(100), cam(3, 500), wait(100)]), "camera-overlap")).toEqual([]);
});

const SOFT = (z: string) => `zoom ${z}× on built-in panel art will look soft — use higher-resolution art`;

test("camera-zoom-soft fires for zoom > 2 over a built-in panel key", () => {
  const d = deck([cam(4, 0), wait(100)], { to: "2.01", mode: "cut" });
  expect(rule(d, "camera-zoom-soft")).toMatchObject([{ severity: "warning", at: { sceneIdx: 0, beatIdx: 0, actionIdx: 0 }, message: SOFT("4.0") }]);
});

test("camera-zoom-soft: zoom 2, uploaded media, and no art are clean", () => {
  expect(rule(deck([cam(2, 0), wait(100)], { to: "2.01", mode: "cut" }), "camera-zoom-soft")).toEqual([]);
  expect(rule(deck([cam(4, 0), wait(100)], { to: "media:a.png", mode: "cut" }), "camera-zoom-soft")).toEqual([]);
  expect(rule(deck([cam(4, 0), wait(100)]), "camera-zoom-soft")).toEqual([]);
});

test("camera-zoom-soft uses the zoom the move reaches, and art in play at that time", () => {
  // Art switches to a panel only after the move has finished.
  const d = deck([cam(4, 500), wait(1000), { kind: "art", art: { to: "2.01", mode: "cut" } }, wait(100)], { to: "media:a.png", mode: "cut" });
  expect(rule(d, "camera-zoom-soft")).toEqual([]);
  const d2 = deck([{ kind: "art", art: { to: "2.01", mode: "cut" } }, cam(4, 500), wait(1000)], { to: "media:a.png", mode: "cut" });
  expect(rule(d2, "camera-zoom-soft")).toMatchObject([{ message: SOFT("4.0") }]);
});

test("camera rules are skipped on a structurally invalid deck", () => {
  const d = deck([cam(4, 0), wait(100)], { to: "2.01", mode: "cut" });
  (d.scenes[0] as unknown as Record<string, unknown>).durationSec = -1;
  expect(lintDeck(d).some((i) => i.rule === "structure")).toBe(true);
  expect(lintDeck(d).filter((i) => i.rule.startsWith("camera-"))).toEqual([]);
});
