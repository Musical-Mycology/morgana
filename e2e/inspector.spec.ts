import { expect, test } from "@playwright/test";
test("editing a text action's value updates the canvas live", async ({ page }) => {
  await page.goto("/editor");
  await page.getByTestId("filmstrip").getByRole("button").nth(1).click();   // beat 2
  await page.getByTestId("timeline").locator(".ed__chip").first().click();  // select first action
  const value = page.getByTestId("inspector").locator("textarea").first();
  await expect(value).toBeVisible();
  await value.fill("Edited live");
  await page.getByTestId("scrub").evaluate((el: HTMLInputElement) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, "99"); el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.getByTestId("canvas-text").getByText("Edited live")).toBeVisible();
});
