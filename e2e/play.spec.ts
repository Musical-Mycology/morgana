import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBinary } from "../lib/render/ffmpeg";

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
