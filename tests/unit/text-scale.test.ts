import { expect, test } from "vitest";
import { textScaleStyle, validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";
import { lintDeck } from "@/lib/editor/lint";
import { scaledSize, TEXT_SCALE_VAR } from "@/engine/deck/cinematic-style";

// meta.textScale: one multiplier for every text size and the credits roll, carried to the stage container
// as a CSS variable (TimedPlayer, RenderStage, the editor canvas), which lint's credits estimate follows.
const deck = (meta: Record<string, unknown>, timeline: unknown[] = [{ kind: "text", value: "Hi", in: "fade" }]) =>
  ({ version: 1, meta: { id: "d", title: "D", ...meta }, scenes: [{ id: "s", beats: [{ id: "b", timeline }] }] }) as unknown as DeckDoc;

test("textScale must be a number from 0.5 to 2, and flashHold 0-1", () => {
  expect(validateDeckDoc(deck({ textScale: 1.05 })).ok).toBe(true);
  for (const bad of [0.4, 2.5, "big", Number.NaN]) expect(validateDeckDoc(deck({ textScale: bad })).ok).toBe(false);
  expect(validateDeckDoc(deck({}, [{ kind: "text", value: "x", in: "fade", flash: true, flashHold: 0.4 }])).ok).toBe(true);
  expect(validateDeckDoc(deck({}, [{ kind: "text", value: "x", in: "fade", flash: true, flashHold: 1.5 }])).ok).toBe(false);
});

test("textScaleStyle sets the scale variable only when the deck has one; sizes multiply by it", () => {
  expect(textScaleStyle(deck({}).meta)).toBeUndefined();
  expect(textScaleStyle(deck({ textScale: 1.1 }).meta)).toEqual({ [TEXT_SCALE_VAR]: "1.1" });
  expect(scaledSize("3rem")).toBe(`calc(var(${TEXT_SCALE_VAR}, 1) * 3rem)`);
});

test("lint's credits speed estimate grows with the text scale", () => {
  const credits = { kind: "credits", items: Array.from({ length: 4 }, (_, i) => ({ role: `R${i}`, names: ["N"] })), durationMs: 13500 };
  const fast = (m: Record<string, unknown>) => lintDeck(deck(m, [credits])).some((i) => i.rule === "credits-fast");
  expect(fast({})).toBe(false);
  expect(fast({ textScale: 2 })).toBe(true);
});
