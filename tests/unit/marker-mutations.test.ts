import { expect, test } from "vitest";
import { addMarker, updateMarker, deleteMarker } from "@/lib/editor/mutations";
import type { DeckDoc } from "@/engine/deck-doc";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [] });

test("addMarker creates unique ids and numbered labels", () => {
  const a = addMarker(base(), 4.123);
  expect(a.doc.meta.markers).toEqual([{ id: "m1", label: "marker 1", t: 4.12 }]);
  const b = addMarker(a.doc, 10);
  expect(b.id).toBe("m2");
  expect(b.doc.meta.markers![1]).toEqual({ id: "m2", label: "marker 2", t: 10 });
});

test("updateMarker patches; identical values are a no-op (same reference)", () => {
  const { doc } = addMarker(base(), 1);
  const renamed = updateMarker(doc, "m1", { label: "drop" });
  expect(renamed.meta.markers![0].label).toBe("drop");
  expect(updateMarker(renamed, "m1", { label: "drop" })).toBe(renamed);
  expect(updateMarker(renamed, "nope", { t: 2 })).toBe(renamed);
});

test("deleteMarker removes it, and the field when the list empties", () => {
  const { doc } = addMarker(base(), 1);
  const gone = deleteMarker(doc, "m1");
  expect(gone.meta.markers).toBeUndefined();
  expect(deleteMarker(gone, "m1")).toBe(gone);
});
