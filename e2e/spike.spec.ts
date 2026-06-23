import { expect, test } from "@playwright/test";

/** Set a range input to `value` and fire the React onChange. */
async function setRange(page: import("@playwright/test").Page, testId: string, value: number) {
  await page.getByTestId(testId).evaluate(
    (el: HTMLInputElement, v: number) => {
      // Use the native value setter so React's internal tracking sees the change.
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      nativeSetter?.call(el, String(v));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    value,
  );
}

test("scrub renders progressive state and survives a particle source", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/spike");

  // t=0: first line present but fully transparent.
  await setRange(page, "scrub", 0);
  await expect(page.getByText("We grow a network")).toHaveCSS("opacity", "0");

  // t=1.0: first line fully revealed, second line has appeared, and the note_emitter window
  // (start 0.6) has been crossed without throwing.
  await setRange(page, "scrub", 1.0);
  await expect(page.getByText("to make music.")).toBeVisible();

  // Scrub to the end — must not throw.
  const max = await page.getByTestId("scrub").getAttribute("max");
  await setRange(page, "scrub", parseFloat(max!));
  expect(errors).toEqual([]);
});
