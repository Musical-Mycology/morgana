import { expect, test } from "@playwright/test";

test("deck switcher lists decks; delete-scene removes a scene", async ({ page, request }) => {
  const a = "e2e-3d-manage-a";
  await request.delete(`/api/decks/${a}`).catch(() => {});
  const doc = { version: 1, meta: { id: a, title: "Manage A" }, scenes: [
    { id: "s1", beats: [{ id: "b1", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
    { id: "s2", beats: [{ id: "b2", timeline: [{ kind: "text", value: "B", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id: a, title: "Manage A" } });
  await request.put(`/api/decks/${a}`, { data: doc });

  await page.goto(`/editor?deck=${a}`);
  // switcher shows the current deck selected
  await expect(page.getByTestId("deck-switcher")).toHaveValue(a);

  // two scenes → two delete-scene buttons; delete one → one scene's beats remain
  const film = page.getByTestId("filmstrip");
  await expect(film.getByTestId("scene-delete")).toHaveCount(2);
  await film.getByTestId("scene-delete").first().click();
  await expect(film.locator(".ed__beat")).toHaveCount(1);

  await request.delete(`/api/decks/${a}`);
});
