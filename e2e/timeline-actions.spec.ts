import { expect, test } from "@playwright/test";

test("add / reorder / duplicate / convert / delete actions on the timeline, and undo restores", async ({ page, request }) => {
  const id = "e2e-timeline-actions";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Timeline Actions" }, scenes: [
    { id: "s", beats: [{ id: "a", timeline: [{ kind: "text", value: "A", in: "fade" }, { kind: "wait", ms: 100 }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Timeline Actions" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const timeline = page.getByTestId("timeline");
  await expect(timeline.locator(".ed__chip")).toHaveCount(2);

  // Add: select the "wait" chip, add a "Clear" action after it.
  await timeline.locator(".ed__chip").nth(1).click();
  await page.getByTestId("action-add").selectOption("clear");
  await expect(timeline.locator(".ed__chip")).toHaveCount(3);
  await expect(timeline.locator(".ed__chip").nth(2)).toContainText("clear");

  // Reorder: move the new "clear" chip up one slot (now at index 2, moves to index 1).
  await timeline.locator(".ed__chip").nth(2).click();
  await page.getByTestId("action-up").click();
  await expect(timeline.locator(".ed__chip").nth(1)).toContainText("clear");

  // Duplicate: duplicate the (now-selected) "clear" chip at index 1.
  await page.getByTestId("action-dupe").click();
  await expect(timeline.locator(".ed__chip")).toHaveCount(4);

  // Convert: convert the first chip ("text") to "wait" via the Inspector.
  await timeline.locator(".ed__chip").nth(0).click();
  await page.getByTestId("action-convert").selectOption("wait");
  await expect(timeline.locator(".ed__chip").nth(0)).toContainText("wait");

  // Delete: delete the now-selected (converted) chip.
  await timeline.locator(".ed__chip").nth(0).click();
  await page.getByTestId("action-delete").click();
  await expect(timeline.locator(".ed__chip")).toHaveCount(3);

  // Undo restores the prior state.
  await page.getByTestId("undo").click();
  await expect(timeline.locator(".ed__chip")).toHaveCount(4);

  await request.delete(`/api/decks/${id}`);
});
