import { expect, test } from "vitest";
import { lintDeck } from "@/lib/editor/lint";
import type { DeckDoc } from "@/engine/deck-doc";

const deck = (over: Partial<DeckDoc> = {}): DeckDoc => ({
  version: 1, meta: { id: "d", title: "D", timing: { targetSec: 10 } },
  scenes: [
    { id: "opening", durationSec: 2, beats: [{ id: "a", timeline: [{ kind: "wait", ms: 3200 }] }] },
    { id: "credits", beats: [{ id: "b", timeline: [{ kind: "text", value: "see [slide 1](jump:1)", in: "fade" }, { kind: "click_gate" }, { kind: "wait", ms: 1000 }] }] },
  ],
  ...over,
});
const byRule = (d: DeckDoc, rule: string) => lintDeck(d).filter((i) => i.rule === rule);

test("scene-overrun is a warning located to the scene", () => {
  const [i] = byRule(deck(), "scene-overrun");
  expect(i).toMatchObject({ severity: "warning", at: { sceneIdx: 0 } });
  expect(i.message).toBe('scene "opening" runs 1.2s over its 2s');
});

test("deck-length-mismatch reports short/long against the target", () => {
  const [i] = byRule(deck(), "deck-length-mismatch"); // total = 2 + ~(0.8+1) ≈ 3.8 vs 10
  expect(i.severity).toBe("warning");
  expect(i.message).toMatch(/^deck is 0:0\d of 0:10 — \d+\.\ds short$/);
  expect(i.at).toBeUndefined();
});

test("timed-interactive flags gates and jump links per action", () => {
  const issues = byRule(deck(), "timed-interactive");
  expect(issues.map((i) => i.at)).toEqual([
    { sceneIdx: 1, beatIdx: 0, actionIdx: 0 },
    { sceneIdx: 1, beatIdx: 0, actionIdx: 1 },
  ]);
  expect(issues.every((i) => i.severity === "warning")).toBe(true);
});

test("untimed decks get no deck-length or interactive warnings (overrun still applies)", () => {
  const d = deck(); d.meta = { id: "d", title: "D" };
  expect(byRule(d, "deck-length-mismatch")).toEqual([]);
  expect(byRule(d, "timed-interactive")).toEqual([]);
  expect(byRule(d, "scene-overrun")).toHaveLength(1);
});

test("a deck exactly on target has no mismatch", () => {
  const d = deck({ scenes: [{ id: "s", durationSec: 10, beats: [{ id: "a", timeline: [{ kind: "wait", ms: 1000 }] }] }] });
  expect(byRule(d, "deck-length-mismatch")).toEqual([]);
});

test("timing lint never runs on a structurally invalid deck", () => {
  const d = deck(); (d.scenes[0] as unknown as Record<string, unknown>).durationSec = -1;
  expect(byRule(d, "scene-overrun")).toEqual([]);
  expect(lintDeck(d).some((i) => i.rule === "structure")).toBe(true);
});

test("float drift in beat sums does not raise a 0.0s overrun", () => {
  // 0.1s + 0.2s is 0.30000000000000004 in floats; the scene exactly fills its 0.3s pin.
  const d = deck({ scenes: [{ id: "s", durationSec: 0.3, beats: [{ id: "a", timeline: [{ kind: "wait", ms: 100 }, { kind: "wait", ms: 200 }] }] }] });
  expect(byRule(d, "scene-overrun")).toEqual([]);
});

test("a 30ms overrun is reported to the hundredth of a second", () => {
  const d = deck({ scenes: [{ id: "s", durationSec: 1, beats: [{ id: "a", timeline: [{ kind: "wait", ms: 1030 }] }] }] });
  const [i] = byRule(d, "scene-overrun");
  expect(i.message).toBe('scene "s" runs 0.03s over its 1s');
});
