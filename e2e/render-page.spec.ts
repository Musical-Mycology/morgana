import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cameraAt, cameraEvents, cameraTransform } from "../engine/authoring/camera-clock";
import { deckLayout } from "../engine/authoring/deck-clock";
import { fadeAt, fadeEvents } from "../engine/authoring/fade-clock";
import { DRAW_VARIANT } from "../engine/components/effects/draw-state";
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

  // Final review I1: note sprites and art layers carried `will-change: transform`, and Chromium keeps
  // such a layer's raster scale, so under a zooming ancestor the pixels could depend on the zoom the
  // sprite was first rastered at — i.e. on how the render reached the frame.
  test("notes and objects under a zoom: stepped, jumped and backward-jumped frames are byte-equal", async ({ page, request }) => {
    const still = await upload(request, camId, "still.png", "image/png");
    const doc = { version: 1, meta: { id: camId, title: "Camera notes" }, scenes: [{ id: "s1",
      objects: [
        { id: "words", kind: "text", text: "Object words", transform: { x: 0.5, y: 0.5, w: 0.3, h: 0.1 }, style: { size: "md", color: "#ffffff" } },
        { id: "ring", kind: "shape", shape: "ellipse", stroke: { color: "#ffe08a", width: 0.004 }, transform: { x: 0.36, y: 0.62, w: 0.12, h: 0.12 } },
      ],
      beats: [{ id: "a", art: { to: still, mode: "cut" }, timeline: [
        { kind: "note_emitter", color: "#3FFBFF", pos: { x: 0.42, y: 0.66 }, dir: 0, var: 40, decay: 3000, freq: 5 },
        { kind: "wait", ms: 500 }, { kind: "camera", to: { zoom: 3, x: 0.45, y: 0.6 }, durationMs: 2000 }, { kind: "wait", ms: 3000 },
      ] }] }] };
    expect((await request.put(`/api/decks/${camId}`, { data: doc })).status()).toBe(200);
    // Storyboard glyphs may be absent from a checkout (an unloaded mask paints nothing): serve a
    // fine-lined glyph for every note so the sprites really draw.
    const glyph = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="none" stroke="#fff" stroke-width="2">
      <ellipse cx="22" cy="48" rx="10" ry="7"/><path d="M32 48V8l18 8"/><path d="M8 20h48M8 26h48M8 32h48"/></g></svg>`;
    await page.route("**/storyboard/notes/**", (r) => r.fulfill({ contentType: "image/svg+xml", body: glyph }));
    const frame = await open(page);
    const capture = async () => {
      const png = await page.screenshot();
      const dom = await page.evaluate(() => ({
        beat: [...document.querySelectorAll<HTMLElement>("[data-render-root] .beat__world")].map((e) => e.style.transform),
        notes: [...document.querySelectorAll<HTMLElement>("[data-render-root] .notefield__stage > *")]
          .filter((e) => e.style.display !== "none").map((e) => [e.style.left, e.style.top, e.style.opacity, e.style.transform]),
      }));
      return { png, dom };
    };

    const ts: number[] = [];
    for (let t = 0; t <= 3.0 + 1e-9; t += 1 / 10) ts.push(Math.round(t * 10) / 10);
    const stepped = new Map<number, Awaited<ReturnType<typeof capture>>>();
    for (const t of ts) {
      await frame(t);
      if (t === 1.5 || t === 3.0) stepped.set(t, await capture());
    }
    const mid = stepped.get(1.5)!, held = stepped.get(3.0)!;
    // Sanity: notes are on screen in both frames, mid-zoom and fully zoomed, and the frames differ.
    expect(mid.dom.notes.length).toBeGreaterThan(3);
    expect(held.dom.notes.length).toBeGreaterThan(3);
    expect(mid.dom.beat[0]).toContain("scale(");
    expect(held.dom.beat[0]).toContain("scale(3)");
    expect(mid.png.equals(held.png)).toBe(false);

    for (const [T, want] of [[1.5, mid], [3.0, held]] as const) {
      await frame(0);
      await frame(T);
      const jumped = await capture();
      expect(jumped.dom, `jump T=${T}`).toEqual(want.dom);
      expect(jumped.png.equals(want.png), `jump T=${T}`).toBe(true);
    }
    // Backward: 3.0 → 1.5 (sprites rastered at zoom 3 come back to a smaller zoom).
    await frame(3.0);
    await frame(1.5);
    const back = await capture();
    expect(back.dom).toEqual(mid.dom);
    expect(back.png.equals(mid.png), "backward jump T=1.5").toBe(true);
  });

  // Final review I2: a tile clip the camera pushes out of view, then brings back. Off view it is
  // never presented (no requestVideoFrameCallback), so each seek could wait out the fallback, and its
  // first frame back in view could be stale.
  test("a tile clip zoomed out of view and back: the re-entry frame is the same stepped or jumped", async ({ page, request }, info) => {
    const still = await upload(request, camId, "still.png", "image/png");
    const clip = await upload(request, camId, "clip-h264.mp4", "video/mp4");
    // Tile centred at (0.1, 0.1). 0.5-1.0 s: zoom 4 onto (0.8, 0.8) — the tile leaves the view.
    // 2.0-2.6 s: back to full frame — it re-enters.
    const doc = { version: 1, meta: { id: camId, title: "Camera tile" }, scenes: [{ id: "s1", beats: [{ id: "a", art: { to: still, mode: "cut" }, timeline: [
      { kind: "media", id: "tile", pos: { x: 0.1, y: 0.1 }, width: 0.15, src: clip, clip: { loop: true } },
      { kind: "wait", ms: 500 }, { kind: "camera", to: { zoom: 4, x: 0.8, y: 0.8 }, durationMs: 500 },
      { kind: "wait", ms: 1500 }, { kind: "camera", to: { zoom: 1 }, durationMs: 600 }, { kind: "wait", ms: 1500 },
    ] }] }] };
    expect((await request.put(`/api/decks/${camId}`, { data: doc })).status()).toBe(200);
    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto(`/render?deck=${camId}`);
    await page.waitForFunction(() => window.__morganaRender?.ready === true);
    const frame = (t: number) => page.evaluate(async (t) => {
      const r = window.__morganaRender!;
      if (!r.ready) throw new Error("not ready");
      const t0 = performance.now();
      const failed = (await r.renderFrame(t)).failed;
      const ms = performance.now() - t0;
      const v = document.querySelector<HTMLVideoElement>("[data-render-root] .cin__media video")!;
      const a = v.getBoundingClientRect(), s = document.querySelector<HTMLElement>("[data-render-root]")!.getBoundingClientRect();
      const visible = a.right > s.left && a.left < s.right && a.bottom > s.top && a.top < s.bottom;
      return { failed, ms, visible, clipT: Math.round(v.currentTime * 1000) / 1000 };
    }, t);

    const ts: number[] = [];
    for (let i = 0; i <= 33; i++) ts.push(i / 10);
    const log: { T: number; ms: number; visible: boolean; clipT: number }[] = [];
    const shots = new Map<number, Buffer>();
    for (const T of ts) {
      const r = await frame(T);
      expect(r.failed.filter((s) => s.includes("/media/"))).toEqual([]);
      log.push({ T, ms: Math.round(r.ms), visible: r.visible, clipT: r.clipT });
      shots.set(T, await page.screenshot());
    }
    const table = log.map((l) => `T=${l.T.toFixed(1)} ${l.visible ? "in " : "OFF"} clip=${l.clipT.toFixed(3)} ${l.ms}ms`).join("\n");
    console.log(`[camera tile timing]\n${table}`);
    await info.attach("camera-tile-timing", { body: table, contentType: "text/plain" });

    const offFrames = log.filter((l) => !l.visible);
    expect(offFrames.length, "the camera pushes the tile out of view").toBeGreaterThan(5);
    const firstOff = log.findIndex((l) => !l.visible);
    const reentry = log.findIndex((l, i) => i > firstOff && l.visible);
    expect(reentry, "the tile comes back into view").toBeGreaterThan(firstOff);
    const reT = log[reentry].T;
    // The tile enters at 0 with in 0 and loops a 2 s clip: its clip time is T mod 2 on every frame,
    // off view included.
    for (const l of log) expect(Math.abs(l.clipT - (l.T % 2)), `clip time at T=${l.T}`).toBeLessThanOrEqual(1e-3);

    for (const T of [reT, log[reentry + 1].T]) {
      await frame(0);
      await frame(T);
      expect((await page.screenshot()).equals(shots.get(T)!), `jumped vs stepped at T=${T}`).toBe(true);
    }
    // Backward from the end into the re-entry frame.
    await frame(3.3);
    await frame(reT);
    expect((await page.screenshot()).equals(shots.get(reT)!), `backward to T=${reT}`).toBe(true);
  });
});

// Notes without a camera: note sprites animate their own scale and opacity, and Chromium's raster
// history made a stepped frame differ from the same frame jumped to (up to 47 levels), camera or not.
test.describe("notes", () => {
  // Byte-equality is the render's contract: a flaky mismatch must fail, never pass on a CI retry.
  test.describe.configure({ retries: 0 });
  let noteId = "";
  test.beforeEach(async ({ request }, info) => {
    noteId = `e2e-render-notes-${info.parallelIndex}`;
    await request.delete(`/api/decks/${noteId}`).catch(() => {});
    await request.post("/api/decks", { data: { id: noteId, title: "Notes" } });
  });
  test.afterEach(async ({ request }) => { await request.delete(`/api/decks/${noteId}`); });

  test("notes without a camera: stepped, jumped and backward-jumped frames are byte-equal", async ({ page, request }) => {
    const still = await upload(request, noteId, "still.png", "image/png");
    const doc = { version: 1, meta: { id: noteId, title: "Notes" }, scenes: [{ id: "s1",
      objects: [
        { id: "words", kind: "text", text: "Object words", transform: { x: 0.5, y: 0.5, w: 0.3, h: 0.1 }, style: { size: "md", color: "#ffffff" } },
        { id: "ring", kind: "shape", shape: "ellipse", stroke: { color: "#ffe08a", width: 0.004 }, transform: { x: 0.36, y: 0.62, w: 0.12, h: 0.12 } },
      ],
      beats: [{ id: "a", art: { to: still, mode: "cut" }, timeline: [
        { kind: "note_emitter", color: "#3FFBFF", pos: { x: 0.42, y: 0.66 }, dir: 0, var: 40, decay: 3000, freq: 5 },
        { kind: "wait", ms: 3500 },
      ] }] }] };
    expect((await request.put(`/api/decks/${noteId}`, { data: doc })).status()).toBe(200);
    expect(cameraEvents(doc as unknown as DeckDoc)).toHaveLength(0);
    // Storyboard glyphs may be absent from a checkout (an unloaded mask paints nothing): serve a
    // fine-lined glyph for every note so the sprites really draw.
    const glyph = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="none" stroke="#fff" stroke-width="2">
      <ellipse cx="22" cy="48" rx="10" ry="7"/><path d="M32 48V8l18 8"/><path d="M8 20h48M8 26h48M8 32h48"/></g></svg>`;
    await page.route("**/storyboard/notes/**", (r) => r.fulfill({ contentType: "image/svg+xml", body: glyph }));
    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto(`/render?deck=${noteId}`);
    await page.waitForFunction(() => window.__morganaRender?.ready === true);
    const frame = (t: number) => page.evaluate(async (t) => {
      const r = window.__morganaRender!;
      if (!r.ready) throw new Error("not ready");
      await r.renderFrame(t);
    }, t);
    const capture = async () => {
      const png = await page.screenshot();
      const dom = await page.evaluate(() => ({
        notes: [...document.querySelectorAll<HTMLElement>("[data-render-root] .notefield__stage > *")]
          .filter((e) => e.style.display !== "none").map((e) => [e.style.left, e.style.top, e.style.opacity, e.style.transform]),
      }));
      return { png, dom };
    };

    const ts: number[] = [];
    for (let t = 0; t <= 3.0 + 1e-9; t += 1 / 10) ts.push(Math.round(t * 10) / 10);
    const stepped = new Map<number, Awaited<ReturnType<typeof capture>>>();
    for (const t of ts) {
      await frame(t);
      if (t === 1.5 || t === 3.0) stepped.set(t, await capture());
    }
    const mid = stepped.get(1.5)!, late = stepped.get(3.0)!;
    // Sanity: notes are on screen in both frames, and the frames differ.
    expect(mid.dom.notes.length).toBeGreaterThan(3);
    expect(late.dom.notes.length).toBeGreaterThan(3);
    expect(mid.png.equals(late.png)).toBe(false);

    for (const [T, want] of [[1.5, mid], [3.0, late]] as const) {
      await frame(0);
      await frame(T);
      const jumped = await capture();
      expect(jumped.dom, `jump T=${T}`).toEqual(want.dom);
      expect(jumped.png.equals(want.png), `jump T=${T}`).toBe(true);
    }
    // Backward: 3.0 → 1.5.
    await frame(3.0);
    await frame(1.5);
    const back = await capture();
    expect(back.dom).toEqual(mid.dom);
    expect(back.png.equals(mid.png), "backward jump T=1.5").toBe(true);
  });
});

// Sub-project 6: a drawn title with particles, an HTML (letterFly) and a cursive particle line, a
// credits roll with particles, and a fade to black.
test.describe("credits", () => {
  // Byte-equality is the render's contract: a flaky mismatch must fail, never pass on a CI retry.
  test.describe.configure({ retries: 0 });
  let creditsId = "";
  test.beforeEach(async ({ request }, info) => {
    creditsId = `e2e-render-credits-${info.parallelIndex}`;
    await request.delete(`/api/decks/${creditsId}`).catch(() => {});
    await request.post("/api/decks", { data: { id: creditsId, title: "Credits" } });
  });
  test.afterEach(async ({ request }) => { await request.delete(`/api/decks/${creditsId}`); });

  test("draw, particle lines, roll + particles and fade: stepped, jumped and backward-jumped frames are byte-equal; the last frame is pure black", async ({ page, request }) => {
    test.setTimeout(180_000);
    const still = await upload(request, creditsId, "still.png", "image/png");
    // The drawn title holds wide/complex glyphs (W, @, g): the 12em dash bound must cover them. 7 chars → 1.06 s.
    const TITLE = "W@gging";
    // Title draws over 0–1.06 s; "Spores" letter-flies over 1.06–2.06 s ((0.5 + 6·0.03) / 0.68); "fin" types
    // in the cursive face over 2.06–3.06 s ((0.1 + 3·0.045) / 0.235); the roll runs 3.06–7.06 s; the fade
    // runs 7.06–8.06 s (under the wait); the deck ends at 8.56 s.
    const doc = { version: 1, meta: { id: creditsId, title: "Credits" }, scenes: [{ id: "s1", beats: [{ id: "a", art: { to: still, mode: "cut" }, timeline: [
      { kind: "text", value: TITLE, in: "draw", align: "center", pos: { x: 0.5, y: 0.06 }, particles: { color: "cyan", rate: 8 } },
      // Ruling F3: an HTML particle line mid-SplitText must measure as it does at rest.
      { kind: "text", value: "Spores", in: "letterFly", speed: 0.68, align: "center", pos: { x: 0.5, y: 0.2 }, particles: { color: "pink", rate: 8 } },
      // A particle line in a second face (the script face): its metrics, not a fallback's, place the sources.
      { kind: "text", value: "fin", in: "cursive", speed: 0.235, align: "left", pos: { x: 0.03, y: 0.55 }, particles: { color: "cream", rate: 8 } },
      { kind: "credits", items: [{ role: "Directed by", names: ["Ann Lee"] }, { role: "Music", names: ["Bo Chen", "Cy Diaz"] }, { names: ["Thanks for watching"] }],
        durationMs: 4000, particles: { color: "lime", rate: 6 } },
      { kind: "screen_fade", to: 1, durationMs: 1000 },
      { kind: "wait", ms: 1500 },
    ] }] }] };
    expect((await request.put(`/api/decks/${creditsId}`, { data: doc })).status()).toBe(200);
    const d = doc as unknown as DeckDoc;
    const TOTAL = deckLayout(d).total;
    const MID_DRAW = 0.5, MID_FLY = 1.5, MID_CURSIVE = 2.5, MID_ROLL = 5.0, MID_FADE = 7.6;
    expect(TOTAL).toBeCloseTo(8.56, 9);
    // Storyboard glyphs may be absent from a checkout (an unloaded mask paints nothing): serve a
    // fine-lined glyph for every note so the sprites really draw.
    const glyph = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="none" stroke="#fff" stroke-width="2">
      <ellipse cx="22" cy="48" rx="10" ry="7"/><path d="M32 48V8l18 8"/><path d="M8 20h48M8 26h48M8 32h48"/></g></svg>`;
    await page.route("**/storyboard/notes/**", (r) => r.fulfill({ contentType: "image/svg+xml", body: glyph }));
    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto(`/render?deck=${creditsId}`);
    await page.waitForFunction(() => window.__morganaRender?.ready === true);
    const frame = (t: number) => page.evaluate(async (t) => {
      const r = window.__morganaRender!;
      if (!r.ready) throw new Error("not ready");
      await r.renderFrame(t);
    }, t);
    const capture = async () => {
      const png = await page.screenshot();
      const dom = await page.evaluate(() => {
        const q = (s: string) => document.querySelector<HTMLElement>(`[data-render-root] ${s}`);
        const fade = q(".deck__fade");
        return {
          draw: [...document.querySelectorAll<SVGElement>("[data-render-root] .cin__draw tspan")].map((e) => [e.style.getPropertyValue("--d"), e.style.getPropertyValue("--f")]),
          // Each built line's text and how many elements it holds (a SplitText line is split into many).
          lines: [...document.querySelectorAll<HTMLElement>("[data-render-root] .cin__line")].map((e) => [e.textContent, e.querySelectorAll("*").length]),
          roll: q(".cin__credits-roll")?.style.transform ?? null,
          text: [...document.querySelectorAll<HTMLElement>("[data-render-root] .notefield__text > *")]
            .filter((e) => e.style.display !== "none").map((e) => [e.style.left, e.style.top, e.style.opacity, e.style.transform]),
          fade: fade ? [fade.style.display, fade.style.opacity, fade.style.background] : null,
        };
      });
      return { png, dom };
    };

    const ts: number[] = [];
    for (let i = 0; i <= 85; i++) ts.push(i / 10);
    ts.push(TOTAL);
    const stepped = new Map<number, Awaited<ReturnType<typeof capture>>>();
    for (const t of ts) {
      await frame(t);
      if ([MID_DRAW, MID_FLY, MID_CURSIVE, MID_ROLL, MID_FADE, TOTAL].includes(t)) stepped.set(t, await capture());
    }
    const draw = stepped.get(MID_DRAW)!, fly = stepped.get(MID_FLY)!, cursive = stepped.get(MID_CURSIVE)!;
    const roll = stepped.get(MID_ROLL)!, fade = stepped.get(MID_FADE)!, last = stepped.get(TOTAL)!;

    // Sanity: each compared frame really is mid-effect.
    expect(draw.dom.draw.length).toBe(TITLE.length);
    if (DRAW_VARIANT === "dash") expect(draw.dom.draw.some(([dd]) => Number(dd) > 0 && Number(dd) < 1)).toBe(true);
    expect(draw.dom.draw.every(([, f]) => f === "0")).toBe(true);          // fill not started
    expect(draw.dom.text.length).toBeGreaterThan(0);                       // title particles already flying
    const line = (c: typeof draw, s: string) => c.dom.lines.find(([v]) => v === s);
    expect(line(fly, "Spores")).toBeTruthy();                              // letterFly in flight (split)
    expect(line(fly, "Spores")![1]).toBeGreaterThan(line(roll, "Spores")![1] as number);
    expect(fly.dom.text.length).toBeGreaterThan(draw.dom.text.length);
    expect(line(cursive, "fin")).toBeTruthy();
    expect(roll.dom.roll).toMatch(/^translateY\(-?[\d.]+px\)$/);
    expect(roll.dom.text.length).toBeGreaterThan(3);
    expect(fade.dom.fade![0]).toBe("block");
    expect(Number(fade.dom.fade![1])).toBeCloseTo(fadeAt(fadeEvents(d), MID_FADE).level, 5);
    expect(last.dom.fade!.slice(0, 2)).toEqual(["block", "1"]);
    expect(draw.png.equals(roll.png)).toBe(false);

    for (const [T, want] of [[MID_DRAW, draw], [MID_FLY, fly], [MID_CURSIVE, cursive], [MID_ROLL, roll], [MID_FADE, fade], [TOTAL, last]] as const) {
      await frame(0);
      await frame(T);
      const jumped = await capture();
      expect(jumped.dom, `jump T=${T}`).toEqual(want.dom);
      expect(jumped.png.equals(want.png), `jump T=${T}`).toBe(true);
    }
    // Backward: mid-fade → mid-draw (the overlay goes away, the title re-draws).
    await frame(MID_FADE);
    await frame(MID_DRAW);
    const back = await capture();
    expect(back.dom).toEqual(draw.dom);
    expect(back.png.equals(draw.png), `backward jump T=${MID_DRAW}`).toBe(true);

    // The last frame is pure black: byte-equal to a black page of the same size.
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#000"></body></html>`);
    expect(last.png.equals(await page.screenshot()), "the last frame is pure black").toBe(true);
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
