import { expect, test } from "@playwright/test";

test("create, open, and delete a deck from the library", async ({ page, request }) => {
  const id = "e2e-library";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  await request.delete(`/api/decks/${id}-2`).catch(() => {});

  await page.goto("/");
  await expect(page.getByTestId("library-grid")).toBeVisible();

  // Create via the in-place form.
  await page.getByTestId("new-deck-toggle").click();
  await expect(page.getByTestId("new-deck-title")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("new-deck-title").fill("E2E Library");
  await page.getByTestId("new-deck-create").click();
  const card = page.getByTestId("deck-card").filter({ hasText: "E2E Library" });
  await expect(card).toBeVisible();
  await expect(card.getByText("e2e-library", { exact: true })).toBeVisible();

  // Open it — lands in the editor with the right deck loaded.
  await card.locator(".lib__card-open").click();
  await expect(page).toHaveURL(/\/editor\?deck=e2e-library/);
  await expect(page.locator(".ed__bar")).toContainText("E2E Library");

  // Back to the library, delete it.
  await page.goto("/");
  const cardAgain = page.getByTestId("deck-card").filter({ hasText: "E2E Library" });
  page.once("dialog", (d) => d.accept());
  await cardAgain.getByTestId("deck-card-delete").click();
  await expect(page.getByTestId("deck-card").filter({ hasText: "E2E Library" })).toHaveCount(0);

  await request.delete(`/api/decks/${id}`).catch(() => {});
});
