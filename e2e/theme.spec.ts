import { expect, test } from "@playwright/test";

test("editor chrome uses the Sporekles dark surfaces", async ({ page }) => {
  await page.goto("/editor");
  await expect(page.locator(".ed__bar")).toHaveCSS("background-color", "rgb(23, 17, 13)");  // --ed-bg-2 #17110d
  await expect(page.locator(".ed__brand")).toHaveText("Morgana");
});
