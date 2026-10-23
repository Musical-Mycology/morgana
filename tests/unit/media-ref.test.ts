import { expect, test } from "vitest";
import { isMediaRef, isVideoRef, mediaRefId, toMediaRef, MEDIA_REF_PREFIX } from "@/engine/deck/media-ref";

test("isMediaRef accepts media:<id> only", () => {
  expect(MEDIA_REF_PREFIX).toBe("media:");
  expect(isMediaRef("media:0123456789abcdef.mp4")).toBe(true);
  expect(isMediaRef("1.01")).toBe(false);
  expect(isMediaRef("media:")).toBe(false);
  expect(isMediaRef(42)).toBe(false);
});

test("mediaRefId round-trips with toMediaRef", () => {
  const id = "0123456789abcdef.mp4";
  expect(toMediaRef(id)).toBe(`media:${id}`);
  expect(mediaRefId(toMediaRef(id))).toBe(id);
});

test("isVideoRef matches .mp4/.webm media refs, case-insensitive", () => {
  expect(isVideoRef("media:x.MP4")).toBe(true);
  expect(isVideoRef("media:x.webm")).toBe(true);
  expect(isVideoRef("media:x.png")).toBe(false);
  expect(isVideoRef("1.01")).toBe(false);
});

test("MEDIA_ID_PATTERN (pure) matches the store's ids and is what deck-doc re-exports", async () => {
  const { MEDIA_ID_PATTERN } = await import("@/engine/deck/media-ref");
  const docMod = await import("@/engine/deck-doc");
  expect(docMod.MEDIA_ID_PATTERN).toBe(MEDIA_ID_PATTERN);
  expect(MEDIA_ID_PATTERN.test("0123456789abcdef.mp4")).toBe(true);
  expect(MEDIA_ID_PATTERN.test("../../x")).toBe(false);
  expect(MEDIA_ID_PATTERN.test("a.mp4?b")).toBe(false);
});
