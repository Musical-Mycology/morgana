import { expect, test } from "@playwright/test";

test("BeatStage renders the beat text and does not hijack ArrowRight", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/dev/beatstage");
  await expect(page.getByText("Hello Morgana")).toBeVisible({ timeout: 5000 });
  // No global key handler should exist: ArrowRight must not navigate or throw.
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/dev\/beatstage$/);
  expect(errors).toEqual([]);
});
