import { expect, test } from "@playwright/test";

test("add / delete actions in a beat, with undo", async ({ page, request }) => {
  const id = "e2e-3d-actions";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Actions" }, scenes: [
    { id: "s", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Actions" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const chips = page.getByTestId("timeline").locator(".ed__chip");
  await expect(chips).toHaveCount(1);

  await page.getByTestId("action-add").selectOption("wait");
  await expect(chips).toHaveCount(2);

  // the new action is selected → its controls show; delete it
  await page.getByTestId("action-delete").click();
  await expect(chips).toHaveCount(1);

  await page.getByTestId("undo").click();
  await expect(chips).toHaveCount(2);

  await request.delete(`/api/decks/${id}`);
});
