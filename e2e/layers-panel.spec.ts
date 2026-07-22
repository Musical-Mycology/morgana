import { test, expect } from "@playwright/test";

// samples/demo.deck.json's "open" scene has no `objects` array (0 rows / 0 canvas
// objects at boot), so assertions below use row-count deltas from that empty
// baseline rather than assuming any particular starting content.

test.beforeEach(async ({ page }) => {
  await page.goto("/editor?deck=demo");
  await page.getByTestId("layers-panel").waitFor();
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
  await page.getByTestId("layer-object-add").selectOption("shape");
  await page.getByTestId("layer-object-add").selectOption("text");
  const first = page.getByTestId("layer-row").first();
  const beforeId = await first.getAttribute("data-obj-id");
  await first.click();
  await page.getByTestId("layer-raise").click();
  await expect(page.getByTestId("layer-row").first()).not.toHaveAttribute("data-obj-id", beforeId!);
});
