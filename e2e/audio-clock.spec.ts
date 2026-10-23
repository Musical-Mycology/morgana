import { expect, test } from "@playwright/test";

// Soundtrack plan Task 1 gate: the Web Audio clock must advance in the e2e browser, or every later
// audio e2e is meaningless.
test("the Web Audio clock advances in the e2e browser", async ({ page }) => {
  await page.goto("/dev/audioclock");
  await page.getByTestId("audio-run").click();
  const out = page.getByTestId("audio-now");
  await expect(out).toContainText("now=");
  const text = (await out.textContent())!;
  console.log(`[audio-clock] ${text}`);
  const now = Number(/now=(-?[\d.]+)/.exec(text)![1]);
  expect(now).toBeGreaterThan(0.2);
});
