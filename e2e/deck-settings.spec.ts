import { expect, test } from "@playwright/test";

// Uses a THROWAWAY deck so the seeded demo stays pristine for read-only specs.
test("deck settings edits the title and the toolbar reflects it", async ({ page, request }) => {
  const id = "e2e-deck-settings";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Settings" }, scenes: [
    { id: "s", beats: [{ id: "b", timeline: [{ kind: "text", value: "hi", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Settings" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await page.getByTestId("deck-settings-toggle").click();
  const title = page.getByTestId("deck-settings").locator("input").first();
  await title.fill("Renamed Deck");
  await expect(page.locator(".ed__bar")).toContainText("Renamed Deck");

  await request.delete(`/api/decks/${id}`);
});
