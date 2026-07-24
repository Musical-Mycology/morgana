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

test("delete and reorder scenes, persisting across a reload", async ({ page, request }) => {
  const id = "e2e-scenes";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Scenes" }, scenes: [
    { id: "one", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
    { id: "two", beats: [{ id: "b", timeline: [{ kind: "text", value: "B", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Scenes" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const film = page.getByTestId("filmstrip");
  await expect(film.getByTestId("scene-row")).toHaveCount(2);

  await film.getByTestId("scene-down").first().click();          // "one" moves after "two"
  await expect(film.getByTestId("scene-row").first()).toContainText("two");

  await film.getByTestId("scene-delete").first().click();        // delete "two"
  await expect(film.getByTestId("scene-row")).toHaveCount(1);
  await expect(page.getByTestId("save-status")).toHaveText("Saved");

  await page.reload();
  await expect(page.getByTestId("filmstrip").getByTestId("scene-row")).toHaveCount(1);

  await request.delete(`/api/decks/${id}`);
});

test("a beat moves across a scene boundary, empties its scene, and can refill it", async ({ page, request }) => {
  const id = "e2e-cross-scene";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Cross" }, scenes: [
    { id: "one", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }] }] },
    { id: "two", beats: [{ id: "b", timeline: [{ kind: "text", value: "B", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Cross" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const film = page.getByTestId("filmstrip");

  await film.locator(".ed__beat").first().click();               // select "a"
  await page.getByTestId("beat-down").click();                   // transfer into scene "two"
  await expect(film.getByTestId("scene-empty-row")).toHaveCount(1);
  await expect(film.locator(".ed__beat")).toHaveCount(2);        // both beats still exist

  await film.getByTestId("scene-add-beat").first().click();      // refill the emptied scene
  await expect(film.getByTestId("scene-empty-row")).toHaveCount(0);
  await expect(film.locator(".ed__beat")).toHaveCount(3);

  await request.delete(`/api/decks/${id}`);
});
