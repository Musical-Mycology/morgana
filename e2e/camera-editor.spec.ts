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
  // The editor's own ObjectStage stays at full frame: neither it nor any ancestor up to the canvas
  // host carries a transform (computed, so a class rule would count too).
  const objChain = await page.evaluate(() => {
    const out: string[] = [];
    for (let n = document.querySelector<HTMLElement>(".ed__canvas [data-testid=object-stage]"); n; n = n.parentElement) {
      out.push(getComputedStyle(n).transform);
      if (n.classList.contains("ed__canvas-host")) break;
    }
    return out;
  });
  expect(objChain.length).toBeGreaterThanOrEqual(2);
  for (const tf of objChain) expect(tf).toBe("none");
});

// Final review Minor 2: the canvas host must be exactly 16:9 in every pane shape — a box wider than
// 16:9 (a 100% width under a max-height cap) put picks off the framing they showed.
test("the editor canvas host is exactly 16:9 in a short, wide pane and in a tall, narrow one", async ({ page, request }) => {
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = { version: 1, meta: { id, title: "Camera editor" }, scenes: [
    { id: "s", beats: [{ id: "a", timeline: [{ kind: "camera", to: { zoom: 2 } }, { kind: "wait", ms: 2000 }] }] },
  ] };
  await request.post("/api/decks", { data: { id, title: "Camera editor" } });
  await request.put(`/api/decks/${id}`, { data: doc });
  const ratio = async () => {
    const host = (await page.locator(".ed__canvas-host").boundingBox())!;
    const pane = (await page.locator(".ed__canvas").boundingBox())!;
    return { r: host.width / host.height, host, pane };
  };
  for (const vp of [{ width: 1600, height: 600 }, { width: 1000, height: 1000 }]) {
    await page.setViewportSize(vp);
    await page.goto(`/editor?deck=${id}`);
    await expect(page.locator(".ed__canvas-host")).toBeVisible();
    const { r, host, pane } = await ratio();
    expect(Math.abs(r / (16 / 9) - 1), `${vp.width}x${vp.height}: host ${host.width}x${host.height}`).toBeLessThanOrEqual(0.005);
    // It fills the pane in the binding direction (minus the pane's 16px padding) and fits inside it.
    expect(host.width).toBeLessThanOrEqual(pane.width - 32 + 1);
    expect(host.height).toBeLessThanOrEqual(pane.height - 32 + 1);
    expect(Math.max(host.width / (pane.width - 32), host.height / (pane.height - 32))).toBeGreaterThan(0.99);
  }

  // In the short, wide pane the pick overlay (whose fractions become x/y) is 16:9 and covers exactly
  // the art the canvas draws: a wider box would put a pick off the framing it showed.
  await page.setViewportSize({ width: 1600, height: 600 });
  await page.goto(`/editor?deck=${id}`);
  await page.getByTestId("timeline").locator(".ed__chip").nth(0).click();
  await page.getByTestId("camera-pick").click();
  const overlay = (await page.getByTestId("camera-pick-overlay").boundingBox())!;
  const art = (await page.locator(".ed__canvas .artstage").boundingBox())!;
  expect(Math.abs(overlay.width / overlay.height / (16 / 9) - 1)).toBeLessThanOrEqual(0.005);
  for (const k of ["x", "y", "width", "height"] as const) expect(Math.abs(overlay[k] - art[k]), `overlay vs art ${k}`).toBeLessThanOrEqual(1);
});
