import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/media/${name}`, import.meta.url));

// Uses a THROWAWAY deck so the seeded demo stays pristine for read-only specs.
test("media library: upload, HEVC rejection, pick a clip as art, set its in-point", async ({ page, request }) => {
  const id = "e2e-media-library";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Media Library" }, scenes: [
    // An empty beat: the Art action added below lands at T=0, where the editor canvas sits.
    { id: "s", beats: [{ id: "b", timeline: [] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Media Library" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const timeline = page.getByTestId("timeline");
  await expect(page.getByTestId("inspector")).toBeVisible();

  // Upload a still and an H.264 clip through Deck settings → Media library.
  await page.getByTestId("deck-settings-toggle").click();
  const library = page.getByTestId("media-library");
  await expect(library).toBeVisible();
  await page.getByTestId("media-upload").setInputFiles([fixture("still.png"), fixture("clip-h264.mp4")]);
  await expect(library.locator("[data-testid^='media-item-']")).toHaveCount(2);
  const listed = (await (await request.get(`/api/decks/${id}/media`)).json()) as { media: { id: string; mime: string }[] };
  const clipId = listed.media.find((m) => m.mime === "video/mp4")!.id;
  const stillId = listed.media.find((m) => m.mime === "image/png")!.id;
  await expect(page.getByTestId(`media-item-${clipId}`)).toBeVisible();
  await expect(page.getByTestId(`media-item-${stillId}`)).toBeVisible();
  const clip = `media:${clipId}`;

  // HEVC is rejected with the ffmpeg fix.
  await page.getByTestId("media-upload").setInputFiles(fixture("clip-hevc.mp4"));
  const err = page.getByTestId("media-error");
  await expect(err).toContainText("unsupported video codec (hvc1)");
  await expect(err).toContainText("ffmpeg -i");
  await expect(library.locator("[data-testid^='media-item-']")).toHaveCount(2);
  await page.getByTestId("deck-settings-toggle").click(); // back to the Inspector

  // Add an Art action; it is selected and defaults to panel 1.01.
  await page.getByTestId("action-add").selectOption("art");
  await expect(timeline.locator(".ed__chip")).toHaveCount(1);
  const field = page.getByTestId("field-art.to");
  await expect(field.getByTestId("asset-chip-1.01")).toBeVisible();

  // Pick the clip in the picker, then drop the default panel so the clip is the art.
  await field.getByTestId("asset-picker-toggle").click();
  const popover = field.getByTestId("asset-picker-popover");
  await expect(popover.getByTestId("asset-section-deck")).toContainText("clip-h264.mp4");
  await expect(popover.getByTestId(`asset-option-media:${stillId}`)).toBeVisible();
  await popover.getByTestId(`asset-option-${clip}`).click();
  await expect(field.getByTestId(`asset-chip-${clip}`)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await field.getByTestId("asset-chip-remove-1.01").click();
  await expect(field.getByTestId("asset-chip-1.01")).toHaveCount(0);

  // In-point 0.5: the editor canvas parks the clip on that frame.
  await field.getByTestId(`clip-in-${clip}`).fill("0.5");
  const sel = `.ed__canvas video.artstage__layer[data-asset="${clip}"]`;
  await expect(page.locator(sel)).toHaveCount(1);
  await expect.poll(
    () => page.evaluate((s) => document.querySelector<HTMLVideoElement>(s)?.currentTime ?? NaN, sel),
    { timeout: 5000 },
  ).toBeCloseTo(0.5, 1);

  // Saved: the clip options live at art.clips[ref], written whole.
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await page.reload();
  await expect(timeline.locator(".ed__chip")).toHaveCount(1);
  const saved = (await (await request.get(`/api/decks/${id}`)).json()) as {
    scenes: { beats: { timeline: { kind: string; art?: { to: unknown; clips?: Record<string, { in?: number }> } }[] }[] }[];
  };
  const art = saved.scenes[0].beats[0].timeline[0].art!;
  expect(art.to).toBe(clip);
  expect(art.clips?.[clip]?.in).toBe(0.5);

  await request.delete(`/api/decks/${id}`);
});
