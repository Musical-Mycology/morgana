// tests/unit/action-duration-obj.test.ts
import { expect, test } from "vitest";
import { actionDuration, isSeekable } from "@/engine/authoring/seek";
import type { Action } from "@/engine/deck/types";

test("obj verbs have default durations in seconds", () => {
  expect(actionDuration({ kind: "obj_reveal", target: "o" } as Action)).toBeCloseTo(0.6);
  expect(actionDuration({ kind: "obj_move", target: "o", to: {} } as Action)).toBeCloseTo(0.8);
  expect(actionDuration({ kind: "obj_out", target: "o" } as Action)).toBeCloseTo(0.5);
});

test("obj verbs honor an explicit durationMs", () => {
  expect(actionDuration({ kind: "obj_move", target: "o", to: {}, durationMs: 1200 } as Action)).toBeCloseTo(1.2);
});

test("obj verbs are seekable (pure tweens)", () => {
  expect(isSeekable({ kind: "obj_reveal", target: "o" } as Action)).toBe(true);
  expect(isSeekable({ kind: "obj_move", target: "o", to: {} } as Action)).toBe(true);
  expect(isSeekable({ kind: "obj_out", target: "o" } as Action)).toBe(true);
});
