import { expect, test } from "@playwright/test";

test("picking a deck font persists and applies as a CSS var", async ({ page, request }) => {
  const id = "e2e-3d-fonts";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Fonts" }, scenes: [
    { id: "s", beats: [{ id: "a", timeline: [{ kind: "text", value: "Hi", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Fonts" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  // Wait for the deck to load before opening settings
  await expect(page.locator(".ed__bar")).toContainText("Fonts", { timeout: 15000 });
  await page.getByTestId("deck-settings-toggle").click();
  await page.getByTestId("deck-settings").locator("select").last().waitFor();
  // the display-font select is the first select in the Typography group → use the labeled one
  const displaySelect = page.getByTestId("deck-settings").locator("select").nth(0); // chrome has no selects → fonts first
  await displaySelect.selectOption("Inter");
  await expect(page.getByTestId("save-status")).toHaveText("Saved", { timeout: 15000 });

  // applied to the canvas host as a CSS var
  const varVal = await page.locator(".ed__canvas-host").evaluate((el) => getComputedStyle(el).getPropertyValue("--font-display"));
  expect(varVal).toContain("Inter");

  await page.reload();
  // Wait for the deck to reload after page refresh
  await expect(page.locator(".ed__bar")).toContainText("Fonts", { timeout: 15000 });
  await page.getByTestId("deck-settings-toggle").click();
  await expect(page.getByTestId("deck-settings").locator("select").nth(0)).toHaveValue("Inter");

  await request.delete(`/api/decks/${id}`);
});
