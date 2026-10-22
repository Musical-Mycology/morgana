import { expect, test } from "vitest";
import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [{ id: "s", beats: [] }] });

test("timing and durationSec are optional", () => {
  expect(validateDeckDoc(base()).ok).toBe(true);
});

test("valid timing + durationSec pass", () => {
  const d = base(); d.meta.timing = { targetSec: 120 }; d.scenes[0].durationSec = 15;
  expect(validateDeckDoc(d)).toEqual({ ok: true, errors: [] });
});

test("an explicitly-undefined timing (Timed deck toggled off) passes", () => {
  const d = base(); d.meta.timing = undefined;
  expect(validateDeckDoc(d).ok).toBe(true);
});

test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, "120", null])("targetSec %p is rejected", (v) => {
  const d = base(); (d.meta as unknown as Record<string, unknown>).timing = { targetSec: v };
  expect(validateDeckDoc(d).errors).toContain("meta.timing.targetSec must be a finite number > 0");
});

test("timing: null is rejected", () => {
  const d = base(); (d.meta as unknown as Record<string, unknown>).timing = null;
  expect(validateDeckDoc(d).errors).toContain("meta.timing.targetSec must be a finite number > 0");
});

test.each([0, -3, Number.NaN, "15"])("durationSec %p is rejected with a scene-located message", (v) => {
  const d = base(); (d.scenes[0] as unknown as Record<string, unknown>).durationSec = v;
  expect(validateDeckDoc(d).errors).toContain("scenes[0].durationSec must be a finite number > 0");
});
