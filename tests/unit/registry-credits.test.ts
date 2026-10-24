import { expect, test } from "vitest";
import { REGISTRY } from "@/lib/editor/registry";
import { validateDeckDoc } from "@/engine/deck-doc";

const keys = (kind: string) => REGISTRY[kind].schema.map((f) => f.key);
const deckWith = (a: unknown) => ({ version: 1, meta: { id: "r", title: "R" }, scenes: [{ id: "s", beats: [{ id: "b", timeline: [a] }] }] });

test("text: Effect offers draw; a Particles checkbox reveals color/rate/rise", () => {
  const by = Object.fromEntries(REGISTRY.text.schema.map((f) => [f.key, f]));
  expect(by.in.options!.map((o) => o.value)).toContain("draw");
  expect(by.particles).toMatchObject({ type: "checkbox", toggle: { color: "cream", rate: 6, rise: 1 } });
  expect(by["particles.color"]).toMatchObject({ type: "select", showIf: "particles" });
  expect(by["particles.color"].options!.map((o) => o.value)).toEqual(["cream", "cyan", "lime", "pink"]);
  expect(by["particles.rate"]).toMatchObject({ type: "number", min: 1, max: 30, showIf: "particles" });
  expect(by["particles.rise"]).toMatchObject({ type: "range", min: 0.5, max: 2, showIf: "particles" });
});

test("credits: Entries, Duration, area and Particles; its defaults validate", () => {
  expect(keys("credits")).toEqual(["items", "durationMs", "area.x", "area.y", "area.w", "area.h", "particles", "particles.color", "particles.rate", "particles.rise"]);
  expect(REGISTRY.credits.schema[0]).toMatchObject({ type: "credits" });
  const d = REGISTRY.credits.defaults();
  expect(d).toEqual({ kind: "credits", items: [{ role: "Directed by", names: ["Your Name"] }], area: { x: 0.2, y: 0.32, w: 0.6, h: 0.63 }, durationMs: 20000 });
  expect(validateDeckDoc(deckWith(d)).errors).toEqual([]);
});

test("screen_fade: Level, Color, Duration; its defaults validate", () => {
  expect(keys("screen_fade")).toEqual(["to", "color", "durationMs"]);
  expect(REGISTRY.screen_fade.schema[0]).toMatchObject({ type: "range", min: 0, max: 1 });
  const d = REGISTRY.screen_fade.defaults();
  expect(d).toEqual({ kind: "screen_fade", to: 1, color: "#000", durationMs: 1000 });
  expect(validateDeckDoc(deckWith(d)).errors).toEqual([]);
});
