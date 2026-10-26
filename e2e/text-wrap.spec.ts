import { expect, test } from "@playwright/test";

// Point-placed text wraps within the room it has on stage instead of running off the edges.
const LONG = "The quick brown mycelium wove its quiet way through the forest floor, carrying news to every root";
const SHORT = "Hello there";
let id = "";

test.use({ viewport: { width: 900, height: 506 } });
test.beforeEach(async ({ request }, info) => {
  id = `e2e-text-wrap-${info.parallelIndex}`;
  const doc = { version: 1, meta: { id, title: "Wrap", timing: { targetSec: 4 } }, scenes: [
    { id: "s", durationSec: 4, beats: [{ id: "a", timeline: [
      { kind: "text", value: LONG, in: "fade", size: "lg", align: "center", pos: { x: 0.5, y: 0.35 } },
      { kind: "text", value: SHORT, in: "fade", size: "lg", align: "center", pos: { x: 0.5, y: 0.8 } },
      { kind: "wait", ms: 1000 },
    ] }] },
  ] };
  await request.delete(`/api/decks/${id}`).catch(() => {});
  await request.post("/api/decks", { data: { id, title: "Wrap" } });
  await request.put(`/api/decks/${id}`, { data: doc });
});
test.afterEach(async ({ request }) => { await request.delete(`/api/decks/${id}`); });

test("a long centred pos line wraps inside the stage; a short one stays on one line", async ({ page }) => {
  await page.goto(`/play?deck=${id}&t=3`);
  const stage = page.locator(".cin__stage");
  const long = page.locator(".cin__text .cin__line", { hasText: "quick brown" });
  const short = page.locator(".cin__text .cin__line", { hasText: SHORT });
  await expect(long).toBeVisible();
  await expect(short).toBeVisible();
  await expect.poll(async () => (await long.evaluate((e) => getComputedStyle(e).opacity))).toBe("1");

  const s = (await stage.boundingBox())!;
  const l = (await long.boundingBox())!;
  const sh = (await short.boundingBox())!;
  expect(l.x).toBeGreaterThanOrEqual(s.x);
  expect(l.x + l.width).toBeLessThanOrEqual(s.x + s.width);
  // the glyphs themselves (not just the line box) stay inside the stage
  const ink = await long.evaluate((e) => { const r = document.createRange(); r.selectNodeContents(e); const b = r.getBoundingClientRect(); return { l: b.left, r: b.right }; });
  expect(ink.l).toBeGreaterThanOrEqual(s.x);
  expect(ink.r).toBeLessThanOrEqual(s.x + s.width);
  expect(sh.height).toBeGreaterThan(0);
  expect(l.height).toBeGreaterThan(1.6 * sh.height); // wrapped to >= 2 lines
  // the short line is genuinely one line: its height is under 1.5 computed line-heights
  const lineHeight = await short.evaluate((e) => parseFloat(getComputedStyle(e).lineHeight));
  expect(lineHeight).toBeGreaterThan(0);
  expect(sh.height).toBeLessThan(1.5 * lineHeight);
  expect(sh.x).toBeGreaterThanOrEqual(s.x);
  expect(sh.x + sh.width).toBeLessThanOrEqual(s.x + s.width);
});
