import { expect, test } from "@playwright/test";

const id = "e2e-render";
// Beat a: nightlight 0 -> 0.8 over 0.5-1.1 s, and a slow (1.6 s) "Alpha line" fade-in from 0.5 s, so both
// are mid-tween at T=0.8. Beat a is 2.1 s long. Beat b (starts 2.1 s): crossfade to 1.02 over 2.6-3.5 s and a
// slow "Bravo line" fade-in from 2.6 s, so both are mid-tween at T=3.05.
const doc = { version: 1, meta: { id, title: "Render" }, scenes: [{ id: "s0", beats: [
  { id: "a", art: { to: "1.01", mode: "fade" }, timeline: [
    { kind: "wait", ms: 500 }, { kind: "nightlight", to: 0.8, durationMs: 600 }, { kind: "text", value: "Alpha line", in: "fade", speed: 0.5 },
  ] },
  { id: "b", timeline: [
    { kind: "wait", ms: 500 }, { kind: "art", art: { to: "1.02", mode: "crossfade" } }, { kind: "text", value: "Bravo line", in: "fade", speed: 0.5 }, { kind: "wait", ms: 500 },
  ] },
] }] };

const MID_NIGHT = 0.8;
const MID_CROSSFADE = 3.05;

test.describe("determinism", () => {
  test.beforeEach(async ({ request }) => {
    await request.delete(`/api/decks/${id}`).catch(() => {});
    await request.post("/api/decks", { data: { id, title: "Render" } });
    await request.put(`/api/decks/${id}`, { data: doc });
  });
  test.afterEach(async ({ request }) => { await request.delete(`/api/decks/${id}`); });

  test("a frame reached by jumping (forward or backward) equals the same frame reached by stepping", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto(`/render?deck=${id}`);
    await page.waitForFunction(() => window.__morganaRender?.ready === true);

    const frame = (t: number) => page.evaluate(async (t) => {
      const r = window.__morganaRender!;
      if (!r.ready) throw new Error("not ready");
      await r.renderFrame(t);
    }, t);
    const capture = async () => {
      const png = await page.screenshot();
      const dom = await page.evaluate(() => ({
        layers: [...document.querySelectorAll<HTMLElement>(".artstage__layer")].map((e) => [e.dataset.asset, e.style.opacity]),
        glow: document.querySelector<HTMLElement>(".artstage__glow")?.style.opacity,
        text: [...document.querySelectorAll<HTMLElement>("[data-render-root] .cin__line")].map((e) => [e.textContent, e.style.opacity]),
      }));
      return { png, dom };
    };

    // Stepping: 0 -> mid-nightlight -> ... -> mid-crossfade.
    for (const t of [0, 0.2, 0.4, 0.6, MID_NIGHT]) await frame(t);
    const stepNight = await capture();
    for (const t of [1.2, 1.6, 2, 2.4, 2.8, MID_CROSSFADE]) await frame(t);
    const stepCross = await capture();

    // Sanity: the compared frames really are mid-tween, with the right beat's content.
    const opacity = (s: string | undefined) => Number(s);
    expect(stepNight.dom.text.map((x) => x[0])).toEqual(["Alpha line"]);
    expect(opacity(stepNight.dom.text[0][1])).toBeGreaterThan(0);
    expect(opacity(stepNight.dom.text[0][1])).toBeLessThan(1);
    expect(opacity(stepNight.dom.glow)).toBeGreaterThan(0);
    expect(stepCross.dom.text.map((x) => x[0])).toEqual(["Bravo line"]);
    expect(opacity(stepCross.dom.text[0][1])).toBeGreaterThan(0);
    expect(opacity(stepCross.dom.text[0][1])).toBeLessThan(1);
    expect(stepCross.dom.layers.length).toBe(2);

    // Jump forward from the start straight to mid-crossfade.
    await frame(0.2);
    await frame(MID_CROSSFADE);
    const jumpCross = await capture();
    expect(jumpCross.dom).toEqual(stepCross.dom);
    expect(jumpCross.png.equals(stepCross.png)).toBe(true);

    // Jump backward across the beat boundary to mid-nightlight.
    await frame(MID_NIGHT);
    const jumpBack = await capture();
    expect(jumpBack.dom).toEqual(stepNight.dom);
    expect(jumpBack.png.equals(stepNight.png)).toBe(true);
  });

  test("render-only chrome is hidden: Next's dev indicator and interactive end-cards never reach a frame", async ({ page }) => {
    await page.goto(`/render?deck=${id}`);
    await page.waitForFunction(() => window.__morganaRender?.ready === true);
    // `next dev` mounts <nextjs-portal>; the e2e server is a production build, so stand one in. An
    // end-card is a .cin__ending inside the mounted cinematic beat.
    const display = await page.evaluate(() => {
      const portal = document.body.appendChild(document.createElement("nextjs-portal"));
      const ending = document.querySelector("[data-render-root] .cin")!.appendChild(document.createElement("div"));
      ending.className = "cin__ending";
      return { portal: getComputedStyle(portal).display, ending: getComputedStyle(ending).display };
    });
    expect(display).toEqual({ portal: "none", ending: "none" });
  });

  test("the deck's fonts are loaded before the renderer is ready", async ({ page }) => {
    await page.goto(`/render?deck=${id}`);
    await page.waitForFunction(() => window.__morganaRender?.ready === true);
    const loaded = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      // The webfont itself (first in the list); next/font's local() "Fallback" face may not exist here.
      return ["--font-display", "--font-body", "--font-cursive"].map((v) => document.fonts.check(`400 1em ${css.getPropertyValue(v).split(",")[0]}`));
    });
    expect(loaded).toEqual([true, true, true]);
  });
});

test.describe("error path", () => {
  test("unknown deck publishes ready:false and shows the message", async ({ page }) => {
    await page.goto(`/render?deck=e2e-nope`);
    await page.waitForFunction(() => window.__morganaRender?.ready === false);
    await expect(page.getByTestId("render-error")).toBeVisible();
    expect(await page.evaluate(() => (window.__morganaRender as { error: string }).error)).toBeTruthy();
  });

  test("no deck param fails fast (no fallback deck)", async ({ page }) => {
    await page.goto(`/render`);
    await page.waitForFunction(() => window.__morganaRender?.ready === false);
    expect(await page.evaluate(() => (window.__morganaRender as { error: string }).error)).toBe("missing deck id");
  });

  test("empty deck id fails fast", async ({ page }) => {
    await page.goto(`/render?deck=`);
    await page.waitForFunction(() => window.__morganaRender?.ready === false);
    expect(await page.evaluate(() => (window.__morganaRender as { error: string }).error)).toBe("missing deck id");
  });
});
