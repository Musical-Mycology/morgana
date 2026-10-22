import { expect, test } from "vitest";
import { validateDeckDoc, type DeckDoc } from "@/engine/deck-doc";
import { MEDIA_ID_RE } from "@/lib/store/media-store";

const base = (): DeckDoc => ({ version: 1, meta: { id: "d", title: "D" }, scenes: [] });
const errs = (d: DeckDoc) => validateDeckDoc(d).errors;

test("soundtrack and markers are optional and valid when well-formed", () => {
  const d = base();
  d.meta.soundtrack = { media: "0123456789abcdef.mp3" };
  d.meta.markers = [{ id: "m1", label: "drop", t: 40.2 }, { id: "m2", label: "start", t: 0 }];
  expect(validateDeckDoc(d)).toEqual({ ok: true, errors: [] });
  expect(validateDeckDoc(base()).ok).toBe(true);
});

test("soundtrack.media must be a media id", () => {
  const d = base();
  (d.meta as unknown as Record<string, unknown>).soundtrack = { media: "../x.mp3" };
  expect(errs(d)).toContain("meta.soundtrack.media must be a media id");
});

test("marker validation", () => {
  const d = base();
  (d.meta as unknown as Record<string, unknown>).markers = [
    { id: "", label: "a", t: 1 }, { id: "m", label: "", t: 1 }, { id: "m", label: "b", t: -1 },
    { id: "n", label: "x".repeat(41), t: Number.NaN },
  ];
  const e = errs(d);
  expect(e).toContain("meta.markers[0].id must be a non-empty string");
  expect(e).toContain("meta.markers[1].label must be 1–40 characters");
  expect(e).toContain('meta.markers[2].id "m" duplicated');
  expect(e).toContain("meta.markers[2].t must be a finite number ≥ 0");
  expect(e).toContain("meta.markers[3].label must be 1–40 characters");
  expect(e).toContain("meta.markers[3].t must be a finite number ≥ 0");
  (d.meta as unknown as Record<string, unknown>).markers = "nope";
  expect(errs(d)).toContain("meta.markers must be an array");
});

test("the format's media-id pattern matches the store's", async () => {
  const { MEDIA_ID_PATTERN } = await import("@/engine/deck-doc");
  expect(MEDIA_ID_PATTERN.source).toBe(MEDIA_ID_RE.source);
});
