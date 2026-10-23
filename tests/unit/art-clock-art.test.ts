import { describe, expect, test } from "vitest";
import { artEvents, artAt, power2InOut, backOut2 } from "@/engine/authoring/art-clock";
import type { DeckDoc } from "@/engine/deck-doc";
import type { Scene } from "@/engine/deck/types";

const doc = (scenes: Scene[]): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes });
const op = (state: ReturnType<typeof artAt>, asset: string) => state.find((l) => l.asset === asset)?.opacity;

// s0: beat a enters with fade to 1.01 (700 ms), waits 2 s; beat b has a mid-beat crossfade to 1.02 at 0.5 s.
const D = doc([{ id: "s0", beats: [
  { id: "a", art: { to: "1.01", mode: "fade" }, timeline: [{ kind: "wait", ms: 2000 }] },
  { id: "b", timeline: [{ kind: "wait", ms: 500 }, { kind: "art", art: { to: "1.02", mode: "crossfade" } }, { kind: "wait", ms: 2000 }] },
] }]);

test("events: entry art at the beat's deck start, mid-beat art at its window start", () => {
  expect(artEvents(D)).toEqual([
    { start: 0, duration: 0.7, mode: "fade", to: ["1.01"] },
    { start: 2.5, duration: 0.9, mode: "crossfade", to: ["1.02"] },
  ]);
});

test("fade-in follows power2.inOut and settles", () => {
  const ev = artEvents(D);
  expect(op(artAt(ev, 0.35), "1.01")).toBeCloseTo(power2InOut(0.5), 6);
  expect(artAt(ev, 1.5)).toEqual([{ asset: "1.01", opacity: 1, scale: 1, z: 1, overlay: false }]);
});

test("crossfade: incoming rises, outgoing falls from its opacity at the event start, dropped when done", () => {
  const ev = artEvents(D);
  const mid = artAt(ev, 2.95); // p = 0.5
  expect(op(mid, "1.02")).toBeCloseTo(power2InOut(0.5), 6);
  expect(op(mid, "1.01")).toBeCloseTo(1 - power2InOut(0.5), 6);
  expect(artAt(ev, 3.5).map((l) => l.asset)).toEqual(["1.02"]);
});

test("a transition starting mid-crossfade continues smoothly (no pop)", () => {
  const D2 = doc([{ id: "s", beats: [{ id: "a", art: { to: "1.01", mode: "fade" }, timeline: [
    { kind: "wait", ms: 350 }, { kind: "art", art: { to: "1.02", mode: "fade" } }, { kind: "wait", ms: 2000 },
  ] }] }]);
  const ev = artEvents(D2);
  const before = op(artAt(ev, 0.3499), "1.01")!;
  const at = op(artAt(ev, 0.35), "1.01")!;
  expect(at).toBeCloseTo(before, 3);                       // outgoing starts from where it was
  expect(op(artAt(ev, 0.35 + 0.35), "1.01")).toBeCloseTo(at * (1 - power2InOut(0.5)), 6);
});

test("overlay enters with back.out(2) scale 0.9→1 and clamped opacity", () => {
  const D3 = doc([{ id: "s", beats: [{ id: "a", art: { to: ["1.01", "MusicScore"], mode: "fade" }, timeline: [{ kind: "wait", ms: 2000 }] }] }]);
  const l = artAt(artEvents(D3), 0.35).find((x) => x.asset === "MusicScore")!;
  expect(l.overlay).toBe(true);
  expect(l.scale).toBeCloseTo(0.9 + 0.1 * backOut2(0.5), 6);
  expect(l.opacity).toBeCloseTo(Math.min(1, backOut2(0.5)), 6);
});

test("cut is instant; morph enters from scale 1.04", () => {
  const Dc = doc([{ id: "s", beats: [{ id: "a", art: { to: "1.01", mode: "cut" }, timeline: [{ kind: "wait", ms: 500 }] }] }]);
  expect(artAt(artEvents(Dc), 0)).toEqual([{ asset: "1.01", opacity: 1, scale: 1, z: 1, overlay: false }]);
  const Dm = doc([{ id: "s", beats: [{ id: "a", art: { to: "1.01", mode: "morph" }, timeline: [{ kind: "wait", ms: 2000 }] }] }]);
  const q = power2InOut(0.5);
  expect(artAt(artEvents(Dm), 0.4)[0].scale).toBeCloseTo(1.04 + (1 - 1.04) * q, 6);
});

test("keep/out fold against the TRUE prior stack", () => {
  const Dk = doc([{ id: "s", beats: [{ id: "a", art: { to: "3.01", mode: "cut" }, timeline: [
    { kind: "art", art: { to: "3.02", mode: "cut", keep: ["3.01"] } }, { kind: "wait", ms: 100 },
  ] }] }]);
  expect(artAt(artEvents(Dk), 0.05).map((l) => l.asset)).toEqual(["3.01", "3.02"]);
});

test("pinned-scene overrun: art past the cut boundary never happens", () => {
  const Dp = doc([{ id: "s", durationSec: 1, beats: [{ id: "a", art: { to: "1.01", mode: "cut" }, timeline: [
    { kind: "wait", ms: 1500 }, { kind: "art", art: { to: "1.02", mode: "cut" } },
  ] }] }]);
  expect(artEvents(Dp).map((e) => e.to)).toEqual([["1.01"]]);
});

test("empty / before any art", () => {
  expect(artAt(artEvents(doc([])), 0)).toEqual([]);
  expect(artAt(artEvents(D), -1)).toEqual([]);
});

test("entry art folding to the identical stack emits no event; a running fade continues", () => {
  const Ds = doc([{ id: "s", beats: [
    { id: "a", art: { to: "1.01", mode: "fade" }, timeline: [{ kind: "wait", ms: 300 }] },
    { id: "b", art: { to: "1.01", mode: "fade" }, timeline: [{ kind: "wait", ms: 2000 }] },
  ] }]);
  const ev = artEvents(Ds);
  expect(ev).toHaveLength(1);
  expect(op(artAt(ev, 0.3), "1.01")).toBeCloseTo(power2InOut(0.3 / 0.7), 6);
  expect(op(artAt(ev, 0.2999), "1.01")).toBeCloseTo(power2InOut(0.2999 / 0.7), 6);
});

test("mid-beat art actions always emit, even when the stack is unchanged", () => {
  const Dm = doc([{ id: "s", beats: [{ id: "a", art: { to: "1.01", mode: "cut" }, timeline: [
    { kind: "art", art: { to: "1.01", mode: "fade" } }, { kind: "wait", ms: 500 },
  ] }] }]);
  expect(artEvents(Dm)).toHaveLength(2);
});

test("durationMs overrides the mode default on a non-cut mode", () => {
  const Dd = doc([{ id: "s", beats: [{ id: "a", art: { to: "1.01", mode: "fade", durationMs: 200 }, timeline: [{ kind: "wait", ms: 1000 }] }] }]);
  const ev = artEvents(Dd);
  expect(ev[0].duration).toBeCloseTo(0.2, 9);
  expect(artAt(ev, 0.2)).toEqual([{ asset: "1.01", opacity: 1, scale: 1, z: 1, overlay: false }]);
  expect(op(artAt(ev, 0.1), "1.01")).toBeCloseTo(power2InOut(0.5), 6);
});

test("an overlay leaving fades out with power2.inOut and keeps its old z", () => {
  const Do = doc([{ id: "s", beats: [{ id: "a", art: { to: ["1.01", "MusicScore"], mode: "cut" }, timeline: [
    { kind: "art", art: { to: "1.02", mode: "fade", keep: ["1.01"], out: ["MusicScore"] } }, { kind: "wait", ms: 2000 },
  ] }] }]);
  const ev = artEvents(Do);
  const l = artAt(ev, 0.35).find((x) => x.asset === "MusicScore")!;
  expect(l.opacity).toBeCloseTo(1 - power2InOut(0.5), 6);
  expect(l.z).toBe(2);
  expect(l.overlay).toBe(true);
  expect(artAt(ev, 0.8).map((x) => x.asset)).toEqual(["1.01", "1.02"]);
});

test("a beat starting at/after a pinned boundary emits none of its art", () => {
  const Db = doc([{ id: "s", durationSec: 1, beats: [
    { id: "a", art: { to: "1.01", mode: "cut" }, timeline: [{ kind: "wait", ms: 1000 }] },
    { id: "b", art: { to: "1.02", mode: "cut" }, timeline: [{ kind: "art", art: { to: "3.01", mode: "cut" } }, { kind: "wait", ms: 500 }] },
  ] }]);
  expect(artEvents(Db).map((e) => e.to)).toEqual([["1.01"]]);
});

test("an unpinned scene's trailing zero-length beat with entry art is emitted at the scene end", () => {
  const Dz = doc([{ id: "s", beats: [
    { id: "a", art: { to: "1.01", mode: "cut" }, timeline: [{ kind: "wait", ms: 1000 }] },
    { id: "b", art: { to: "1.02", mode: "cut" }, timeline: [] },
  ] }]);
  expect(artEvents(Dz).map((e) => [e.start, e.to])).toEqual([[0, ["1.01"]], [1, ["1.02"]]]);
});

// Ruling (amends spec §2.1): a layer kept by a later event while still fading in CONTINUES that
// fade-in (its original start, duration and ease) instead of popping to 1.
describe("kept layers continue an in-flight fade-in", () => {
  // Crossfade 1.01 → 1.02 at T=1 (900 ms, so it ends at 1.9); mid-beat at T=1.3 an overlay is added keeping 1.02.
  const probe = (mode: "crossfade" | "cut") => doc([{ id: "s", beats: [{ id: "a", art: { to: "1.01", mode: "cut" }, timeline: [
    { kind: "wait", ms: 1000 }, { kind: "art", art: { to: "1.02", mode: "crossfade" } },
    { kind: "wait", ms: 300 }, { kind: "art", art: { to: "MusicScore", mode, keep: ["1.02"] } },
    { kind: "wait", ms: 2000 },
  ] }] }]);

  test("the probe case is continuous across the keeping event (no pop)", () => {
    const ev = artEvents(probe("crossfade"));
    const before = op(artAt(ev, 1.29), "1.02")!;
    const at = op(artAt(ev, 1.3), "1.02")!;
    expect(before).toBeCloseTo(power2InOut(0.29 / 0.9), 6);
    expect(Math.abs(at - before)).toBeLessThan(0.05);
    expect(at).toBeCloseTo(power2InOut(0.3 / 0.9), 6);
  });

  test("it keeps following the original fade and reaches 1 at the original fade's end, then holds", () => {
    const ev = artEvents(probe("crossfade"));
    expect(op(artAt(ev, 1.6), "1.02")).toBeCloseTo(power2InOut(0.6 / 0.9), 6);
    expect(op(artAt(ev, 1.9), "1.02")).toBe(1);
    expect(op(artAt(ev, 2.5), "1.02")).toBe(1);
  });

  test("z stays authoritative and the outgoing layer is unchanged", () => {
    const ev = artEvents(probe("crossfade"));
    const s = artAt(ev, 1.6);
    expect(s.find((l) => l.asset === "1.02")!.z).toBe(1);
    expect(s.find((l) => l.asset === "MusicScore")!.z).toBe(2);
    // 1.01 was at 1 − power2InOut(0.3/0.9) when the keeping event began; it fades out from there.
    const from = 1 - power2InOut(0.3 / 0.9);
    expect(op(s, "1.01")).toBeCloseTo(from * (1 - power2InOut(0.3 / 0.9)), 6);
  });

  test("an instant (cut) keeping event still lets the kept layer finish its fade", () => {
    const ev = artEvents(probe("cut"));
    expect(op(artAt(ev, 1.3), "1.02")).toBeCloseTo(power2InOut(0.3 / 0.9), 6);
    expect(op(artAt(ev, 1.9), "1.02")).toBe(1);
  });

  test("a kept overlay continues its back.out(2) scale and opacity", () => {
    const Dov = doc([{ id: "s", beats: [{ id: "a", art: { to: "1.01", mode: "cut" }, timeline: [
      { kind: "art", art: { to: "MusicScore", mode: "fade", keep: ["1.01"] } },
      { kind: "wait", ms: 200 }, { kind: "art", art: { to: "1.02", mode: "fade", keep: ["MusicScore"] } },
      { kind: "wait", ms: 2000 },
    ] }] }]);
    const l = artAt(artEvents(Dov), 0.35).find((x) => x.asset === "MusicScore")!;
    expect(l.scale).toBeCloseTo(0.9 + 0.1 * backOut2(0.5), 6);
    expect(l.opacity).toBeCloseTo(Math.min(1, backOut2(0.5)), 6);
  });
});
