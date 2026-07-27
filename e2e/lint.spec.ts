import { expect, test } from "@playwright/test";

test("the Issues badge counts warnings and a row jumps to the offending beat", async ({ page, request }) => {
  const id = "e2e-lint";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Lint" }, scenes: [
    { id: "one", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
    { id: "gap", beats: [] },                                  // scene-empty warning
  ] };
  await request.post("/api/decks", { data: { id, title: "Lint" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await expect(page.getByTestId("lint-count")).toHaveText("1");

  await page.getByTestId("lint-toggle").click();
  const rows = page.getByTestId("lint-issue");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("gap");

  await request.delete(`/api/decks/${id}`);
});

test("a clean deck shows no badge and an empty Issues panel", async ({ page, request }) => {
  const id = "e2e-lint-clean";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Clean" }, scenes: [
    { id: "one", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Clean" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await expect(page.getByTestId("lint-count")).toHaveCount(0);
  await page.getByTestId("lint-toggle").click();
  await expect(page.getByTestId("lint-panel")).toContainText("No issues");

  await request.delete(`/api/decks/${id}`);
});

test("deleting a scene's last beat raises a warning that clears when refilled", async ({ page, request }) => {
  const id = "e2e-lint-live";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Live" }, scenes: [
    { id: "one", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
    { id: "two", beats: [{ id: "b", timeline: [{ kind: "text", value: "B", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Live" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await expect(page.getByTestId("lint-count")).toHaveCount(0);

  await page.getByTestId("filmstrip").locator(".ed__beat").first().click();
  await page.getByTestId("beat-delete").click();               // empties scene "one"
  await expect(page.getByTestId("lint-count")).toHaveText("1");

  await page.getByTestId("filmstrip").getByTestId("scene-add-beat").first().click();
  await expect(page.getByTestId("lint-count")).toHaveCount(0);

  await request.delete(`/api/decks/${id}`);
});

test("a rejected save shows the server's reason and Retry succeeds", async ({ page, request }) => {
  const id = "e2e-lint-save-retry";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Retry" }, scenes: [
    { id: "one", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Retry" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);

  await page.route(`**/api/decks/${id}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "scenes[0].id required" }),
    });
  });

  await page.getByTestId("filmstrip").locator(".ed__beat").first().click();
  await page.getByTestId("beat-add").click();               // edits the doc; autosave (700ms debounce) fires the mocked PUT

  await expect(page.getByTestId("save-status")).toHaveText("Save failed");
  await expect(page.getByTestId("save-error")).toBeVisible();
  await expect(page.getByTestId("save-error")).toContainText("scenes[0].id required");
  await expect(page.getByTestId("save-retry")).toBeVisible();

  await page.unroute(`**/api/decks/${id}`);
  await page.getByTestId("save-retry").click();

  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  await expect(page.getByTestId("save-error")).toHaveCount(0);

  await request.delete(`/api/decks/${id}`);
});
