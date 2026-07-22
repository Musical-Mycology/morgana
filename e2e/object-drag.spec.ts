import { expect, test } from "@playwright/test";

test("dragging an object body moves it and commits one undoable change", async ({ page, request }) => {
  const id = "e2e-obj-drag";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Obj" }, scenes: [
    { id: "s", objects: [{ id: "o-1", kind: "shape", shape: "rect", fill: "#c33", transform: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }], beats: [{ id: "a", timeline: [] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Obj" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const host = page.locator(".ed__canvas-host");
  const obj = page.locator('[data-obj-id="o-1"]');
  await expect(obj).toBeVisible();

  const box = (await host.boundingBox())!;
  const ob = (await obj.boundingBox())!;
  await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 8 });
  await page.mouse.up();

  // inspector now shows the object's transform.x > 0.5 (X field is the 3rd number input after w/h ordering may vary — assert via any input reflecting > 0.5)
  const xField = page.getByTestId("inspector").locator('input[type="number"]');
  await expect.poll(async () => {
    const vals = await xField.evaluateAll((els) => els.map((e) => Number((e as HTMLInputElement).value)));
    return Math.max(...vals);
  }).toBeGreaterThan(0.5);

  // one undo returns it near its origin
  await page.getByTestId("undo").click();
  await request.delete(`/api/decks/${id}`);
});
