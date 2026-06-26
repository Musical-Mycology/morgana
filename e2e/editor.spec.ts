import { expect, test } from "@playwright/test";

test("open editor → demo loads → navigate + scrub", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/editor");

  // demo deck has 2 beats in the filmstrip (count beat buttons specifically —
  // the strip also carries per-beat controls + an "add scene" button)
  const film = page.getByTestId("filmstrip");
  await expect(film.locator(".ed__beat")).toHaveCount(2);

  // select beat 2, scrub to the end → its last line shows in the in-DOM canvas
  await film.locator(".ed__beat").nth(1).click();
  const scrub = page.getByTestId("scrub");
  await scrub.evaluate((el: HTMLInputElement) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, "99");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.getByText("Scrub the timeline.")).toBeVisible();
  expect(errors).toEqual([]);
});
