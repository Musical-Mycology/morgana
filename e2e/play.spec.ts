import { expect, test } from "@playwright/test";

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
