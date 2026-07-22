import { expect, test } from "@playwright/test";

test("add an object → it renders, is selected, editable, and deletable", async ({ page, request }) => {
  const id = "e2e-objects";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Obj" }, scenes: [{ id: "s", beats: [{ id: "a", timeline: [] }] }] };
  await request.post("/api/decks", { data: { id, title: "Obj" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  // add a text object from the bar
  await page.getByTestId("object-add").selectOption("text");
  const obj = page.locator('[data-obj-id]').first();
  await expect(obj).toBeVisible();
  // it's selected → inspector shows an object with a text field
  await expect(page.getByTestId("inspector")).toContainText(/object/i);
  const ta = page.getByTestId("inspector").locator("textarea");
  await ta.fill("Hello world");
  await expect(page.locator('[data-obj-id]').first()).toContainText("Hello world");
  // delete via the inspector button → gone
  await page.getByTestId("object-delete").click();
  await expect(page.locator('[data-obj-id]')).toHaveCount(0);

  await request.delete(`/api/decks/${id}`);
});
