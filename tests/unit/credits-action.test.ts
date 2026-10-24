import { describe, expect, test } from "vitest";
import { actionDuration, isSeekable } from "@/engine/authoring/beat-clock";
import { validateDeckDoc } from "@/engine/deck-doc";

const deckWith = (action: unknown) => ({ version: 1, meta: { id: "c", title: "C" },
  scenes: [{ id: "s0", beats: [{ id: "b0", timeline: [{ kind: "wait", ms: 10 }, action] }] }] });
const AT = "scenes[0].beats[0].timeline[1]";
const credits = { kind: "credits", items: [{ role: "Directed by", names: ["Ann Lee"] }, { names: ["Bo"] }], durationMs: 4000 };

describe("timing", () => {
  test("credits occupy durationMs on the beat; a screen fade occupies none", () => {
    expect(actionDuration({ kind: "credits", items: [{ names: ["A"] }], durationMs: 4000 })).toBe(4);
    expect(actionDuration({ kind: "screen_fade", to: 1 })).toBe(0);
    expect(actionDuration({ kind: "screen_fade", to: 1, durationMs: 3000 })).toBe(0);
    expect(isSeekable({ kind: "credits", items: [{ names: ["A"] }], durationMs: 1 })).toBe(true);
  });
});

describe("validation", () => {
  test.each([
    ["credits", credits],
    ["credits with area", { ...credits, area: { x: 0.1, y: 0.2, w: 0.8, h: 0.8 } }],
    ["credits with particles", { ...credits, particles: { color: "lime", rate: 30, rise: 2 } }],
    ["a role-only item", { ...credits, items: [{ role: "Thanks", names: [] }] }],
    ["screen_fade", { kind: "screen_fade", to: 1, color: "#fff", durationMs: 0 }],
    ["screen_fade at 0", { kind: "screen_fade", to: 0 }],
    ["text particles", { kind: "text", value: "Hi", in: "draw", particles: { rate: 1 } }],
  ])("accepts %s", (_n, action) => {
    expect(validateDeckDoc(deckWith(action)).errors).toEqual([]);
  });

  test.each([
    ["empty items", { ...credits, items: [] }, ".items must be a non-empty array"],
    ["missing items", { kind: "credits", durationMs: 1000 }, ".items must be a non-empty array"],
    ["names not strings", { ...credits, items: [{ names: [1] }] }, ".items[0].names must be an array of strings"],
    ["role not a string", { ...credits, items: [{ role: 3, names: ["A"] }] }, ".items[0].role must be a string"],
    ["durationMs 0", { ...credits, durationMs: 0 }, ".durationMs must be a finite number > 0"],
    ["durationMs missing", { kind: "credits", items: [{ names: ["A"] }] }, ".durationMs must be a finite number > 0"],
    ["area off the stage", { ...credits, area: { x: 0.5, y: 0.2, w: 0.6, h: 0.5 } }, ".area must lie within 0–1 with positive size"],
    ["area zero height", { ...credits, area: { x: 0, y: 0, w: 1, h: 0 } }, ".area must lie within 0–1 with positive size"],
    ["area negative", { ...credits, area: { x: -0.1, y: 0, w: 0.5, h: 0.5 } }, ".area must lie within 0–1 with positive size"],
    ["area NaN", { ...credits, area: { x: NaN, y: 0, w: 0.5, h: 0.5 } }, ".area must lie within 0–1 with positive size"],
    ["fade above 1", { kind: "screen_fade", to: 1.2 }, ".to must be 0–1"],
    ["fade missing to", { kind: "screen_fade" }, ".to must be 0–1"],
    ["fade negative duration", { kind: "screen_fade", to: 1, durationMs: -5 }, ".durationMs must be a finite number ≥ 0"],
    ["fade colour not a string", { kind: "screen_fade", to: 1, color: 0 }, ".color must be a string"],
    ["fade colour not a hex", { kind: "screen_fade", to: 1, color: "blak" }, ".color must be a hex colour"],
    ["fade colour a short hex", { kind: "screen_fade", to: 1, color: "#00" }, ".color must be a hex colour"],
    ["text particle rate 0", { kind: "text", value: "Hi", in: "fade", particles: { rate: 0 } }, ".particles.rate must be 1–30"],
    ["credits particle rate 31", { ...credits, particles: { rate: 31 } }, ".particles.rate must be 1–30"],
    ["particles not an object", { kind: "text", value: "Hi", in: "fade", particles: true }, ".particles must be an object"],
  ])("rejects %s", (_n, action, frag) => {
    const r = validateDeckDoc(deckWith(action));
    expect(r.ok).toBe(false);
    expect(r.errors.some((m) => m.startsWith(AT) && m.includes(frag)), r.errors.join("\n")).toBe(true);
  });
});
