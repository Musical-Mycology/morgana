import { afterEach, expect, test, vi } from "vitest";
import { readMediaDuration } from "@/lib/editor/media-duration";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

test("images resolve undefined without touching an element", async () => {
  expect(await readMediaDuration(new File(["x"], "a.png", { type: "image/png" }))).toBeUndefined();
});

test("video resolves the loadedmetadata duration; error and timeout resolve undefined", async () => {
  URL.createObjectURL = vi.fn(() => "blob:x"); URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const file = new File(["x"], "a.mp4", { type: "video/mp4" });
  let created: HTMLMediaElement | undefined;
  const orig = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((t: string) => { const e = orig(t); if (t === "video") created = e as HTMLMediaElement; return e; }) as never);

  const p = readMediaDuration(file);
  Object.defineProperty(created!, "duration", { value: 2.4, configurable: true });
  created!.onloadedmetadata!(new Event("loadedmetadata"));
  expect(await p).toBe(2.4);

  const p2 = readMediaDuration(file);
  created!.onerror!(new Event("error"));
  expect(await p2).toBeUndefined();

  vi.useFakeTimers();
  const p3 = readMediaDuration(file);
  vi.advanceTimersByTime(5001);
  expect(await p3).toBeUndefined();
});
