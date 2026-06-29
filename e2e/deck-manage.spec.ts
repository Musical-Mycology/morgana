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

test("deck new/delete toolbar: prompt creates + navigates, confirm deletes + navigates away", async ({ page, request }) => {
  const id = "e2e-3d-newdel";
  await request.delete(`/api/decks/${id}`).catch(() => {}); // clean slate from any prior run

  await page.goto("/editor"); // defaults to the demo deck
  await expect(page.getByTestId("deck-switcher")).toHaveValue("demo");

  // New: window.prompt → createDeck → navigate to ?deck=<id>
  page.once("dialog", (d) => d.accept(id));
  await page.getByTestId("deck-new").click();
  await page.waitForURL(`**/editor?deck=${id}`);
  await expect(page.getByTestId("deck-switcher")).toHaveValue(id);

  // The delete guard reads the loaded deck list; wait for it to populate (demo
  // option present ⇒ ≥2 decks) so the "only deck" guard reliably passes.
  await expect(page.getByTestId("deck-switcher").locator('option[value="demo"]')).toHaveCount(1);

  // Delete: window.confirm → deleteDeck → navigate away from the deleted deck
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("deck-delete").click();
  await page.waitForURL((url) => url.searchParams.get("deck") !== id);
  await expect(page.getByTestId("deck-switcher")).not.toHaveValue(id);

  await request.delete(`/api/decks/${id}`).catch(() => {}); // belt-and-suspenders cleanup
});
