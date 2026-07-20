import { expect, test } from "@playwright/test";
import { mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The `library` project runs alone on :3200 against MORGANA_DATA_DIR=.e2e/library
// (playwright.config.ts). This spec owns that dir, so emptying it in the empty-state
// test can never race another spec.
const DECKS_DIR = resolve("./.e2e/library/decks");

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

// Serial-by-design: this test empties the whole decks dir, so the `library` project runs alone
// on :3200. It can flake under `--repeat-each` (which force-parallelizes the destructive spec) —
// that's accepted and explained in docs/superpowers/specs/2026-07-20-e2e-determinism-ci-design.md §6.
test("shows the empty state when no decks exist", async ({ page }) => {
  const holding = mkdtempSync(join(tmpdir(), "morgana-e2e-empty-"));
  const files = readdirSync(DECKS_DIR).filter((f) => f.endsWith(".deck.json"));
  try {
    for (const f of files) renameSync(join(DECKS_DIR, f), join(holding, f));

    await page.goto("/");
    await expect(page.getByTestId("library-empty")).toBeVisible();
    await expect(page.getByTestId("library-empty")).toContainText("No decks yet");
    await expect(page.getByTestId("library-grid")).not.toBeVisible();
    // The empty state's own "+ New deck" trigger should be present.
    await expect(page.getByTestId("library-empty").getByTestId("new-deck-toggle")).toBeVisible();
  } finally {
    for (const f of files) renameSync(join(holding, f), join(DECKS_DIR, f));
    rmSync(holding, { recursive: true, force: true });
  }
});
