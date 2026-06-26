import { expect, test } from "@playwright/test";

test("Export TS panel shows the generated module for the deck", async ({ page, request }) => {
  const id = "e2e-3d-export";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Export" }, scenes: [
    { id: "s", beats: [{ id: "a", timeline: [{ kind: "text", value: "Exported", in: "fade" }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Export" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await expect(page.locator(".ed__bar")).toContainText("Export", { timeout: 15000 });
  await page.getByTestId("export-toggle").click();
  const out = page.getByTestId("export-output");
  await expect(out).toBeVisible();
  const text = await out.inputValue();
  expect(text).toContain("export const scenes");
  expect(text).toContain('"value": "Exported"');

  await request.delete(`/api/decks/${id}`);
});
