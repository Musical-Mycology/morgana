import { expect, test } from "@playwright/test";

const id = "e2e-deck-ruler";
const doc = { version: 1, meta: { id, title: "Ruler", timing: { targetSec: 12 } }, scenes: [
  { id: "opening", durationSec: 4, beats: [{ id: "a", timeline: [{ kind: "text", value: "Opening line", in: "fade" }, { kind: "wait", ms: 1000 }] }] },
  { id: "middle", durationSec: 6, beats: [{ id: "b", timeline: [{ kind: "text", value: "Second scene", in: "fade" }, { kind: "wait", ms: 2000 }] }] },
] };

test("clicking the deck ruler selects the beat at that time and shows it", async ({ page, request }) => {
  await request.delete(`/api/decks/${id}`).catch(() => {});
  await request.post("/api/decks", { data: { id, title: "Ruler" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const bar = page.getByTestId("deck-ruler");
  const box = (await bar.boundingBox())!;
  await page.mouse.click(box.x + box.width * (6 / 12), box.y + box.height / 2); // T = 6 → middle, localT 2
  await expect(page.getByTestId("canvas-text")).toContainText("Second scene");
  await expect(page.getByTestId("ruler-clock")).toHaveText("0:06.0 / 0:12");
  await expect(page.getByTestId("play-deck")).toHaveAttribute("href", new RegExp(`/play\\?deck=${id}$`));

  await request.delete(`/api/decks/${id}`);
});
