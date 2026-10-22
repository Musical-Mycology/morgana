import { expect, test } from "@playwright/test";

// Spec §1 gate: the timed Player seeks the mounted beat once per frame. A forward seek must
// cost well under one 60fps frame (16.7ms) on a busy beat, or the seek-slaved design is wrong.
test("per-frame forward seek on a busy beat stays under half a frame", async ({ page }) => {
  await page.goto("/dev/seekbench");
  const out = page.getByTestId("bench-result");
  await expect(out).toContainText("mean=");
  const text = await out.textContent();
  const mean = Number(/mean=([\d.]+)/.exec(text!)![1]);
  console.log(`[seek-bench] ${text}`);
  expect(mean).toBeLessThan(8);
});
