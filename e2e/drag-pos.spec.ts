import { expect, test } from "@playwright/test";

test("dragging the pos handle writes the action's pos and shows a Pos X field", async ({ page, request }) => {
  const id = "e2e-drag";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Drag" }, scenes: [
    { id: "s", beats: [{ id: "a", timeline: [{ kind: "text", value: "Drag me", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Drag" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await page.getByTestId("timeline").locator(".ed__chip").first().click();   // select the text action
  const handle = page.getByTestId("pos-handle");
  await expect(handle).toBeVisible();

  const host = page.locator(".ed__canvas-host");
  const box = (await host.boundingBox())!;
  // drag the handle toward the host's lower-right quadrant
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7, { steps: 8 });
  await page.mouse.up();

  // the inspector's "Pos X" number now reflects the dragged-to position (> 0.5)
  const posX = page.getByTestId("inspector").locator('input[type="number"]').first();
  await expect.poll(async () => Number(await posX.inputValue())).toBeGreaterThan(0.5);

  await request.delete(`/api/decks/${id}`);
});
