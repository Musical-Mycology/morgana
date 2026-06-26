import { expect, test } from "@playwright/test";

test("add / duplicate / delete beats, and undo restores", async ({ page, request }) => {
  const id = "e2e-struct";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Struct" }, scenes: [
    { id: "s", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Struct" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const film = page.getByTestId("filmstrip");
  await expect(film.locator(".ed__beat")).toHaveCount(1);

  await film.locator(".ed__beat").first().click();        // select beat 1 → controls appear
  await page.getByTestId("beat-add").click();
  await expect(film.locator(".ed__beat")).toHaveCount(2);

  await page.getByTestId("undo").click();
  await expect(film.locator(".ed__beat")).toHaveCount(1);

  await request.delete(`/api/decks/${id}`);
});
