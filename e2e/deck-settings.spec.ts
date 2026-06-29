import { expect, test } from "@playwright/test";
test("deck settings edits the title and the toolbar reflects it", async ({ page }) => {
  await page.goto("/editor");
  // Wait for the demo deck to load before opening settings
  await expect(page.locator(".ed__bar")).toContainText("Morgana Demo", { timeout: 15000 });
  await page.getByTestId("deck-settings-toggle").click();
  const title = page.getByTestId("deck-settings").locator("input").first();
  await title.fill("Renamed Deck");
  await expect(page.locator(".ed__bar")).toContainText("Renamed Deck");
});
