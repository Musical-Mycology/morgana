import { expect, test } from "@playwright/test";

// Per-worker deck id: parallel workers (--repeat-each) must not share a deck.
let id = "";
test.beforeEach(({}, info) => { id = `e2e-camera-editor-${info.parallelIndex}`; });
test.afterEach(async ({ request }) => { await request.delete(`/api/decks/${id}`); });

test("add a Camera action, Pick on canvas near an edge (clamped), and the canvas previews the move", async ({ page, request }) => {
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Camera editor" }, scenes: [
    { id: "s", beats: [{ id: "a", art: { to: "1.01", mode: "cut" }, timeline: [{ kind: "wait", ms: 100 }, { kind: "wait", ms: 3000 }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Camera editor" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  const timeline = page.getByTestId("timeline");
  await expect(timeline.locator(".ed__chip")).toHaveCount(2);

  // Add a Camera action after the first wait: it starts at 0.1 s and (1200 ms default) ends at 1.3 s.
  await timeline.locator(".ed__chip").nth(0).click();
  await page.getByTestId("action-add").selectOption("camera");
  await expect(timeline.locator(".ed__chip")).toHaveCount(3);
  await expect(page.getByTestId("inspector")).toContainText("Camera action");

  // Zoom 3.
  await page.getByTestId("inspector").getByLabel("Zoom (1–8)").fill("3");

  // Pick near the top-left corner: the 1/3-size view clamps its centre to 0.5/3 ≈ 0.1667.
  await page.getByTestId("camera-pick").click();
  const overlay = page.getByTestId("camera-pick-overlay");
  await expect(overlay).toBeVisible();
  await overlay.click({ position: { x: 4, y: 4 } });
  await expect(overlay).toHaveCount(0);

  await expect(page.getByTestId("save-status")).toHaveText("Saved");
  const saved = (await (await request.get(`/api/decks/${id}`)).json()) as {
    scenes: { beats: { timeline: { kind: string; to?: { x: number; y: number; zoom: number } }[] }[] }[];
  };
  const cam = saved.scenes[0].beats[0].timeline[1];
  expect(cam.kind).toBe("camera");
  expect(cam.to!.zoom).toBe(3);
  expect(cam.to!.x).toBeCloseTo(0.1667, 3);
  expect(cam.to!.y).toBeCloseTo(0.1667, 3);

  // Scrub to the action's end: the canvas art world shows the 3× framing.
  await page.getByTestId("scrub").evaluate((el: HTMLInputElement) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, "1.3"); el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>(".ed__canvas .artstage__world")?.style.transform ?? ""))
    .toContain("scale(3)");
  // The editor's own ObjectStage stays at full frame.
  expect(await page.evaluate(() => document.querySelector<HTMLElement>(".ed__canvas [data-testid=object-stage]")?.parentElement?.style.transform ?? "")).toBe("");
});
