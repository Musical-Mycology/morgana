import { expect, test } from "@playwright/test";

/** Set a range input to `value` and fire the React onChange. The NATIVE value setter is
 *  required — React tracks controlled-input values on the element, so a plain
 *  `el.value = x` is invisible to it and onChange never fires. Copied from the working
 *  helper in e2e/objects-playback.spec.ts:5. */
async function setRange(page: import("@playwright/test").Page, testId: string, value: number) {
  await page.getByTestId(testId).evaluate(
    (el: HTMLInputElement, v: number) => {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      nativeSetter?.call(el, String(v));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    value,
  );
}

const sprites = '[data-testid="notefield"] span';
const frame = (page: import("@playwright/test").Page) =>
  page.$$eval(sprites, (nodes) =>
    nodes
      .filter((n) => (n as HTMLElement).style.display !== "none")
      .map((n) => { const e = n as HTMLElement; return `${e.style.left}|${e.style.top}|${e.style.opacity}`; })
      .sort());

/** Editor specs in this suite have a pre-existing hydration race — the shell HTML can paint
 *  before the client bundle is live. A brief settle measurably reduces (does not eliminate)
 *  it; see the same wait in e2e/objects-playback.spec.ts:36 and e2e/objects.spec.ts. */
const openDeck = async (page: import("@playwright/test").Page) => {
  await page.goto("/editor?deck=notes");
  await expect(page.getByTestId("scrub")).toBeVisible();
  await page.waitForTimeout(300);
};

test("editor canvas paints notes under scrub, deterministically", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openDeck(page);

  await setRange(page, "scrub", 1.5);
  await expect.poll(async () => (await frame(page)).length).toBeGreaterThan(0);
  const at15 = await frame(page);

  await setRange(page, "scrub", 3.0);
  const at30 = await frame(page);
  expect(at30).not.toEqual(at15);          // time actually advances the sprites

  await setRange(page, "scrub", 1.5);
  expect(await frame(page)).toEqual(at15); // …and returning to t repaints the same frame

  expect(errors).toEqual([]);
});

test("notes survive into a later beat and stop when told to", async ({ page }) => {
  await openDeck(page);
  const film = page.getByTestId("filmstrip");

  // beat 1 starts no sources of its own — anything painted is carried from beat 0
  await film.locator(".ed__beat").nth(1).click();
  await setRange(page, "scrub", 0.5);
  await expect.poll(async () => (await frame(page)).length).toBeGreaterThan(0);

  // beat 2 stops the rings, then everything
  await film.locator(".ed__beat").nth(2).click();
  await setRange(page, "scrub", 2.5);
  await expect.poll(async () => (await frame(page)).length).toBe(0);
});

test("BeatStage dev route paints notes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/dev/notefield");
  await expect(page.locator(sprites).first()).toBeVisible();
  expect(errors).toEqual([]);
});
