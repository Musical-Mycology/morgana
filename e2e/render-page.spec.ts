import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Per-worker deck id (set in beforeEach): --repeat-each runs copies in parallel workers, which must not share a deck.
let id = "e2e-render";
// Beat a: nightlight 0 -> 0.8 over 0.5-1.1 s, and a slow (1.6 s) "Alpha line" fade-in from 0.5 s, so both
// are mid-tween at T=0.8. Beat a is 2.1 s long. Beat b (starts 2.1 s): crossfade to 1.02 over 2.6-3.5 s and a
// slow "Bravo line" fade-in from 2.6 s, so both are mid-tween at T=3.05.
const docFor = (id: string) => ({ version: 1, meta: { id, title: "Render" }, scenes: [{ id: "s0", beats: [
  { id: "a", art: { to: "1.01", mode: "fade" }, timeline: [
    { kind: "wait", ms: 500 }, { kind: "nightlight", to: 0.8, durationMs: 600 }, { kind: "text", value: "Alpha line", in: "fade", speed: 0.5 },
  ] },
  { id: "b", timeline: [
    { kind: "wait", ms: 500 }, { kind: "art", art: { to: "1.02", mode: "crossfade" } }, { kind: "text", value: "Bravo line", in: "fade", speed: 0.5 }, { kind: "wait", ms: 500 },
  ] },
] }] });

const MID_NIGHT = 0.8;
const MID_CROSSFADE = 3.05;

test.describe("determinism", () => {
  test.beforeEach(async ({ request }, info) => {
    id = `e2e-render-${info.parallelIndex}`;
    await request.delete(`/api/decks/${id}`).catch(() => {});
    await request.post("/api/decks", { data: { id, title: "Render" } });
    await request.put(`/api/decks/${id}`, { data: docFor(id) });
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

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/media/${name}`, import.meta.url)));
async function upload(request: APIRequestContext, deck: string, name: string, mimeType: string): Promise<string> {
  const res = await request.post(`/api/decks/${deck}/media`, { multipart: { file: { name, mimeType, buffer: fixture(name) } } });
  expect(res.status()).toBe(201);
  return `media:${(await res.json()).id}`;
}

test.describe("clips", () => {
  // Per-worker id: --repeat-each runs this describe in parallel workers, which must not share a deck.
  let clipsId = "";
  test.beforeEach(async ({ request }, info) => {
    clipsId = `e2e-render-clips-${info.parallelIndex}`;
    await request.delete(`/api/decks/${clipsId}`).catch(() => {});
    await request.post("/api/decks", { data: { id: clipsId, title: "Render clips" } });
  });
  test.afterEach(async ({ request }) => { await request.delete(`/api/decks/${clipsId}`); });

  test("clips are deterministic: stepped and jumped frames are byte-equal, across a clip crossfade, a tile loop and a backward jump", async ({ page, request }) => {
    const h264 = await upload(request, clipsId, "clip-h264.mp4", "video/mp4");
    const vp9 = await upload(request, clipsId, "clip-vp9.webm", "video/webm");
    // Beat a (0-2 s): the h264 clip from its 0.5 s in-point. Beat b (2-5 s): crossfade to the vp9 clip
    // (2.0-2.9 s) and a looping h264 tile from ~2 s, so by 4.6 the 2 s tile clip has wrapped.
    const clipDoc = { version: 1, meta: { id: clipsId, title: "Render clips" }, scenes: [{ id: "s0", beats: [
      { id: "a", art: { to: h264, mode: "crossfade", clips: { [h264]: { in: 0.5 } } }, timeline: [{ kind: "wait", ms: 2000 }] },
      { id: "b", art: { to: vp9, mode: "crossfade" }, timeline: [
        { kind: "media", id: "tile", pos: { x: 0.6, y: 0.2 }, width: 0.3, src: h264, clip: { loop: true } }, { kind: "wait", ms: 3000 },
      ] },
    ] }] };
    expect((await request.put(`/api/decks/${clipsId}`, { data: clipDoc })).status()).toBe(200);

    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto(`/render?deck=${clipsId}`);
    await page.waitForFunction(() => window.__morganaRender?.ready === true);

    const frame = (t: number) => page.evaluate(async (t) => {
      const r = window.__morganaRender!;
      if (!r.ready) throw new Error("not ready");
      return (await r.renderFrame(t)).failed;
    }, t);
    const capture = async () => {
      const png = await page.screenshot();
      const dom = await page.evaluate(() => ({
        layers: [...document.querySelectorAll<HTMLElement>(".artstage__layer")].map((e) => [e.dataset.asset, e.style.opacity]),
        videos: [...document.querySelectorAll<HTMLVideoElement>("[data-render-root] video")].map((v) => [
          v.classList.contains("artstage__layer") ? v.dataset.asset : `tile:${v.closest<HTMLElement>(".cin__media")?.dataset.mediaSrc}`,
          Math.round(v.currentTime * 1000) / 1000,
        ] as [string, number]),
      }));
      return { png, dom };
    };
    const timeOf = (dom: { videos: [string, number][] }, key: string) => dom.videos.find((v) => v[0] === key)?.[1];

    const failed: string[] = [];
    const step = async (ts: number[]) => { for (const t of ts) failed.push(...await frame(t)); };

    await step([0, 0.3, 0.6, 0.9, 1.2]);
    const stepA = await capture();
    await step([1.5, 1.8, 2.1, 2.3]);
    const stepCross = await capture();
    await step([2.6, 3.0, 3.4, 3.8, 4.2, 4.6]);
    const stepLoop = await capture();
    // Only the clips matter here (storyboard glyphs may be absent from a dev checkout).
    expect(failed.filter((src) => src.includes("/media/"))).toEqual([]);

    // Sanity: the compared frames show what they claim to.
    expect(Math.abs(timeOf(stepA.dom, h264)! - (0.5 + 1.2))).toBeLessThanOrEqual(1e-3);
    expect(stepCross.dom.layers.map((l) => l[0]).sort()).toEqual([h264, vp9].sort());
    expect(stepCross.dom.videos.map((v) => v[0])).toContain(`tile:${h264}`);
    const tileT = timeOf(stepLoop.dom, `tile:${h264}`)!;
    expect(tileT).toBeGreaterThanOrEqual(0);
    expect(tileT).toBeLessThan(2); // 2.6 s on screen, a 2 s clip: it wrapped

    // Jump forward from the start to mid-crossfade, and to the wrapped tile.
    await frame(0);
    await frame(2.3);
    const jumpCross = await capture();
    expect(jumpCross.dom).toEqual(stepCross.dom);
    expect(jumpCross.png.equals(stepCross.png)).toBe(true);

    await frame(0);
    await frame(4.6);
    const jumpLoop = await capture();
    expect(jumpLoop.dom).toEqual(stepLoop.dom);
    expect(jumpLoop.png.equals(stepLoop.png)).toBe(true);

    // Jump backward across the beat boundary: the h264 art layer is re-created and seeked.
    await frame(1.2);
    const jumpBack = await capture();
    expect(jumpBack.dom).toEqual(stepA.dom);
    expect(jumpBack.png.equals(stepA.png)).toBe(true);
  });

  test("a clip whose media is missing is reported failed and the frame does not hang", async ({ page, request }) => {
    const missing = "media:0000000000000000.mp4";
    const missingDoc = { version: 1, meta: { id: clipsId, title: "Render clips" }, scenes: [{ id: "s0", beats: [
      { id: "a", art: { to: missing, mode: "fade" }, timeline: [{ kind: "wait", ms: 1000 }] },
    ] }] };
    expect((await request.put(`/api/decks/${clipsId}`, { data: missingDoc })).status()).toBe(200);
    await page.goto(`/render?deck=${clipsId}`);
    await page.waitForFunction(() => window.__morganaRender?.ready === true);

    const res = await page.evaluate(async () => {
      const r = window.__morganaRender!;
      if (!r.ready) throw new Error("not ready");
      const t0 = performance.now();
      const out = await Promise.race([
        r.renderFrame(0.5).then((x) => x.failed),
        new Promise<null>((res) => setTimeout(() => res(null), 10_000)),
      ]);
      const src = document.querySelector<HTMLVideoElement>(`video.artstage__layer[data-asset="media:0000000000000000.mp4"]`)?.src;
      return { failed: out, ms: performance.now() - t0, src };
    });
    expect(res.failed, "renderFrame(0.5) did not resolve within 10 s").not.toBeNull();
    expect(res.src).toMatch(/\/media\/0000000000000000\.mp4$/);
    expect(res.failed).toContain(res.src);
    expect(res.ms).toBeLessThan(10_000);
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
