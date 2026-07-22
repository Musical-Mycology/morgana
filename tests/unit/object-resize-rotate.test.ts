import { expect, test } from "vitest";
import { rotateTransform, resizeTransform, transformChanged, round3 } from "@/lib/editor/object-drag";
import type { ObjectTransform } from "@/engine/deck/types";

const rect = { left: 0, top: 0, width: 1000, height: 1000 } as DOMRect;
const wide = { left: 0, top: 0, width: 800, height: 450 } as DOMRect;
const box: ObjectTransform = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }; // center at (0.5,0.5)

test("round3 rounds to three decimals", () => {
  expect(round3(0.123456)).toBe(0.123);
});

test("transformChanged compares rounded fields", () => {
  expect(transformChanged({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { x: 0.1 })).toBe(false);
  expect(transformChanged({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { x: 0.3 })).toBe(true);
  expect(transformChanged({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { rot: 0 })).toBe(false);
  expect(transformChanged({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { rot: 15 })).toBe(true);
});

test("rotateTransform: pointer directions map to clockwise degrees, handle-up = 0", () => {
  // center at (500,500) in a 1000x1000 rect
  expect(rotateTransform(box, rect, 500, 100).rot).toBe(0);   // straight up
  expect(rotateTransform(box, rect, 900, 500).rot).toBe(90);  // right
  expect(rotateTransform(box, rect, 500, 900).rot).toBe(180); // down
  expect(rotateTransform(box, rect, 100, 500).rot).toBe(-90); // left
});

test("rotateTransform: snap rounds to nearest 15 degrees", () => {
  const near = rotateTransform(box, rect, 900, 520, { snap: true }).rot; // ~93deg -> 90
  expect(near % 15).toBe(0);
});

test("resizeTransform se handle (rot=0) pins the nw corner and grows w/h", () => {
  // nw corner at (0.4,0.4); drag se pointer to (0.7,0.7)
  const out = resizeTransform(box, "se", rect, 700, 700);
  expect(out.x).toBe(0.4);
  expect(out.y).toBe(0.4);
  expect(out.w).toBe(0.3);
  expect(out.h).toBe(0.3);
});

test("resizeTransform nw handle (rot=0) pins the se corner", () => {
  // se corner at (0.6,0.6); drag nw pointer to (0.5,0.5)
  const out = resizeTransform(box, "nw", rect, 500, 500);
  expect(out.x).toBe(0.5);
  expect(out.y).toBe(0.5);
  expect(out.w).toBe(0.1);
  expect(out.h).toBe(0.1);
});

test("resizeTransform e edge changes only width", () => {
  const out = resizeTransform(box, "e", rect, 800, 999);
  expect(out.w).toBe(0.4);   // right edge to 0.8, left pinned 0.4
  expect(out.h).toBe(0.2);   // unchanged
  expect(out.y).toBe(0.4);
});

test("resizeTransform clamps to a minimum and never flips", () => {
  const out = resizeTransform(box, "se", rect, 100, 100); // drag far past nw
  expect(out.w).toBeGreaterThan(0);
  expect(out.h).toBeGreaterThan(0);
});

test("resizeTransform aspect lock keeps w/h ratio on a corner", () => {
  const start: ObjectTransform = { x: 0.4, y: 0.4, w: 0.2, h: 0.1 }; // ratio 2:1
  const out = resizeTransform(start, "se", rect, 800, 999, { aspect: true });
  expect(round3(out.w / out.h)).toBe(2);
});

test("resizeTransform se handle is rotation-aware (rot=90)", () => {
  const rotated: ObjectTransform = { ...box, rot: 90 };
  // local +x axis now points screen-down; extend along it
  const out = resizeTransform(rotated, "se", rect, 500, 800);
  // width (local x) grows; result stays finite and within stage
  expect(out.w).toBeGreaterThan(0.2);
  expect(Number.isFinite(out.x)).toBe(true);
});

test("resizeTransform is correct under anisotropic 16:9 scaling", () => {
  // 800x450 rect: se drag pins nw, converts px extents per-axis
  const out = resizeTransform(box, "se", wide, 800 * 0.7, 450 * 0.7);
  expect(out.x).toBe(0.4);
  expect(out.y).toBe(0.4);
  expect(round3(out.w)).toBe(0.3);
  expect(round3(out.h)).toBe(0.3);
});

test("resizeTransform n handle pins the bottom edge and grows upward", () => {
  const out = resizeTransform(box, "n", rect, 500, 300);
  expect(out.x).toBe(0.4);
  expect(round3(out.y)).toBe(0.3);
  expect(out.w).toBe(0.2);
  expect(round3(out.h)).toBe(0.3);
});

test("resizeTransform s handle pins the top edge and grows downward", () => {
  const out = resizeTransform(box, "s", rect, 500, 800);
  expect(out.x).toBe(0.4);
  expect(out.y).toBe(0.4);
  expect(out.w).toBe(0.2);
  expect(round3(out.h)).toBe(0.4);
});

test("resizeTransform w handle pins the right edge and grows leftward", () => {
  const out = resizeTransform(box, "w", rect, 300, 500);
  expect(round3(out.x)).toBe(0.3);
  expect(out.y).toBe(0.4);
  expect(round3(out.w)).toBe(0.3);
  expect(out.h).toBe(0.2);
});

test("resizeTransform ne handle pins the sw corner", () => {
  // sw corner at (0.4,0.6); drag ne pointer to (0.7,0.3)
  const out = resizeTransform(box, "ne", rect, 700, 300);
  expect(out.x).toBe(0.4);
  expect(round3(out.y)).toBe(0.3);
  expect(round3(out.w)).toBe(0.3);
  expect(round3(out.h)).toBe(0.3);
});

test("resizeTransform sw handle pins the ne corner", () => {
  // ne corner at (0.6,0.4); drag sw pointer to (0.3,0.7)
  const out = resizeTransform(box, "sw", rect, 300, 700);
  expect(round3(out.x)).toBe(0.3);
  expect(out.y).toBe(0.4);
  expect(round3(out.w)).toBe(0.3);
  expect(round3(out.h)).toBe(0.3);
});

test("resizeTransform top-left anchor: se handle pins top-left and grows box", () => {
  const tl: ObjectTransform = { x: 0.4, y: 0.4, w: 0.2, h: 0.2, anchor: "top-left" };
  const out = resizeTransform(tl, "se", rect, 700, 700);
  expect(out.x).toBe(0.4);
  expect(out.y).toBe(0.4);
  expect(round3(out.w)).toBe(0.3);
  expect(round3(out.h)).toBe(0.3);
});

test("transformChanged handles non-numeric anchor field without throwing", () => {
  const t: ObjectTransform = { x: 0.4, y: 0.4, w: 0.2, h: 0.2, anchor: "center" };
  expect(transformChanged(t, { anchor: "top-left" })).toBe(true);
  expect(transformChanged({ ...t, anchor: "center" }, { anchor: "center" })).toBe(false);
});
