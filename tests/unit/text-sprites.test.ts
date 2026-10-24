import { describe, expect, test } from "vitest";
import {
  EMIT_SPEED_N, MAX_SPRITES_PER_SOURCE, MAX_SPRITES_TOTAL, STAGE_ASPECT, TEXT_LIFE, TEXT_SEED,
  hash32, isTextSpriteKey, mulberry32, noteFieldStateAt, particleOpts, resolveParticleColor,
  scrollOffsetAt, textSourceEnd, textSourceIdx, textSpritesAt, type TextSource,
} from "@/engine/components/effects/note-state";
import type { Action, Scene } from "@/engine/deck/types";

const R = [{ x: 0.2, y: 0.3, w: 0.1, h: 0.05 }, { x: 0.5, y: 0.3, w: 0.2, h: 0.05 }];
const src = (over: Partial<TextSource> = {}): TextSource =>
  ({ key: "a0", idx: 0, start: 0.5, end: 2, rects: R, color: "#F6E6D7", rate: 6, rise: 1, ...over });
const born = (s: TextSource, i: number) => textSpritesAt(s, s.idx, i / s.rate).find((n) => n.key === `t${s.idx}:${i % 16}`)!;

describe("textSpritesAt", () => {
  test("births at i/rate, clipped to [start, end); each lives 2.4 s", () => {
    expect(textSpritesAt(src(), 0, 0.4)).toEqual([]);                         // before start
    expect(textSpritesAt(src(), 0, 0.5).map((n) => n.key)).toEqual(["t0:3"]); // 3/6 = start
    expect(textSpritesAt(src(), 0, 1).map((n) => n.key)).toEqual(["t0:3", "t0:4", "t0:5", "t0:6"]);
    // t = 3: births < end (i ≤ 11) and alive (i/6 > 0.6 → i ≥ 4).
    expect(textSpritesAt(src(), 0, 3).map((n) => n.key)).toEqual([4, 5, 6, 7, 8, 9, 10, 11].map((i) => `t0:${i}`));
    expect(textSpritesAt(src(), 0, 4.5)).toEqual([]);                         // every note born before end has died
    expect(textSpritesAt(src({ end: undefined }), 0, 10).length).toBe(Math.ceil(TEXT_LIFE * 6)); // no end: steady state
  });

  test("a note is born inside one of the rects, at that rect's top, from the TEXT_SEED-offset seed", () => {
    for (const i of [3, 4, 7, 11]) {
      const n = born(src(), i);
      const rnd = mulberry32(hash32(TEXT_SEED + 0, i));
      const r = R[Math.floor(rnd() * R.length)];
      expect(n.x).toBeCloseTo(r.x + rnd() * r.w, 12);
      expect(n.y).toBe(r.y);
      expect(n.x).toBeGreaterThanOrEqual(r.x);
      expect(n.x).toBeLessThanOrEqual(r.x + r.w);
    }
  });

  test("with scroll, y is the rect top shifted by the offset at the BIRTH time; the note does not follow the scroll", () => {
    const scroll = { t0: 0, dur: 10, from: 0.6, to: -0.4 };
    const at = (s: TextSource, t: number) => textSpritesAt(s, s.idx, t).find((n) => n.key === "t0:3")!;
    const shifted = src({ rects: R.map((r) => ({ ...r, y: r.y + scrollOffsetAt(scroll, 0.5) })) });
    for (const t of [0.5, 1.5, 2.6]) {
      const a = at(src({ scroll }), t), b = at(shifted, t);
      expect(a.x).toBeCloseTo(b.x, 12);
      expect(a.y).toBeCloseTo(b.y, 12);
    }
  });

  test("travel is up ± 25°, scaled by rise", () => {
    const s1 = src({ end: undefined }), s2 = src({ end: undefined, rise: 2 });
    const a = textSpritesAt(s1, 0, 2), b = textSpritesAt(s2, 0, 2);
    for (let k = 0; k < a.length; k++) {
      const i = Number(a[k].key.split(":")[1]);
      const n0 = born(s1, i);
      const dx = a[k].x - n0.x, dy = a[k].y - n0.y;
      if (dx === 0 && dy === 0) continue;
      const deg = (Math.atan2(dx, -dy / STAGE_ASPECT) * 180) / Math.PI;
      expect(Math.abs(deg)).toBeLessThanOrEqual(25 + 1e-9);
      expect(b[k].x - n0.x).toBeCloseTo(2 * dx, 12);
      expect(b[k].y - n0.y).toBeCloseTo(2 * dy, 12);
      expect(Math.hypot(dx, dy / STAGE_ASPECT)).toBeLessThanOrEqual(EMIT_SPEED_N * TEXT_LIFE * 1.2 + 1e-12);
    }
  });

  test("per-source cap; deterministic; nothing for rate 0 or no rects", () => {
    const fast = src({ rate: 200, start: 0, end: undefined });
    const many = textSpritesAt(fast, 0, 5);
    expect(many.length).toBe(MAX_SPRITES_PER_SOURCE);
    expect(new Set(many.map((n) => n.key)).size).toBe(MAX_SPRITES_PER_SOURCE);
    expect(textSpritesAt(src(), 0, 1.3)).toEqual(textSpritesAt(src(), 0, 1.3));
    expect(textSpritesAt(src({ rate: 0 }), 0, 1)).toEqual([]);
    expect(textSpritesAt(src({ rects: [] }), 0, 1)).toEqual([]);
  });
});

describe("noteFieldStateAt with text sources", () => {
  const emitter: Action = { kind: "note_emitter", color: "#fff", pos: { x: 0.5, y: 0.5 }, dir: 0, decay: 1000, freq: 4 };
  const scene: Scene = { id: "s", beats: [{ id: "b", timeline: [emitter, { kind: "wait", ms: 5000 }] }] };

  test("no text sources = exactly today's output", () => {
    expect(noteFieldStateAt(scene, 0, 1.2, [])).toEqual(noteFieldStateAt(scene, 0, 1.2));
  });

  test("text sprites are appended; their keys never collide with emitter keys", () => {
    const out = noteFieldStateAt(scene, 0, 1.2, [src({ idx: textSourceIdx(0) }), src({ idx: textSourceIdx(1) })]);
    const emit = out.filter((n) => !isTextSpriteKey(n.key)), text = out.filter((n) => isTextSpriteKey(n.key));
    expect(emit).toEqual(noteFieldStateAt(scene, 0, 1.2));
    expect(text.length).toBeGreaterThan(0);
    for (const n of emit) expect(n.key).toMatch(/^\d+:\d+$/);
    for (const n of text) expect(n.key).toMatch(/^t\d+:\d+$/);
    expect(new Set(out.map((n) => n.key)).size).toBe(out.length);
  });

  test("the total cap drops whole trailing sources", () => {
    const fast = (k: number) => src({ idx: textSourceIdx(k), rate: 200, start: 0, end: undefined });
    const plain: Scene = { id: "p", beats: [{ id: "b", timeline: [{ kind: "wait", ms: 9000 }] }] };
    const out = noteFieldStateAt(plain, 0, 5, [fast(0), fast(1), fast(2)]);
    expect(out.length).toBe(MAX_SPRITES_TOTAL);
    expect(out.some((n) => n.key.startsWith(`t${textSourceIdx(2)}:`))).toBe(false);
  });
});

describe("helpers", () => {
  test("textSourceIdx: text action i → i<<12; credit line k → (i<<12)+1+k", () => {
    expect(textSourceIdx(0)).toBe(0);
    expect(textSourceIdx(3)).toBe(3 << 12);
    expect(textSourceIdx(3, 0)).toBe((3 << 12) + 1);
    expect(new Set([textSourceIdx(0), textSourceIdx(0, 0), textSourceIdx(1), textSourceIdx(1, 4)]).size).toBe(4);
  });
  test("resolveParticleColor / particleOpts", () => {
    expect(resolveParticleColor("cyan")).toBe("#3FFBFF");
    expect(resolveParticleColor(undefined)).toBe("#F6E6D7");
    expect(resolveParticleColor("#123456")).toBe("#123456");
    expect(particleOpts({})).toEqual({ color: "#F6E6D7", rate: 6, rise: 1 });
    expect(particleOpts({ color: "lime", rate: 12, rise: 1.5 })).toEqual({ color: "#E3F84F", rate: 12, rise: 1.5 });
  });
  test("an unknown or non-string colour falls back to the cream tint", () => {
    for (const bad of ["nope", "constructor", "", 42, null, {}]) {
      expect(resolveParticleColor(bad as unknown as string)).toBe("#F6E6D7");
    }
    expect(particleOpts({ color: 7 as unknown as string }).color).toBe("#F6E6D7");
  });
  test("a non-finite or non-positive rise falls back to the default 1", () => {
    for (const bad of [0, -2, NaN, Infinity, "2" as unknown as number]) {
      expect(particleOpts({ rise: bad }).rise).toBe(1);
    }
    expect(particleOpts({ rise: 0.5 }).rise).toBe(0.5);
  });
  test("scrollOffsetAt is linear and clamped", () => {
    const s = { t0: 1, dur: 4, from: 0.4, to: -0.8 };
    expect(scrollOffsetAt(s, 0)).toBeCloseTo(0.4, 12);
    expect(scrollOffsetAt(s, 3)).toBeCloseTo(-0.2, 12);
    expect(scrollOffsetAt(s, 9)).toBeCloseTo(-0.8, 12);
  });
  test("textSourceEnd: the first clear / fade_out / stop_notes after the line", () => {
    const tl: Action[] = [
      { kind: "text", value: "A", in: "fade" }, { kind: "wait", ms: 500 }, { kind: "stop_notes" },
      { kind: "wait", ms: 500 }, { kind: "clear" }, { kind: "text", value: "B", in: "fade" },
    ];
    expect(textSourceEnd(tl, 0)).toBeCloseTo(1.3, 12);
    expect(textSourceEnd(tl, 5)).toBeUndefined();
  });
});
