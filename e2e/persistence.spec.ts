import { expect, test } from "@playwright/test";

// Round-trips through a THROWAWAY deck so the seeded demo stays pristine.
test("inspector edits autosave and survive a reload", async ({ page, request }) => {
  const id = "e2e-persist";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Persist" }, scenes: [
    { id: "s", beats: [{ id: "b", timeline: [{ kind: "text", value: "before", in: "fade" }] }] },
  ] };
  // create then seed the body
  await request.post("/api/decks", { data: { id, title: "Persist" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await page.getByTestId("timeline").locator(".ed__chip").first().click();      // select the text action
  const value = page.getByTestId("inspector").locator("textarea").first();
  await value.fill("after-edit");
  await expect(page.getByTestId("save-status")).toHaveText("Saved", { timeout: 15000 });

  await page.reload();
  await page.getByTestId("timeline").locator(".ed__chip").first().click();
  await expect(page.getByTestId("inspector").locator("textarea").first()).toHaveValue("after-edit");

  await request.delete(`/api/decks/${id}`);
});
