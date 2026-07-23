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
  await expect(obj).toBeVisible();

  // The dev fixture's obj_reveal runs a 2000ms fade-in tween. Sample opacity while the
  // tween is still clearly in flight (well before it can have settled) to prove the
  // reveal is actually animating over time, not snapping straight to its end-state.
  // A single fixed-delay read (rather than expect.poll) is intentional here: we want to
  // assert a specific in-flight value, not merely "eventually less than 1".
  const opacityDuring = await obj.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
  expect(opacityDuring).toBeGreaterThanOrEqual(0);
  expect(opacityDuring).toBeLessThan(0.9);

  // ...and it does eventually reach the fully-revealed settled state.
  await expect(obj).toHaveCSS("opacity", "1");
});
