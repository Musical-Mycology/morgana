import { expect, test } from "@playwright/test";

// Uses a THROWAWAY 2-beat deck so the seeded demo stays pristine for read-only specs.
test("editing a text action's value updates the canvas live", async ({ page, request }) => {
  const id = "e2e-inspector";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Inspector" }, scenes: [
    { id: "s", beats: [
      { id: "b1", timeline: [{ kind: "text", value: "first", in: "fade" }] },
      { id: "b2", timeline: [{ kind: "text", value: "second", in: "fade" }] },
    ] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Inspector" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await page.getByTestId("filmstrip").locator(".ed__beat").nth(1).click();   // beat 2
  await page.getByTestId("timeline").locator(".ed__chip").first().click();  // select first action
  const value = page.getByTestId("inspector").locator("textarea").first();
  await expect(value).toBeVisible();
  await value.fill("Edited live");
  await page.getByTestId("scrub").evaluate((el: HTMLInputElement) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, "99"); el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.getByTestId("canvas-text").getByText("Edited live")).toBeVisible();

  await request.delete(`/api/decks/${id}`);
});
