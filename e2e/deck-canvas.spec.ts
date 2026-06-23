import { expect, test } from "@playwright/test";
test("DeckCanvas renders a beat at panel size and scrubs", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/dev/canvas");
  await expect(page.getByText("Canvas copy one")).toHaveCount(1);
  await page.getByTestId("seek-end").click();
  await expect(page.getByText("Canvas copy two")).toBeVisible();
  const host = page.locator(".ed__canvas-host");
  const box = await host.boundingBox();
  expect(box!.width).toBeLessThan(520);                          // host is the ~480px panel
  const sBox = await page.locator(".cin__stage").boundingBox();
  expect(sBox!.width).toBeLessThanOrEqual(box!.width + 1);       // stage fits inside the panel → cq refactor works
  expect(errors).toEqual([]);
});
