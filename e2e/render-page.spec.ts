import { expect, test } from "@playwright/test";

const id = "e2e-render";
// Task 2 crossfade fixture (beat a fades to 1.01; beat b crossfades to 1.02 at 0.5 s, 900 ms),
// plus a nightlight action in beat a (0.5 s → 1.1 s).
const doc = { version: 1, meta: { id, title: "Render" }, scenes: [{ id: "s0", beats: [
  { id: "a", art: { to: "1.01", mode: "fade" }, timeline: [{ kind: "wait", ms: 500 }, { kind: "nightlight", to: 0.8, durationMs: 600 }, { kind: "wait", ms: 1500 }] },
  { id: "b", timeline: [{ kind: "wait", ms: 500 }, { kind: "art", art: { to: "1.02", mode: "crossfade" } }, { kind: "wait", ms: 2000 }] },
] }] };

type Renderer = { ready: true; total: number; renderFrame(T: number): Promise<void> } | { ready: false; error: string };
declare global { interface Window { __morganaRender?: Renderer } }

test.beforeEach(async ({ request }) => {
  await request.delete(`/api/decks/${id}`).catch(() => {});
  await request.post("/api/decks", { data: { id, title: "Render" } });
  await request.put(`/api/decks/${id}`, { data: doc });
});
test.afterEach(async ({ request }) => { await request.delete(`/api/decks/${id}`); });

test("a frame reached by jumping equals the same frame reached by stepping", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto(`/render?deck=${id}`);
  await page.waitForFunction(() => window.__morganaRender?.ready === true);

  const snapshot = () => page.evaluate(() => ({
    layers: [...document.querySelectorAll<HTMLElement>(".artstage__layer")].map((e) => [e.dataset.asset, e.style.opacity]),
    glow: document.querySelector<HTMLElement>(".artstage__glow")?.style.opacity,
  }));
  const frame = (t: number) => page.evaluate(async (t) => {
    const r = window.__morganaRender!;
    if (!r.ready) throw new Error("not ready");
    await r.renderFrame(t);
  }, t);

  for (const t of [0, 0.5, 1, 1.5, 2, 2.5, 2.8, 2.95]) await frame(t);
  const A = await page.screenshot();
  const domA = await snapshot();

  await frame(0.2);
  await frame(2.95);
  const B = await page.screenshot();
  const domB = await snapshot();

  expect(domA.layers.length).toBe(2); // mid-crossfade: both layers present
  expect(domB).toEqual(domA);
  expect(B.equals(A)).toBe(true);
});

test("unknown deck publishes ready:false", async ({ page }) => {
  await page.goto(`/render?deck=e2e-nope`);
  await page.waitForFunction(() => window.__morganaRender?.ready === false);
  expect(await page.evaluate(() => (window.__morganaRender as { error: string }).error)).toBeTruthy();
});
