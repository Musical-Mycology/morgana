import { expect, test } from "vitest";
import { FADE_DEFAULT_COLOR, fadeAt, fadeEvents, type FadeEvent } from "@/engine/authoring/fade-clock";
import type { Action } from "@/engine/deck/types";
import type { DeckDoc } from "@/engine/deck-doc";

const deck = (scenes: DeckDoc["scenes"]): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes });
const fade = (to: number, durationMs?: number, color?: string): Action =>
  ({ kind: "screen_fade", to, ...(durationMs !== undefined ? { durationMs } : {}), ...(color ? { color } : {}) });
const wait = (ms: number): Action => ({ kind: "wait", ms });
const ev = (start: number, duration: number, to: number, color = "#000"): Omit<FadeEvent, "at"> => ({ start, duration, to, color });
const noAt = (events: FadeEvent[]) => events.map(({ at: _at, ...rest }) => rest);

test("fadeEvents: deck-time starts across beats and scenes, defaults 1000 ms and #000", () => {
  const d = deck([
    { id: "s0", beats: [{ id: "a", timeline: [wait(1000)] }, { id: "b", timeline: [wait(500), fade(1)] }] },
    { id: "s1", beats: [{ id: "c", timeline: [fade(0.5, 0, "#fff"), wait(100)] }] },
  ]);
  expect(noAt(fadeEvents(d))).toEqual([ev(1.5, 1, 1), ev(1.5, 0, 0.5, "#fff")]);
});

test("fadeEvents: each event carries the position of its source action", () => {
  const d = deck([
    { id: "s0", beats: [{ id: "a", timeline: [wait(1000)] }, { id: "b", timeline: [wait(500), fade(1)] }] },
    { id: "s1", beats: [{ id: "c", timeline: [wait(100), wait(100), fade(0.5, 0, "#fff")] }] },
  ]);
  expect(fadeEvents(d).map((e) => e.at)).toEqual([
    { sceneIdx: 0, beatIdx: 1, actionIdx: 1 },
    { sceneIdx: 1, beatIdx: 0, actionIdx: 2 },
  ]);
});

test("fadeEvents: the reach rule — a fade past a pinned scene's cut is never reached", () => {
  expect(fadeEvents(deck([{ id: "s", durationSec: 1, beats: [{ id: "a", timeline: [wait(2000), fade(1)] }] }]))).toEqual([]);
});

test("fadeAt: none → level 0, #000; linear; holds after the end, across scenes", () => {
  expect(fadeAt([], 5)).toEqual({ level: 0, color: FADE_DEFAULT_COLOR });
  const at = { sceneIdx: 0, beatIdx: 0, actionIdx: 0 };
  const e = [{ ...ev(2, 1, 1), at }];
  expect(fadeAt(e, 1.9).level).toBe(0);
  expect(fadeAt(e, 2.5).level).toBeCloseTo(0.5, 12);
  expect(fadeAt(e, 30).level).toBe(1);
  const d = deck([
    { id: "s0", beats: [{ id: "a", timeline: [fade(1, 500), wait(1000)] }] },
    { id: "s1", beats: [{ id: "b", timeline: [wait(1000)] }] },
    { id: "s2", beats: [{ id: "c", timeline: [wait(1000)] }] },
  ]);
  expect(fadeAt(fadeEvents(d), 2.5).level).toBe(1);
});

const withAt = (...es: Omit<FadeEvent, "at">[]): FadeEvent[] =>
  es.map((e, i) => ({ ...e, at: { sceneIdx: 0, beatIdx: 0, actionIdx: i } }));

test("fadeAt: an interrupting fade continues from the level in effect (no jump)", () => {
  const e = withAt(ev(0, 2, 1), ev(1, 1, 0));
  expect(fadeAt(e, 1 - 1e-9).level).toBeCloseTo(0.5, 6);
  expect(fadeAt(e, 1).level).toBeCloseTo(0.5, 12);
  expect(fadeAt(e, 1.5).level).toBeCloseTo(0.25, 12);
  expect(fadeAt(e, 2).level).toBe(0);
});

test("fadeAt: 0 ms is a cut; the colour switches at a fade's start", () => {
  expect(fadeAt(withAt(ev(1, 0, 0.7)), 1).level).toBe(0.7);
  const e = withAt(ev(0, 1, 1), ev(2, 1, 0.5, "#fff"));
  expect(fadeAt(e, 1.9)).toEqual({ level: 1, color: "#000" });
  expect(fadeAt(e, 2)).toEqual({ level: 1, color: "#fff" });
  expect(fadeAt(e, 2.5).level).toBeCloseTo(0.75, 12);
});

test("fadeEvents: an invalid colour falls back to #000; any valid hex (3/4/6/8 digits) is kept", () => {
  const colours = (c: string) => fadeEvents(deck([{ id: "s", beats: [{ id: "a", timeline: [fade(1, 0, c), wait(100)] }] }]))[0].color;
  for (const c of ["#fff", "#ffff", "#a1b2c3", "#A1B2C3D4"]) expect(colours(c)).toBe(c);
  for (const c of ["red", "#ff", "#fffff", "#ggg", "rgb(255,0,0)", " #fff"]) expect(colours(c)).toBe(FADE_DEFAULT_COLOR);
});
