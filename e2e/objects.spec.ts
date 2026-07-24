import { expect, test } from "@playwright/test";

test("add an object → it renders, is selected, editable, and deletable", async ({ page, request }) => {
  const id = "e2e-objects";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Obj" }, scenes: [{ id: "s", beats: [{ id: "a", timeline: [] }] }] };
  await request.post("/api/decks", { data: { id, title: "Obj" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  // add a text object from the bar
  await page.getByTestId("layer-object-add").selectOption("text");
  // The editor-canvas node specifically: `data-obj-id` is also carried by the Layers-panel row
  // (which precedes the canvas in DOM order, so a bare [data-obj-id].first() picks up the row
  // and its "text · o-1" label) and by the playback ObjectStage node.
  const obj = page.locator('[data-testid="obj"]');
  await expect(obj).toBeVisible();
  // it's selected → inspector shows an object with a text field
  await expect(page.getByTestId("inspector")).toContainText(/object/i);
  const ta = page.getByTestId("inspector").locator("textarea");
  await ta.fill("Hello world");
  await expect(obj).toContainText("Hello world");
  // delete via the inspector button → gone from the canvas and from the Layers panel
  await page.getByTestId("object-delete").click();
  await expect(obj).toHaveCount(0);
  await expect(page.getByTestId("layer-row")).toHaveCount(0);

  await request.delete(`/api/decks/${id}`);
});
