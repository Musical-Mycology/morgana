import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  const clipId = "e2e-play-clip";
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
    await page.waitForTimeout(1000);
    expect((await clipTime()) - before).toBeGreaterThan(0.5);
    await page.keyboard.press(" "); // pause, so the scrub target holds

    // Scrub back to 0.3 s: the paused clip seeks exactly there.
    const bar = page.getByTestId("play-scrub");
    const box = (await bar.boundingBox())!;
    await page.mouse.click(box.x + box.width * (0.3 / 4), box.y + box.height / 2);
    await expect.poll(async () => Math.abs((await clipTime()) - 0.3)).toBeLessThanOrEqual(0.15);
  });
});
