import { expect, test } from "@playwright/test";

/** Set a range input to `value` and fire the React onChange (mirrors e2e/spike.spec.ts —
 * the native value setter is required for React's controlled-input tracking to see it). */
async function setRange(page: import("@playwright/test").Page, testId: string, value: number) {
  await page.getByTestId(testId).evaluate(
    (el: HTMLInputElement, v: number) => {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      nativeSetter?.call(el, String(v));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    value,
  );
}

// Proves the Task 7 mode-swap + Task 1-6 object-render pipeline actually works end-to-end in
// the real editor UI: an object gated by an obj_reveal action is invisible at rest (t=0,
// paused), and becomes visible once playback/scrub carries it into the reveal's window.
test("gated object stays hidden at rest and reveals under scrub/play", async ({ page, request }) => {
  const id = "e2e-objects-playback";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = {
    version: 1,
    meta: { id, title: "Obj Playback" },
    scenes: [{ id: "s", beats: [{ id: "a", timeline: [] }] }],
  };
  await request.post("/api/decks", { data: { id, title: "Obj Playback" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  // Small settle after navigation before the first interaction — this suite has an existing,
  // pre-#3b flakiness where the client bundle isn't fully hydrated the instant the shell HTML
  // paints (see e.g. e2e/objects.spec.ts hitting the same race); a brief wait here measurably
  // reduces (does not eliminate) hitting it.
  await page.waitForTimeout(300);

  // Add a shape object (adds + selects it) and give it an entrance (obj_reveal targeting it
  // on the current beat's timeline, default durationMs 600).
  await page.getByTestId("layer-object-add").selectOption("shape");
  await page.getByTestId("add-entrance").click();

  const stage = page.getByTestId("object-stage");
  const obj = stage.locator("[data-obj-id]").first();

  // At rest (t=0, paused) the whole object-render layer is display:none — the Task 7 mode
  // swap — so the gated object is not visible regardless of its own computed opacity.
  await expect(stage).toHaveCSS("display", "none");

  // Scrub to the end of the reveal window (beat duration is exactly the 0.6s obj_reveal
  // takes, since it's the only timed action on this beat): the stage activates and the
  // object reaches full opacity.
  await setRange(page, "scrub", 0.6);
  await expect(stage).toHaveCSS("display", "block");
  await expect(obj).toBeVisible();
  await expect(obj).toHaveCSS("opacity", "1");

  // Scrubbing back to t=0 flips the stage back off — confirms the hidden state isn't a
  // one-shot fluke of initial mount, but tracks playhead position.
  await setRange(page, "scrub", 0);
  await expect(stage).toHaveCSS("display", "none");

  // Play from the top: partway through the reveal the object should be mid-fade-in, and by
  // the time playback finishes the beat (reaching the end, at or past the reveal window) it
  // is fully visible again — proving the same reveal logic drives real-time playback, not
  // just manual scrubbing.
  await page.getByRole("button", { name: /play/i }).click();
  await expect(stage).toHaveCSS("display", "block");
  await expect(obj).toHaveCSS("opacity", "1", { timeout: 3000 });

  await request.delete(`/api/decks/${id}`);
});

// Proves obj_move and obj_out (position change + disappearance) also work end-to-end through
// the real editor UI, extending the obj_reveal-only coverage above. A single object carries all
// three verbs in sequence: reveal (0-0.6s) -> move (0.6-1.4s) -> out (1.4-1.9s).
test("obj_move animates position and obj_out fades the object out, both through the real editor", async ({ page, request }) => {
  const id = "e2e-objects-playback-move-out";
  await request.delete(`/api/decks/${id}`).catch(() => {});
  const doc = {
    version: 1,
    meta: { id, title: "Obj Move/Out" },
    scenes: [{ id: "s", beats: [{ id: "a", timeline: [] }] }],
  };
  await request.post("/api/decks", { data: { id, title: "Obj Move/Out" } });
  await request.put(`/api/decks/${id}`, { data: doc });

  await page.goto(`/editor?deck=${id}`);
  await page.waitForTimeout(300);

  // Add a shape object (adds + selects it) and give it an entrance.
  await page.getByTestId("layer-object-add").selectOption("shape");
  await page.getByTestId("add-entrance").click();

  const layerRow = page.getByTestId("layer-row").first();
  const stage = page.getByTestId("object-stage");
  const obj = stage.locator("[data-obj-id]").first();

  // addObjectAnimation selects the newly-added action (deselecting the object), so re-select
  // the object from the Layers panel before adding the next verb — mirrors how a real author
  // would click back to the object between animation additions.
  await layerRow.click();
  await page.getByTestId("add-emphasis").click();

  // The obj_move action was just added and is now selected in the Inspector; its `to` defaults
  // to the object's current position, so give it a distinct X to make the move observable.
  await page.getByLabel("To X").fill("0.8");

  await layerRow.click();
  await page.getByTestId("add-exit").click();

  // End of the reveal window (0.6s): object fully visible at its declared position.
  await setRange(page, "scrub", 0.6);
  await expect(obj).toBeVisible();
  const leftAtReveal = await obj.evaluate((el) => el.style.left);

  // End of the move window (1.4s, i.e. right before obj_out starts): position has changed.
  await setRange(page, "scrub", 1.39);
  const leftAtMoveEnd = await obj.evaluate((el) => el.style.left);
  expect(leftAtMoveEnd).not.toBe(leftAtReveal);
  expect(parseFloat(leftAtMoveEnd)).toBeCloseTo(80, 0); // to.x = 0.8 -> 80%

  // Past the end of the obj_out window (1.9s): the object has faded out and is hidden.
  await setRange(page, "scrub", 1.9);
  await expect(obj).toBeHidden();
  await expect(obj).toHaveCSS("display", "none");

  await request.delete(`/api/decks/${id}`);
});
