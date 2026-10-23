import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cameraAt, cameraEvents, cameraTransform } from "../engine/authoring/camera-clock";
import type { DeckDoc } from "../engine/deck-doc";

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
  // Byte-equality is the render's contract: a flaky mismatch must fail, never pass on a CI retry.
  test.describe.configure({ retries: 0 });
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
  // Byte-equality is the render's contract: a flaky mismatch must fail, never pass on a CI retry.
  test.describe.configure({ retries: 0 });
  // Per-worker id: --repeat-each runs this describe in parallel workers, which must not share a deck.
  let clipsId = "";
  test.beforeEach(async ({ request }, info) => {
    clipsId = `e2e-render-clips-${info.parallelIndex}`;
    await request.delete(`/api/decks/${clipsId}`).catch(() => {});
    await request.post("/api/decks", { data: { id: clipsId, title: "Render clips" } });
  });
  test.afterEach(async ({ request }) => {
    await request.delete(`/api/decks/${clipsId}`);
    await request.delete(`/api/decks/${clipsId}-noart`).catch(() => {});
  });

  test("clips are deterministic: stepped and jumped frames are byte-equal, across a clip crossfade, a tile loop and a backward jump", async ({ page, request }) => {
    const h264 = await upload(request, clipsId, "clip-h264.mp4", "video/mp4");
    const vp9 = await upload(request, clipsId, "clip-vp9.webm", "video/webm");
    // Beat a (0-2 s): the h264 clip from its 0.5 s in-point. Beat b (2-5 s): crossfade to the vp9 clip
    // (2.0-2.9 s) and a looping h264 tile from ~2 s, so by 4.6 the 2 s tile clip has wrapped.
    const beatB = { id: "b", art: { to: vp9, mode: "crossfade" }, timeline: [
      { kind: "media", id: "tile", pos: { x: 0.6, y: 0.2 }, width: 0.3, src: h264, clip: { loop: true } }, { kind: "wait", ms: 3000 },
    ] };
    const clipDoc = { version: 1, meta: { id: clipsId, title: "Render clips" }, scenes: [{ id: "s0", beats: [
      { id: "a", art: { to: h264, mode: "crossfade", clips: { [h264]: { in: 0.5 } } }, timeline: [{ kind: "wait", ms: 2000 }] },
      beatB,
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

    // Two stage corners: covered by the full-stage art layer but outside the radial .artstage__glow.
    // (An extra composited layer can shift the glow gradient's dithering by 1-2 levels, so the
    // invisibility check compares only where the art alone would contribute.)
    const corners = [{ x: 0, y: 0, width: 140, height: 80 }, { x: 540, y: 310, width: 100, height: 50 }];
    const shootCorners = () => Promise.all(corners.map((clip) => page.screenshot({ clip })));
    await step([0]);
    const stepZero = await capture(); // the h264 art at its fade-in start: clamped to MIN_VIDEO_OPACITY
    const zeroCorners = await shootCorners();
    await step([0.3, 0.6, 0.9, 1.2]);
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
    // Beat a is exactly its 2 s wait, so the tile (beat b's first action) enters at T=2.0 with in 0:
    // at T=4.6 it has been on screen 2.6 s; the 2 s clip loops, so its clip time is 2.6 mod 2 = 0.6
    // (a clip held at its end would read ~2).
    const tileT = timeOf(stepLoop.dom, `tile:${h264}`)!;
    expect(Math.abs(tileT - 0.6)).toBeLessThanOrEqual(1e-3);

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

    // The 1/1024 opacity floor is invisible: at T=0 the clamped h264 layer's corners are byte-equal to
    // T=0 of an otherwise identical deck without beat a's art. Media ids are content hashes, so the refs match.
    expect(stepZero.dom.layers.map((l) => l[0])).toEqual([h264]);
    expect(Number(stepZero.dom.layers[0][1])).toBeCloseTo(1 / 1024, 6); // the style serialises to 9 digits
    const noArt = `${clipsId}-noart`;
    await request.delete(`/api/decks/${noArt}`).catch(() => {});
    await request.post("/api/decks", { data: { id: noArt, title: "Render clips" } });
    expect(await upload(request, noArt, "clip-h264.mp4", "video/mp4")).toBe(h264);
    expect(await upload(request, noArt, "clip-vp9.webm", "video/webm")).toBe(vp9);
    const noArtDoc = { version: 1, meta: { id: noArt, title: "Render clips" }, scenes: [{ id: "s0", beats: [
      { id: "a", timeline: [{ kind: "wait", ms: 2000 }] },
      beatB,
    ] }] };
    expect((await request.put(`/api/decks/${noArt}`, { data: noArtDoc })).status()).toBe(200);
    await page.goto(`/render?deck=${noArt}`);
    await page.waitForFunction(() => window.__morganaRender?.ready === true);
    await frame(0);
    const bare = await capture();
    expect(bare.dom.layers).toEqual([]);
    const bareCorners = await shootCorners();
    bareCorners.forEach((png, i) => expect(png.equals(zeroCorners[i]), `corner ${i}`).toBe(true));
  });

  // Final review I1: in a pinned scene's hold the beat's local time is clamped at its end, which
  // froze tile clips while art layers kept playing. Tiles now run on the unclamped beat clock.
  test("a tile clip keeps playing through a pinned scene's hold, and a held frame is the same stepped or jumped", async ({ page, request }) => {
    const h264 = await upload(request, clipsId, "clip-h264.mp4", "video/mp4");
    // One 5 s pinned scene whose only beat ends at 1.6 s (0.6 s show + 1 s wait): 1.6-5 s is the hold.
    const holdDoc = { version: 1, meta: { id: clipsId, title: "Render clips" }, scenes: [{ id: "s0", durationSec: 5, beats: [
      { id: "a", timeline: [{ kind: "media", id: "tile", pos: { x: 0.5, y: 0.5 }, width: 0.4, src: h264, clip: { loop: true } }, { kind: "wait", ms: 1000 }] },
    ] }] };
    expect((await request.put(`/api/decks/${clipsId}`, { data: holdDoc })).status()).toBe(200);
    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto(`/render?deck=${clipsId}`);
    await page.waitForFunction(() => window.__morganaRender?.ready === true);

    const frame = (t: number) => page.evaluate(async (t) => {
      const r = window.__morganaRender!;
      if (!r.ready) throw new Error("not ready");
      return (await r.renderFrame(t)).failed;
    }, t);
    const tileTime = () => page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>("[data-render-root] .cin__media video");
      return v ? Math.round(v.currentTime * 1000) / 1000 : NaN;
    });

    const failed: string[] = [];
    for (const t of [0, 0.5, 1.0, 1.5, 2.0, 2.5]) failed.push(...await frame(t));
    const atA = await tileTime();
    for (const t of [2.9, 3.3]) failed.push(...await frame(t));
    const atB = await tileTime();
    const stepped = await page.screenshot();
    expect(failed.filter((src) => src.includes("/media/"))).toEqual([]);
    // The tile enters at 0 with in 0 and loops a 2 s clip: 2.5 → 0.5, 3.3 → 1.3 (frozen would be 1.6 twice).
    expect(Math.abs(atA - 0.5)).toBeLessThanOrEqual(1e-3);
    expect(Math.abs(atB - 1.3)).toBeLessThanOrEqual(1e-3);

    await frame(0);
    await frame(3.3);
    expect(await tileTime()).toBe(atB);
    expect((await page.screenshot()).equals(stepped)).toBe(true);
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
    expect(res.failed!.filter((s) => s === res.src)).toHaveLength(1); // reported exactly once
    expect(res.ms).toBeLessThan(10_000);
  });
});

// Camera moves (timed-video sub-project 5). Scene 1 (pinned to 4 s): a still as art, a text line and a
// tile; at 0.5 s a 2 s move to {zoom 3, x 0.3, y 0.4}. Scene 2 (from 4 s) cuts to a clip as art and has
// no move for 1 s, so the framing persists across the cut; at 5 s a 1 s move back to zoom 1.
// Uploaded media, not storyboard art: storyboard files may be absent (a dev checkout, CI), and a
// broken-image icon under a zoom rasterises differently depending on history.
const cameraDocFor = (id: string, still: string, clip: string) => ({ version: 1, meta: { id, title: "Camera" }, scenes: [
  { id: "s1", durationSec: 4, beats: [{ id: "a", art: { to: still, mode: "cut" }, timeline: [
    { kind: "wait", ms: 500 }, { kind: "camera", to: { zoom: 3, x: 0.3, y: 0.4 }, durationMs: 2000 },
    { kind: "text", value: "Camera line", in: "fade" },
    { kind: "media", id: "tile", pos: { x: 0.3, y: 0.4 }, label: "tile" }, { kind: "wait", ms: 3500 },
  ] }] },
  { id: "s2", beats: [{ id: "b", art: { to: clip, mode: "cut" }, timeline: [
    { kind: "text", value: "Second line", in: "fade" }, { kind: "wait", ms: 1000 },
    { kind: "camera", to: { zoom: 1 }, durationMs: 1000 }, { kind: "wait", ms: 2000 },
  ] }] },
] });
// The text-fixed fixture: one line fully in at zoom 1, then a 1 s move to zoom 3 (centered, so the
// world grows from the top-left by exactly x3).
const textDocFor = (id: string, still: string) => ({ version: 1, meta: { id, title: "Camera text" }, scenes: [
  { id: "s1", beats: [{ id: "a", art: { to: still, mode: "cut" }, timeline: [
    { kind: "text", value: "Steady words", in: "fade" }, { kind: "wait", ms: 1500 },
    { kind: "camera", to: { zoom: 3 }, durationMs: 1000 }, { kind: "wait", ms: 1500 },
  ] }] },
] });

test.describe("camera", () => {
  // Byte-equality is the render's contract: a flaky mismatch must fail, never pass on a CI retry.
  test.describe.configure({ retries: 0 });
  let camId = "";
  test.beforeEach(async ({ request }, info) => {
    camId = `e2e-render-camera-${info.parallelIndex}`;
    await request.delete(`/api/decks/${camId}`).catch(() => {});
    await request.post("/api/decks", { data: { id: camId, title: "Camera" } });
  });
  test.afterEach(async ({ request }) => { await request.delete(`/api/decks/${camId}`); });

  /** `s` as the browser serialises it back from `style.transform` (Chromium keeps ~6 significant
   *  digits, so the 6-decimal string the page wrote reads back shorter). */
  const cssTransform = (page: import("@playwright/test").Page, s: string) => page.evaluate((s) => {
    const el = document.createElement("div");
    el.style.transform = s;
    return el.style.transform;
  }, s);

  const open = async (page: import("@playwright/test").Page) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto(`/render?deck=${camId}`);
    await page.waitForFunction(() => window.__morganaRender?.ready === true);
    return (t: number) => page.evaluate(async (t) => {
      const r = window.__morganaRender!;
      if (!r.ready) throw new Error("not ready");
      await r.renderFrame(t);
    }, t);
  };

  test("camera is deterministic: stepped and jumped frames are byte-equal mid-zoom, after a cut and on a backward jump", async ({ page, request }) => {
    const still = await upload(request, camId, "still.png", "image/png");
    const clip = await upload(request, camId, "clip-h264.mp4", "video/mp4");
    const camDoc = cameraDocFor(camId, still, clip);
    expect((await request.put(`/api/decks/${camId}`, { data: camDoc })).status()).toBe(200);
    const ev = cameraEvents(camDoc as unknown as DeckDoc);
    const frame = await open(page);
    const capture = async () => {
      const png = await page.screenshot();
      const dom = await page.evaluate(() => {
        const tf = (sel: string) => [...document.querySelectorAll<HTMLElement>(`[data-render-root] ${sel}`)].map((e) => e.style.transform);
        return {
          art: tf(".artstage__world"), cin: tf(".cin__world"), beat: tf(".beat__world"), stage: tf(".cin__stage"),
          layers: [...document.querySelectorAll<HTMLElement>(".artstage__layer")].map((e) => e.dataset.asset),
          text: [...document.querySelectorAll<HTMLElement>("[data-render-root] .cin__line")].map((e) => e.textContent),
        };
      });
      return { png, dom };
    };
    const expectFraming = async (dom: Awaited<ReturnType<typeof capture>>["dom"], T: number) => {
      const want = await cssTransform(page, cameraTransform(cameraAt(ev, T)));
      expect(dom.art).toEqual([want]);
      expect(dom.cin).toEqual([want]);
      expect(dom.beat).toEqual([want, want]);
      expect(dom.stage).toEqual([""]); // the text layer never moves
    };

    // A bottom-right patch of the frame that only the art covers (the text is top-left, the tile near
    // (0.3, 0.4), the glow is fixed): between T=0.5 (zoom 1, the move's start) and T=1.0 only the camera
    // changes it.
    const artOnly = { x: 440, y: 280, width: 200, height: 80 };

    // Stepping through the whole deck.
    for (const t of [0, 0.25, 0.5]) await frame(t);
    const preMoveArt = await page.screenshot({ clip: artOnly });
    for (const t of [0.75, 1.0]) await frame(t);
    const stepMid = await capture();
    const midMoveArt = await page.screenshot({ clip: artOnly });
    for (const t of [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5]) await frame(t);
    const stepCut = await capture();
    for (const t of [5.0, 5.2, 5.4]) await frame(t);
    const stepOut = await capture();

    // Sanity: the compared frames really are mid-zoom / held across the cut / mid zoom-out.
    expect(cameraAt(ev, 1.0).zoom).toBeGreaterThan(1);
    expect(cameraAt(ev, 1.0).zoom).toBeLessThan(3);
    const held = cameraAt(ev, 4.5); // scene 2, before its move: scene 1's end framing
    expect(held.zoom).toBeCloseTo(3, 9);
    expect(held.x).toBeCloseTo(0.3, 9);
    expect(held.y).toBeCloseTo(0.4, 9);
    expect(cameraAt(ev, 5.4).zoom).toBeGreaterThan(1);
    expect(cameraAt(ev, 5.4).zoom).toBeLessThan(3);
    await expectFraming(stepMid.dom, 1.0);
    expect(stepMid.dom.text).toEqual(["Camera line"]);
    expect(stepMid.dom.layers).toEqual([still]);
    await expectFraming(stepCut.dom, 4.5);
    expect(stepCut.dom.text).toEqual(["Second line"]);
    expect(stepCut.dom.layers).toEqual([clip]);
    await expectFraming(stepOut.dom, 5.4);
    // The PNG half can't pass with an invisible camera: the frames differ in pixels, and the art-only
    // patch differs between zoom 1 and mid-zoom.
    expect(stepMid.png.equals(stepCut.png)).toBe(false);
    expect(stepCut.png.equals(stepOut.png)).toBe(false);
    expect(preMoveArt.equals(midMoveArt), "the camera moved the art pixels").toBe(false);

    // Jumps from the start straight to each point.
    for (const [T, stepped] of [[1.0, stepMid], [4.5, stepCut], [5.4, stepOut]] as const) {
      await frame(0);
      await frame(T);
      const jumped = await capture();
      expect(jumped.dom, `T=${T}`).toEqual(stepped.dom);
      expect(jumped.png.equals(stepped.png), `T=${T}`).toBe(true);
    }

    // Backward jump from 5.4 (scene 2, mid zoom-out) to 1.0 (scene 1, mid zoom-in).
    await frame(1.0);
    const jumpBack = await capture();
    expect(jumpBack.dom).toEqual(stepMid.dom);
    expect(jumpBack.png.equals(stepMid.png)).toBe(true);
  });

  test("text stays fixed while the world zooms: the line's rect is unchanged at zoom 1 and zoom 3; the art world's is x3", async ({ page, request }) => {
    const textDoc = textDocFor(camId, await upload(request, camId, "still.png", "image/png"));
    expect((await request.put(`/api/decks/${camId}`, { data: textDoc })).status()).toBe(200);
    const ev = cameraEvents(textDoc as unknown as DeckDoc);
    expect(ev).toHaveLength(1);
    const z1 = ev[0].start - 0.05, z3 = ev[0].start + ev[0].duration + 0.5;
    expect(cameraAt(ev, z1).zoom).toBe(1);
    expect(cameraAt(ev, z3).zoom).toBeCloseTo(3, 9);
    const frame = await open(page);
    const measure = () => page.evaluate(() => {
      const rect = (sel: string) => {
        const els = document.querySelectorAll<HTMLElement>(`[data-render-root] ${sel}`);
        if (els.length !== 1) throw new Error(`${sel}: ${els.length} elements`);
        const r = els[0].getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return { line: rect(".cin__line"), box: rect(".cin__text"), world: rect(".artstage__world"), root: rect(".artstage") };
    });

    await frame(z1);
    const atOne = await measure();
    await frame(z3);
    const atThree = await measure();

    expect(atOne.line.width).toBeGreaterThan(0);
    for (const k of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(atThree.line[k] - atOne.line[k]), `line ${k}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(atThree.box[k] - atOne.box[k]), `text box ${k}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(atThree.root[k] - atOne.root[k]), `artstage root ${k}`).toBeLessThanOrEqual(0.5); // the root stays fixed
    }
    expect(Math.abs(atThree.world.width - 3 * atOne.world.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(atThree.world.height - 3 * atOne.world.height)).toBeLessThanOrEqual(1);
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
