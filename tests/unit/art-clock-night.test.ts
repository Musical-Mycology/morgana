import { expect, test } from "vitest";
import { nightEvents, nightAt } from "@/engine/authoring/art-clock";
import type { DeckDoc } from "@/engine/deck-doc";

const D: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s", beats: [
  { id: "a", nightlight: 0.2, timeline: [{ kind: "wait", ms: 1000 }, { kind: "nightlight", to: 1, durationMs: 400 }, { kind: "wait", ms: 1000 }] },
  { id: "b", nightlight: 0, timeline: [{ kind: "wait", ms: 1000 }] },
] }] };

test("timeline: first beat's flattened nightlight, actions, and beat-entry changes", () => {
  expect(nightEvents(D)).toEqual({ initial: 0.2, events: [
    { start: 1, duration: 0.4, to: 1 },
    { start: 2, duration: 0.2, to: 0 },
  ] });
});

test("linear interpolation from the value at each event's start", () => {
  const tl = nightEvents(D);
  expect(nightAt(tl, 0.5)).toBeCloseTo(0.2);
  expect(nightAt(tl, 1.2)).toBeCloseTo(0.2 + (1 - 0.2) * 0.5);
  expect(nightAt(tl, 1.5)).toBeCloseTo(1);
  expect(nightAt(tl, 2.1)).toBeCloseTo(1 + (0 - 1) * 0.5);
  expect(nightAt(tl, 9)).toBeCloseTo(0);
});

test("an action with no durationMs uses NIGHT_ENTRY_MS; an unchanged beat entry emits nothing", () => {
  const D2: DeckDoc = { version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s", beats: [
    { id: "a", timeline: [{ kind: "nightlight", to: 0.5 }, { kind: "wait", ms: 500 }] },
    { id: "b", timeline: [{ kind: "wait", ms: 500 }] },
  ] }] };
  expect(nightEvents(D2)).toEqual({ initial: 0, events: [{ start: 0, duration: 0.2, to: 0.5 }, { start: 0.5, duration: 0.2, to: 0 }] });
});
