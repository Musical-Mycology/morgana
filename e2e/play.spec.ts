import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBinary } from "../lib/render/ffmpeg";
import { cameraAt, cameraEvents, cameraTransform } from "../engine/authoring/camera-clock";
import { creditsOffset } from "../engine/deck/credits";
import { fadeAt, fadeEvents } from "../engine/authoring/fade-clock";
import type { DeckDoc } from "../engine/deck-doc";

const ffmpeg = resolveBinary("ffmpeg", process.env);
const hasFfmpeg = (() => { const r = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }); return !r.error && r.status === 0; })();

const id = "e2e-play";
const doc = { version: 1, meta: { id, title: "Play", timing: { targetSec: 12 } }, scenes: [
  { id: "opening", durationSec: 4, beats: [{ id: "a", timeline: [{ kind: "text", value: "Opening line", in: "fade" }, { kind: "wait", ms: 1000 }] }] },
  { id: "middle", durationSec: 6, beats: [{ id: "b", timeline: [{ kind: "text", value: "Second scene", in: "fade" }, { kind: "wait", ms: 2000 }] }] },
  { id: "credits", beats: [{ id: "c", timeline: [{ kind: "text", value: "Credits", in: "fade" }, { kind: "wait", ms: 1000 }] }] },
] };

test.beforeEach(async ({ request }) => {
  await request.delete(`/api/decks/${id}`).catch(() => {});
  await request.post("/api/decks", { data: { id, title: "Play" } });
  await request.put(`/api/decks/${id}`, { data: doc });
});
test.afterEach(async ({ request }) => { await request.delete(`/api/decks/${id}`); });

test("?t= deep-link starts at that time in the right scene", async ({ page }) => {
  await page.goto(`/play?deck=${id}&t=5`);
  await expect(page.getByTestId("play-clock")).toHaveText("0:05.0 / 0:12");
  await expect(page.getByTestId("play-stage")).toContainText("Second scene");
});

test("Space plays and pauses; a paused clock does not move", async ({ page }) => {
  await page.goto(`/play?deck=${id}`);
  await expect(page.getByTestId("play-clock")).toHaveText("0:00.0 / 0:12");
  await page.keyboard.press(" ");
  await expect(page.getByTestId("play-clock")).not.toHaveText("0:00.0 / 0:12");
  await page.keyboard.press(" ");
  const frozen = await page.getByTestId("play-clock").textContent();
  await page.waitForTimeout(500);
  await expect(page.getByTestId("play-clock")).toHaveText(frozen!);
});

test("scrubbing the bar jumps in deck time", async ({ page }) => {
  await page.goto(`/play?deck=${id}`);
  const bar = page.getByTestId("play-scrub");
  const box = (await bar.boundingBox())!;
  await page.mouse.click(box.x + box.width * (7 / 12), box.y + box.height / 2);
  await expect(page.getByTestId("play-scene")).toHaveText("middle");
  await expect(page.getByTestId("play-stage")).toContainText("Second scene");
});

test("unknown deck shows the load error", async ({ page }) => {
  await page.goto(`/play?deck=e2e-does-not-exist`);
  await expect(page.getByTestId("play-error")).toBeVisible();
});

test.describe("clips", () => {
  // Per-worker deck id: parallel workers (--repeat-each) must not share a deck.
  let clipId = "";
  test.beforeEach(({}, info) => { clipId = `e2e-play-clip-${info.parallelIndex}`; });
  test.afterEach(async ({ request }) => { await request.delete(`/api/decks/${clipId}`); });

  test("clip follows the deck clock: deep-link, play, scrub back", async ({ page, request }) => {
    await request.delete(`/api/decks/${clipId}`).catch(() => {});
    await request.post("/api/decks", { data: { id: clipId, title: "Play clip" } });
    const buffer = readFileSync(fileURLToPath(new URL("./fixtures/media/clip-h264.mp4", import.meta.url)));
    const up = await request.post(`/api/decks/${clipId}/media`, { multipart: { file: { name: "clip-h264.mp4", mimeType: "video/mp4", buffer } } });
    expect(up.status()).toBe(201);
    const clip = `media:${(await up.json()).id}`;
    // One 4 s beat; the 2 s clip enters at T=0 with no in-point, so its clip time is the deck time (held after 2 s).
    const clipDoc = { version: 1, meta: { id: clipId, title: "Play clip", timing: { targetSec: 4 } }, scenes: [
      { id: "s", durationSec: 4, beats: [{ id: "a", art: { to: clip, mode: "fade" }, timeline: [{ kind: "wait", ms: 4000 }] }] },
    ] };
    expect((await request.put(`/api/decks/${clipId}`, { data: clipDoc })).status()).toBe(200);

    const sel = `video.artstage__layer[data-asset="${clip}"]`;
    const clipTime = () => page.evaluate((s) => document.querySelector<HTMLVideoElement>(s)?.currentTime ?? NaN, sel);

    await page.goto(`/play?deck=${clipId}&t=1`);
    await expect(page.getByTestId("play-clock")).toHaveText("0:01.0 / 0:04");
    await page.waitForFunction((s) => (document.querySelector<HTMLVideoElement>(s)?.readyState ?? 0) >= 2, sel);
    await expect.poll(clipTime).toBeGreaterThan(1 - 0.15);
    expect(Math.abs((await clipTime()) - 1)).toBeLessThanOrEqual(0.15);

    // Playing: the clip advances with the deck clock.
    const before = await clipTime();
    await page.keyboard.press(" ");
    await expect.poll(clipTime, { timeout: 3000 }).toBeGreaterThan(before + 0.5);
    await page.keyboard.press(" "); // pause, so the scrub target holds

    // Scrub back to 0.3 s: the paused clip seeks exactly there.
    const bar = page.getByTestId("play-scrub");
    const box = (await bar.boundingBox())!;
    await page.mouse.click(box.x + box.width * (0.3 / 4), box.y + box.height / 2);
    await expect.poll(async () => Math.abs((await clipTime()) - 0.3)).toBeLessThanOrEqual(0.15);
  });

  // Final review I2: on long-GOP footage a /play seek decodes from a keyframe up to 8 s back, so it
  // lands behind a deck clock that kept moving; drift correction then re-seeked forever (a stuck,
  // stuttering clip). The clip must keep advancing and converge on the deck clock.
  test("a long-GOP 1080p clip keeps advancing and converges on the deck clock", async ({ page, request }) => {
    if (process.env.CI) expect(hasFfmpeg, `ffmpeg not found (${ffmpeg}) — the CI e2e job must install it`).toBe(true);
    test.skip(!hasFfmpeg, "ffmpeg not installed — the CI job installs it");
    test.setTimeout(90_000);
    const dir = mkdtempSync(join(tmpdir(), "morgana-gop-"));
    try {
      const file = join(dir, "gop250.mp4");
      const enc = spawnSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=10",
        "-c:v", "libx264", "-g", "250", "-pix_fmt", "yuv420p", "-an", file]);
      expect(enc.status, enc.stderr?.toString()).toBe(0);

      await request.delete(`/api/decks/${clipId}`).catch(() => {});
      await request.post("/api/decks", { data: { id: clipId, title: "GOP clip" } });
      const up = await request.post(`/api/decks/${clipId}/media`, { multipart: { file: { name: "gop250.mp4", mimeType: "video/mp4", buffer: readFileSync(file) } } });
      expect(up.status()).toBe(201);
      const clip = `media:${(await up.json()).id}`;
      // Beat a (0-2 s) has no art; beat b cuts to the clip from its 4 s in-point. Played across T=2,
      // the fresh element must seek ~120 frames past the only keyframe while the deck keeps moving:
      // the seek lands behind, and drift correction must converge rather than re-seek forever.
      const gopDoc = { version: 1, meta: { id: clipId, title: "GOP clip", timing: { targetSec: 10 } }, scenes: [
        { id: "s", durationSec: 10, beats: [
          { id: "a", timeline: [{ kind: "wait", ms: 2000 }] },
          { id: "b", art: { to: clip, mode: "cut", clips: { [clip]: { in: 4 } } }, timeline: [{ kind: "wait", ms: 8000 }] },
        ] },
      ] };
      expect((await request.put(`/api/decks/${clipId}`, { data: gopDoc })).status()).toBe(200);

      const sel = `video.artstage__layer[data-asset="${clip}"]`;
      const sample = () => page.evaluate((s) => {
        const v = document.querySelector<HTMLVideoElement>(s);
        return {
          clip: v?.currentTime ?? NaN, seeking: v?.seeking ?? true,
          deck: Number(document.querySelector("[data-testid=play-scrub]")?.getAttribute("aria-valuenow")),
        };
      }, sel);
      const lag = (x: { clip: number; deck: number }) => Math.abs((x.clip - 4) - (x.deck - 2)); // clip time vs deck time

      await page.goto(`/play?deck=${clipId}&t=1.5`);
      await expect(page.getByTestId("play-clock")).toHaveText("0:01.5 / 0:10");
      // Count every seek (media events don't bubble, but a capture listener on document sees them).
      await page.evaluate(() => {
        const w = window as unknown as { seeks: number };
        w.seeks = 0;
        document.addEventListener("seeking", () => { w.seeks++; }, true);
      });
      await page.keyboard.press(" ");
      await page.waitForFunction((s) => (document.querySelector<HTMLVideoElement>(s)?.readyState ?? 0) >= 2, sel, { timeout: 10_000 });
      // Converged: not seeking, and the clip within 0.3 s of the deck.
      await expect.poll(async () => { const x = await sample(); return !x.seeking && lag(x) <= 0.3; }, { timeout: 5000 }).toBe(true);

      // From here, ~3 s of playback: the clip keeps advancing, stays on the deck clock, and does not
      // keep re-seeking (the old loop seeked every ~0.3 s here, each one forward — so currentTime
      // alone could still rise).
      const seeksBefore = await page.evaluate(() => (window as unknown as { seeks: number }).seeks);
      const samples: { clip: number; deck: number }[] = [];
      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(250);
        samples.push(await sample());
      }
      const clips = samples.map((x) => x.clip);
      for (let i = 1; i < clips.length; i++) expect(clips[i], `clip time stalled or jumped back: ${clips.join(", ")}`).toBeGreaterThan(clips[i - 1]);
      const last = samples[samples.length - 1];
      expect(last.deck - samples[0].deck).toBeGreaterThan(2.5); // the deck really played ~3 s
      expect(lag(last), `clip ${last.clip} vs deck ${last.deck}`).toBeLessThanOrEqual(0.3);
      const seeks = (await page.evaluate(() => (window as unknown as { seeks: number }).seeks)) - seeksBefore;
      expect(seeks, "re-seeks during converged playback").toBeLessThanOrEqual(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe("camera", () => {
  // Per-worker deck id: parallel workers (--repeat-each) must not share a deck.
  let camId = "";
  test.beforeEach(({}, info) => { camId = `e2e-play-camera-${info.parallelIndex}`; });
  test.afterEach(async ({ request }) => { await request.delete(`/api/decks/${camId}`); });

  test("the art world follows the deck-time camera: deep-link, then a scrub", async ({ page, request }) => {
    await request.delete(`/api/decks/${camId}`).catch(() => {});
    await request.post("/api/decks", { data: { id: camId, title: "Play camera" } });
    // One 4 s scene: at 0.5 s a 2 s move to {zoom 3, x 0.3, y 0.4}, so both t=1 and t≈1.8 are mid-move.
    const camDoc = { version: 1, meta: { id: camId, title: "Play camera", timing: { targetSec: 4 } }, scenes: [
      { id: "s", durationSec: 4, beats: [{ id: "a", art: { to: "1.01", mode: "cut" }, timeline: [
        { kind: "wait", ms: 500 }, { kind: "camera", to: { zoom: 3, x: 0.3, y: 0.4 }, durationMs: 2000 },
        { kind: "text", value: "Camera line", in: "fade" }, { kind: "wait", ms: 3000 },
      ] }] },
    ] };
    expect((await request.put(`/api/decks/${camId}`, { data: camDoc })).status()).toBe(200);
    const ev = cameraEvents(camDoc as unknown as DeckDoc);
    const world = () => page.evaluate(() => document.querySelector<HTMLElement>("[data-testid=play-stage] .artstage__world")?.style.transform);
    // `s` as the browser serialises it back from style.transform (Chromium keeps ~6 significant digits).
    const css = (s: string) => page.evaluate((s) => { const el = document.createElement("div"); el.style.transform = s; return el.style.transform; }, s);
    const deckT = async () => Number(await page.getByTestId("play-scrub").getAttribute("aria-valuenow"));

    await page.goto(`/play?deck=${camId}&t=1`);
    await expect(page.getByTestId("play-clock")).toHaveText("0:01.0 / 0:04");
    expect(await world()).toBe(await css(cameraTransform(cameraAt(ev, 1))));

    // Scrub to ~1.8 s: the bar is pixel-quantised, so the expectation uses the exact deck time it set.
    const bar = page.getByTestId("play-scrub");
    const box = (await bar.boundingBox())!;
    await page.mouse.click(box.x + box.width * (1.8 / 4), box.y + box.height / 2);
    await expect.poll(async () => Math.abs((await deckT()) - 1.8)).toBeLessThanOrEqual(0.05);
    const T = await deckT();
    expect(cameraTransform(cameraAt(ev, T))).not.toBe(cameraTransform(cameraAt(ev, 1)));
    const want = await css(cameraTransform(cameraAt(ev, T)));
    expect(await world()).toBe(want);
    // The tiles' and notes' worlds carry the same framing; the text layer does not move.
    const rest = await page.evaluate(() => ({
      cin: document.querySelector<HTMLElement>("[data-testid=play-stage] .cin__world")?.style.transform,
      beat: [...document.querySelectorAll<HTMLElement>("[data-testid=play-stage] .beat__world")].map((e) => e.style.transform),
      stage: document.querySelector<HTMLElement>("[data-testid=play-stage] .cin__stage")?.style.transform,
    }));
    expect(rest).toEqual({ cin: want, beat: [want, want], stage: "" });
  });
});

test.describe("credits and particles", () => {
  // Per-worker deck ids: parallel workers (--repeat-each) must not share a deck.
  let cid = "";
  test.beforeEach(({}, info) => { cid = `e2e-play-credits-${info.parallelIndex}`; });
  test.afterEach(async ({ request }) => {
    for (const id of [cid, `${cid}-cam`, `${cid}-still`]) await request.delete(`/api/decks/${id}`).catch(() => {});
  });
  const put = async (request: import("@playwright/test").APIRequestContext, id: string, doc: object) => {
    await request.delete(`/api/decks/${id}`).catch(() => {});
    await request.post("/api/decks", { data: { id, title: id } });
    expect((await request.put(`/api/decks/${id}`, { data: doc })).status()).toBe(200);
  };
  const deckT = (page: import("@playwright/test").Page) => page.getByTestId("play-scrub").getAttribute("aria-valuenow").then(Number);

  test("after a deep link and a scrub, the roll offset and the fade level match the deck clock", async ({ page, request }) => {
    // Roll 0–6 s, fade to black 6–8 s, end 8.5 s.
    const doc = { version: 1, meta: { id: cid, title: "Play credits" }, scenes: [{ id: "s", beats: [{ id: "a", timeline: [
      { kind: "credits", items: [{ role: "Directed by", names: ["Ann Lee"] }, { role: "Music", names: ["Bo Chen", "Cy Diaz"] }], durationMs: 6000 },
      { kind: "screen_fade", to: 1, durationMs: 2000 }, { kind: "wait", ms: 2500 },
    ] }] }] };
    await put(request, cid, doc);
    const fades = fadeEvents(doc as unknown as DeckDoc);
    const read = () => page.evaluate(() => {
      const q = (s: string) => document.querySelector<HTMLElement>(`[data-testid=play-stage] ${s}`);
      const roll = q(".cin__credits-roll"), block = q(".cin__credits"), fade = q(".deck__fade")!;
      const m = /translateY\((-?[\d.]+)px\)/.exec(roll?.style.transform ?? "");
      return { off: m ? Number(m[1]) : NaN, blockH: roll?.offsetHeight ?? 0, areaH: block?.clientHeight ?? 0, fade: [fade.style.display, fade.style.opacity] };
    });
    const rollMatches = async (T: number) => {
      const r = await read();
      return Math.abs(r.off - creditsOffset(T, 6000, r.blockH, r.areaH));
    };

    await page.goto(`/play?deck=${cid}&t=3`);
    await expect.poll(() => deckT(page)).toBe(3);
    await expect.poll(() => rollMatches(3)).toBeLessThanOrEqual(0.01); // poll: blockH is re-measured after fonts
    expect((await read()).fade[0]).toBe("none");

    const box = (await page.getByTestId("play-scrub").boundingBox())!;
    await page.mouse.click(box.x + box.width * (7 / 8.5), box.y + box.height / 2);
    await expect.poll(async () => Math.abs((await deckT(page)) - 7)).toBeLessThanOrEqual(0.1);
    const T = await deckT(page);
    await expect.poll(async () => (await read()).fade[0]).toBe("block");
    expect(Number((await read()).fade[1])).toBeCloseTo(fadeAt(fades, T).level, 5);
    expect(await rollMatches(T)).toBeLessThanOrEqual(0.01);           // past the roll: −blockH

    // Review Focus #3: scrub back to before the fade — the overlay paints nothing again.
    await page.mouse.click(box.x + box.width * (2 / 8.5), box.y + box.height / 2);
    await expect.poll(async () => (await read()).fade[0]).toBe("none");
  });

  test("text particles stay on the words during a camera move: .notefield__text never transforms; the sprites equal the camera-less deck's", async ({ page, request }) => {
    const line = { kind: "text", value: "Particle words", in: "fade", pos: { x: 0.3, y: 0.3 }, particles: { color: "cyan", rate: 8 } };
    const mk = (id: string, cam: boolean) => ({ version: 1, meta: { id, title: id }, scenes: [{ id: "s", beats: [{ id: "a", art: { to: "1.01", mode: "cut" }, timeline: [
      line, ...(cam ? [{ kind: "camera", to: { zoom: 3, x: 0.3, y: 0.3 }, durationMs: 2000 }] : []), { kind: "wait", ms: 3000 },
    ] }] }] });
    await put(request, `${cid}-cam`, mk(`${cid}-cam`, true));
    await put(request, `${cid}-still`, mk(`${cid}-still`, false));
    const sprites = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-testid=play-stage] .notefield__text > *")]
      .filter((e) => e.style.display !== "none").map((e) => [e.style.left, e.style.top]));
    const open = async (id: string) => {
      await page.goto(`/play?deck=${id}&t=1.8`);              // the camera is mid-move at 1.8 (0.8 → 2.8)
      await expect.poll(async () => (await sprites()).length).toBeGreaterThan(3);
      return sprites();
    };

    const withCam = await open(`${cid}-cam`);
    const chain = await page.evaluate(() => {
      const out: { tf: string; world: string }[] = [];
      for (let n = document.querySelector<HTMLElement>("[data-testid=play-stage] .notefield__text"); n; n = n.parentElement) {
        out.push({ tf: getComputedStyle(n).transform, world: n.className });
        if (n.dataset.testid === "beatstage") break; // the player frame's own letterbox scaling is not ours
      }
      return { out, beat: document.querySelector<HTMLElement>("[data-testid=play-stage] .beat__world")!.style.transform };
    });
    expect(chain.beat).toContain("scale(");                  // the camera really is zooming the world
    for (const n of chain.out) expect(n.tf, n.world).toBe("none");
    const still = await open(`${cid}-still`);
    expect(withCam).toEqual(still);                          // same word boxes, same notes
  });
});
