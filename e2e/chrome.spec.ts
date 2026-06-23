import { expect, test } from "@playwright/test";

test("intro splash is absent without chrome, present with it", async ({ page }) => {
  await page.goto("/dev/chrome");
  await expect(page.getByText("Injected tagline")).toHaveCount(0);  // no chrome → no splash
  await page.getByTestId("toggle").click();
  await expect(page.getByText("Injected tagline")).toBeVisible();    // chrome.splash → splash shows
});
