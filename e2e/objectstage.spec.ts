import { test, expect } from "@playwright/test";

test("BeatStage renders scene objects at settled state", async ({ page }) => {
  await page.goto("/dev/objectstage");
  const obj = page.locator('[data-testid="object-stage"] [data-obj-id="a"]');
  await expect(obj).toBeVisible();
  await expect(obj).toHaveCSS("opacity", "1");
});

test("BeatStage animates the reveal under animate=1", async ({ page }) => {
  await page.goto("/dev/objectstage?animate=1");
  const obj = page.locator('[data-testid="object-stage"] [data-obj-id="a"]');
  await expect(obj).toBeVisible(); // reveal completes → visible
});
