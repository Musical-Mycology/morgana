import { expect, test } from "@playwright/test";

async function seed(request: import("@playwright/test").APIRequestContext, id: string) {
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "RR" }, scenes: [
    { id: "s", objects: [{ id: "o-1", kind: "shape", shape: "rect", fill: "#3a6", transform: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 } }], beats: [{ id: "a", timeline: [] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "RR" } });
  await request.put(`/api/decks/${id}`, { data: doc });
}

test("resizing via the se handle grows the object and one undo reverts it", async ({ page, request }) => {
  const id = "e2e-obj-resize";
  await seed(request, id);
  await page.goto(`/editor?deck=${id}`);
  const host = page.locator(".ed__canvas-host");
  const obj = page.locator('[data-obj-id="o-1"]');
  await expect(obj).toBeVisible();
  await obj.click(); // select -> overlay appears
  await expect(page.getByTestId("obj-handle-se")).toBeVisible();

  const box = (await host.boundingBox())!;
  const se = (await page.getByTestId("obj-handle-se").boundingBox())!;
  const readW = () => obj.evaluate((el) => parseFloat((el as HTMLElement).style.width));
  const w0 = await readW();

  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, { steps: 8 });
  await page.mouse.up();

  await expect.poll(readW).toBeGreaterThan(w0);
  await page.getByTestId("undo").click();
  await expect.poll(readW).toBeCloseTo(w0, 0);
  await request.delete(`/api/decks/${id}`);
});

test("rotating via the rotate handle sets a non-zero rotation, undoable in one step", async ({ page, request }) => {
  const id = "e2e-obj-rotate";
  await seed(request, id);
  await page.goto(`/editor?deck=${id}`);
  const obj = page.locator('[data-obj-id="o-1"]');
  await expect(obj).toBeVisible();
  await obj.click();

  const readRot = () => obj.evaluate((el) => (el as HTMLElement).style.transform || "");
  const rotate = (await page.getByTestId("obj-handle-rotate").boundingBox())!;
  const objBox = (await obj.boundingBox())!;
  const cx = objBox.x + objBox.width / 2;

  await page.mouse.move(rotate.x + rotate.width / 2, rotate.y + rotate.height / 2);
  await page.mouse.down();
  await page.mouse.move(cx + objBox.width, objBox.y + objBox.height / 2, { steps: 8 }); // swing to the right
  await page.mouse.up();

  await expect.poll(readRot).toContain("rotate(");
  await page.getByTestId("undo").click();
  await expect.poll(readRot).not.toContain("rotate(");
  await request.delete(`/api/decks/${id}`);
});

test("a handle drag does not move the object body", async ({ page, request }) => {
  const id = "e2e-obj-handle-priority";
  await seed(request, id);
  await page.goto(`/editor?deck=${id}`);
  const obj = page.locator('[data-obj-id="o-1"]');
  await expect(obj).toBeVisible();
  await obj.click();
  const readLeft = () => obj.evaluate((el) => parseFloat((el as HTMLElement).style.left));
  const left0 = await readLeft();

  const se = (await page.getByTestId("obj-handle-se").boundingBox())!;
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x + 60, se.y + 60, { steps: 6 });
  await page.mouse.up();

  // se-resize pins the nw corner => left (x) must not change
  await expect.poll(readLeft).toBeCloseTo(left0, 0);
  await request.delete(`/api/decks/${id}`);
});
