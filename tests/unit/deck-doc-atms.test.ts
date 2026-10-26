import { describe, expect, test } from "vitest";
import { validateDeckDoc } from "@/engine/deck-doc";

// text "a" (0.8 s) → [0, 0.8); a 10 s roll → [0.8, 10.8); then the cue under test at timeline[2].
const roll = { kind: "credits", items: [{ names: ["A"] }], durationMs: 10000 };
const deckWith = (cue: unknown, before: unknown[] = [{ kind: "text", value: "a", in: "fade" }, roll]) => ({
  version: 1, meta: { id: "c", title: "C" },
  scenes: [{ id: "s0", beats: [{ id: "b0", timeline: [...before, cue] }] }],
});
const errors = (cue: unknown, before?: unknown[]) => validateDeckDoc(deckWith(cue, before)).errors;
const fade = (atMs: unknown) => ({ kind: "screen_fade", to: 1, atMs });

describe("atMs validation", () => {
  test.each([
    ["at the previous window's start (lower bound)", fade(800)],
    ["at the sequential cursor (upper bound)", fade(10800)],
    ["mid-roll", fade(6000)],
    ["on a camera", { kind: "camera", to: { zoom: 2 }, atMs: 2000 }],
    ["on an art", { kind: "art", art: { to: "1.02", mode: "fade" }, atMs: 2000 }],
  ])("accepts %s", (_n, cue) => {
    expect(errors(cue)).toEqual([]);
  });

  test("the first action's lower bound is 0", () => {
    expect(validateDeckDoc({ version: 1, meta: { id: "c", title: "C" },
      scenes: [{ id: "s0", beats: [{ id: "b0", timeline: [fade(0)] }] }] }).errors).toEqual([]);
  });

  test.each([
    ["below the previous window's start", fade(799)],
    ["above the sequential cursor", fade(10801)],
    ["negative", fade(-1)],
    ["NaN", fade(NaN)],
    ["a string", fade("6000")],
  ])("rejects %s", (_n, cue) => {
    const e = errors(cue);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^scenes\[0\]\.beats\[0\]\.timeline\[2\]/);
    expect(e[0]).toContain("screen_fade");
  });

  test("an out-of-range error names the allowed range in ms", () => {
    expect(errors(fade(10801))).toEqual(["scenes[0].beats[0].timeline[2].atMs: screen_fade atMs must be 800–10800 ms"]);
    expect(errors(fade(-1))).toEqual(["scenes[0].beats[0].timeline[2].atMs: screen_fade atMs must be a finite number ≥ 0"]);
  });

  test("rejects atMs on a timed kind", () => {
    expect(errors({ kind: "text", value: "b", in: "fade", atMs: 1000 })).toEqual([
      "scenes[0].beats[0].timeline[2].atMs: text cannot take atMs (only screen_fade, camera and art)",
    ]);
  });

  test("the previous window is the one just before (an anchored cue counts)", () => {
    const before = [{ kind: "text", value: "a", in: "fade" }, roll, fade(6000)];
    expect(errors({ kind: "camera", to: { zoom: 2 }, atMs: 5999 }, before)).toEqual([
      "scenes[0].beats[0].timeline[3].atMs: camera atMs must be 6000–10800 ms",
    ]);
    expect(errors({ kind: "camera", to: { zoom: 2 }, atMs: 6000 }, before)).toEqual([]);
  });
});
