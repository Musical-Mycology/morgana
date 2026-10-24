import { expect, test, type Page } from "@playwright/test";

// Timed-video sub-project 6, Task 1 (kept as a regression test). The "draw" text style traces each
// glyph's outline with per-<tspan> stroke dashing, driven by the CSS below (the same rules
// CinematicSlide ships). This checks that Chromium dashes each glyph tspan independently and paints
// the same pixels for the same state however it got there. Its outcome sets DRAW_VARIANT in
// engine/components/effects/draw-state.ts: every "dash:" test passes -> "dash"; otherwise "mask" (the
// mask-image sweep, whose own determinism the "mask:" test checks).
const CSS = `
  html, body { margin: 0; background: #000; }
  svg { display: block; }
  text { font: 120px serif; letter-spacing: 48px; fill: #fff; stroke: #fff; stroke-width: 0.015em; white-space: pre; }
  tspan { stroke-dasharray: 12em; stroke-dashoffset: calc(var(--d, 1) * 12em); fill-opacity: var(--f, 0); stroke-opacity: var(--s, 1); }
  .gone text { visibility: hidden; }
  .mask { -webkit-mask-image: linear-gradient(90deg, #000 calc(var(--sweep, 0) * 108% - 8%), transparent calc(var(--sweep, 0) * 108%));
          mask-image: linear-gradient(90deg, #000 calc(var(--sweep, 0) * 108% - 8%), transparent calc(var(--sweep, 0) * 108%)); }
  .mask tspan { stroke-dasharray: none; stroke-dashoffset: 0; }
`;
const PAGE = `<!doctype html><html><head><style>${CSS}</style></head><body><svg id="s" width="720" height="220"><text x="24" y="24" dominant-baseline="text-before-edge"><tspan>H</tspan><tspan>O</tspan><tspan>M</tspan></text></svg></body></html>`;
const FULL = { x: 0, y: 0, width: 720, height: 220 };
type Box = typeof FULL;

/** Load the probe page; returns one screenshot clip per glyph: the glyph's own advance (getExtentOfChar
 *  includes the trailing letter-spacing, so that is subtracted) plus 3px, so no neighbour's ink is inside. */
async function open(page: Page): Promise<Box[]> {
  await page.setViewportSize({ width: 720, height: 220 });
  await page.setContent(PAGE);
  return page.evaluate(() => {
    const text = document.querySelector("text") as SVGTextElement;
    const svg = document.getElementById("s")!.getBoundingClientRect();
    return [0, 1, 2].map((i) => {
      const r = text.getExtentOfChar(i);
      const own = r.width - (parseFloat(getComputedStyle(text).letterSpacing) || 0);
      return { x: Math.max(0, Math.floor(svg.left + r.x) - 3), y: Math.max(0, Math.floor(svg.top + r.y) - 3), width: Math.ceil(own) + 6, height: Math.ceil(r.height) + 6 };
    });
  });
}
/** Set each glyph's --d, plus the svg's class and --sweep. */
async function state(page: Page, d: number[], opts: { cls?: string; sweep?: number } = {}) {
  await page.evaluate(({ d, cls, sweep }) => {
    const svg = document.getElementById("s")!;
    svg.setAttribute("class", cls);
    svg.style.setProperty("--sweep", String(sweep));
    document.querySelectorAll<SVGTSpanElement>("tspan").forEach((t, i) => t.style.setProperty("--d", String(d[i])));
  }, { d, cls: opts.cls ?? "", sweep: opts.sweep ?? 0 });
}
const shots = (page: Page, boxes: Box[]) => Promise.all(boxes.map((clip) => page.screenshot({ clip })));

test("dash: a glyph at --d 1 paints nothing while its neighbour at 0 is stroked whole (each tspan is dashed on its own)", async ({ page }) => {
  const boxes = await open(page);
  await state(page, [1, 1, 1], { cls: "gone" });
  const blank = await shots(page, boxes);
  await state(page, [0, 0, 0]);
  const whole = await shots(page, boxes);
  for (let i = 0; i < 3; i++) expect(whole[i].equals(blank[i]), `glyph ${i} is stroked at --d 0`).toBe(false);
  await state(page, [1, 1, 1]);
  const hidden = await shots(page, boxes);
  for (let i = 0; i < 3; i++) expect(hidden[i].equals(blank[i]), `glyph ${i} at --d 1 paints nothing`).toBe(true);
  await state(page, [1, 0, 1]);
  const a = await shots(page, boxes);
  expect(a[0].equals(blank[0])).toBe(true);
  expect(a[1].equals(whole[1]), "glyph 1's stroke does not depend on glyph 0's offset").toBe(true);
  expect(a[2].equals(blank[2])).toBe(true);
  await state(page, [0, 1, 0]);
  const b = await shots(page, boxes);
  expect(b[0].equals(whole[0])).toBe(true);
  expect(b[1].equals(blank[1])).toBe(true);
  expect(b[2].equals(whole[2])).toBe(true);
});

test("dash: 12em bounds every glyph's outline, and a mid value draws part of it", async ({ page }) => {
  const boxes = await open(page);
  await state(page, [0, 0, 0]);
  const whole = await shots(page, boxes);
  await state(page, [0.05, 0.05, 0.05]); // offset 0.6em: whole iff the outline is ≤ 11.4em
  const nearly = await shots(page, boxes);
  for (let i = 0; i < 3; i++) expect(nearly[i].equals(whole[i]), `glyph ${i}'s outline fits in the dash`).toBe(true);
  await state(page, [1, 1, 1], { cls: "gone" });
  const blank = await shots(page, boxes);
  await state(page, [1, 1, 0.85]); // 1.8em of the M's outline
  const part = await shots(page, boxes);
  expect(part[2].equals(blank[2])).toBe(false);
  expect(part[2].equals(whole[2])).toBe(false);
});

test("dash: the same state paints the same pixels however it was reached", async ({ page }) => {
  await open(page);
  await state(page, [0.3, 0.6, 0.9]);
  const first = await page.screenshot({ clip: FULL });
  await state(page, [1, 0, 0.5]);
  await page.screenshot({ clip: FULL });
  await state(page, [0.3, 0.6, 0.9]);
  expect((await page.screenshot({ clip: FULL })).equals(first), "back to the same state").toBe(true);
  await open(page);
  await state(page, [0.3, 0.6, 0.9]);
  expect((await page.screenshot({ clip: FULL })).equals(first), "a fresh page, jumped straight there").toBe(true);
});

test("mask: the sweep fallback hides everything at 0, part at 0.4, and is deterministic", async ({ page }) => {
  await open(page);
  await state(page, [0, 0, 0], { cls: "gone" });
  const blank = await page.screenshot({ clip: FULL });
  await state(page, [0, 0, 0], { cls: "mask", sweep: 1 });
  const whole = await page.screenshot({ clip: FULL });
  await state(page, [0, 0, 0], { cls: "mask", sweep: 0 });
  expect((await page.screenshot({ clip: FULL })).equals(blank)).toBe(true);
  await state(page, [0, 0, 0], { cls: "mask", sweep: 0.4 });
  const mid = await page.screenshot({ clip: FULL });
  expect(mid.equals(blank)).toBe(false);
  expect(mid.equals(whole)).toBe(false);
  await state(page, [0, 0, 0], { cls: "mask", sweep: 0.9 });
  await state(page, [0, 0, 0], { cls: "mask", sweep: 0.4 });
  expect((await page.screenshot({ clip: FULL })).equals(mid)).toBe(true);
});
