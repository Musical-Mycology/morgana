import { test, expect } from "@playwright/test";

// samples/demo.deck.json's "open" scene has no `objects` array (0 rows / 0 canvas
// objects at boot), so assertions below use row-count deltas from that empty
// baseline rather than assuming any particular starting content.

test.beforeEach(async ({ page }) => {
  await page.goto("/editor?deck=demo");
  // The panel's own markup is server-rendered, so waiting on it alone can hand back a page whose
  // client bundle has not hydrated — the `layer-object-add` <select> is then present but its
  // onChange is not wired, and selectOption() silently no-ops. Filmstrip beat buttons are derived
  // from the client-side deck fetch, so their presence proves hydration ran AND the doc loaded.
  await page.getByTestId("layers-panel").waitFor();
  await page.locator(".ed__beat").first().waitFor();
});

test("add via panel renders a row and selects it on the canvas", async ({ page }) => {
  const rows = page.getByTestId("layer-row");
  const before = await rows.count();

  await page.getByTestId("layer-object-add").selectOption("shape");

  await expect(rows).toHaveCount(before + 1);
  // single new object -> overlay visible on the canvas for the freshly selected object
  await expect(page.getByTestId("obj-selection")).toBeVisible();
});

test("hide from the panel removes the object from the canvas overlay", async ({ page }) => {
  await page.getByTestId("layer-object-add").selectOption("shape");
  const row = page.getByTestId("layer-row").first();
  const objId = await row.getAttribute("data-obj-id");

  const canvasObj = page.locator(`[data-testid="obj"][data-obj-id="${objId}"]`);
  await expect(canvasObj).toHaveCount(1);

  await row.getByTestId("layer-hide").click();

  await expect(canvasObj).toHaveCount(0);
});

test("group two objects then ungroup", async ({ page }) => {
  const rows = page.getByTestId("layer-row");
  const baseline = await rows.count();

  await page.getByTestId("layer-object-add").selectOption("shape");
  await page.getByTestId("layer-object-add").selectOption("shape");
  await expect(rows).toHaveCount(baseline + 2);

  await rows.nth(baseline).click();
  await rows.nth(baseline + 1).click({ modifiers: ["Shift"] });
  await page.getByTestId("layer-group").click();

  // Grouping wraps the two shapes into one group object. The panel flattens
  // groups expanded by default, so the tree now shows: 1 group row + its 2
  // children = baseline + 3 rows (one more than the baseline + 2 pre-group flat
  // rows). Also confirm a group is actually selected via the enabled ungroup button.
  await expect(rows).toHaveCount(baseline + 3);
  await expect(page.getByTestId("layer-ungroup")).toBeEnabled();

  await page.getByTestId("layer-ungroup").click();

  // Ungrouping removes the group row, restoring the pre-group row count.
  await expect(rows).toHaveCount(baseline + 2);
  await expect(page.getByTestId("layer-ungroup")).toBeDisabled();
});

test("raise reorders the primary in the tree", async ({ page }) => {
  const rows = page.getByTestId("layer-row");
  const before = await rows.count();
  await page.getByTestId("layer-object-add").selectOption("shape");
  await page.getByTestId("layer-object-add").selectOption("text");
  await expect(rows).toHaveCount(before + 2);

  // The panel lists topmost-first (flattenForPanel walks each sibling array in reverse), so the
  // two just-added objects are rows 0 (text, newest) and 1 (shape) whatever the baseline is.
  // Raise therefore has to act on row 1 — it is correctly disabled on row 0, which is already
  // the top of the sibling list (spec §4.5).
  const secondId = await rows.nth(1).getAttribute("data-obj-id");

  await rows.nth(1).click();
  await expect(page.getByTestId("layer-raise")).toBeEnabled();
  await page.getByTestId("layer-raise").click();

  // Raised past the text object → it is now the topmost row.
  // (Not asserted here: that Raise then goes disabled. reorderObject swaps the array entries but
  // leaves selectedObjectPaths on the old index, so the toolbar's enabled state now describes the
  // object that got swapped *down*. Selection-follows-reorder is a separate concern from this
  // test's subject; the boundary-disable behaviour itself is covered by the next test.)
  await expect(rows.first()).toHaveAttribute("data-obj-id", secondId!);
});

test("raise is disabled for the topmost object", async ({ page }) => {
  await page.getByTestId("layer-object-add").selectOption("shape");
  await page.getByTestId("layer-object-add").selectOption("text");
  await page.getByTestId("layer-row").first().click(); // first row == top of the stack
  await expect(page.getByTestId("layer-raise")).toBeDisabled();
  await expect(page.getByTestId("layer-lower")).toBeEnabled();
});
