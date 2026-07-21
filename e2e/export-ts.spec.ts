import { expect, test } from "@playwright/test";

// Uses a THROWAWAY deck so the seeded demo stays pristine.
test("exports the current deck as a TS module and downloads it", async ({ page, request }) => {
  const id = "e2e-export";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Export" }, scenes: [
    { id: "s", beats: [{ id: "b", timeline: [{ kind: "text", value: "exported", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Export" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);

  // Open the Export panel — the generated module reflects the deck.
  await page.getByTestId("export-toggle").click();
  await expect(page.getByTestId("export-panel")).toBeVisible();
  const code = page.getByTestId("export-code");
  await expect(code).toHaveValue(/export const scenes: Scene\[\]/);
  await expect(code).toHaveValue(/exported/);

  // Panels are mutually exclusive: Inspector is gone; switching to Deck settings swaps panels.
  await expect(page.getByTestId("inspector")).toHaveCount(0);
  await page.getByTestId("deck-settings-toggle").click();
  await expect(page.getByTestId("deck-settings")).toBeVisible();
  await expect(page.getByTestId("export-panel")).toHaveCount(0);

  // Re-open Export and download — the file is named after the deck id.
  await page.getByTestId("export-toggle").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-download").click(),
  ]);
  expect(download.suggestedFilename()).toBe("e2e-export.ts");

  await request.delete(`/api/decks/${id}`);
});
