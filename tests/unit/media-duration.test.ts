import { afterEach, expect, test, vi } from "vitest";
import { readMediaDuration } from "@/lib/editor/media-duration";

const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL;
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke; });

test("images resolve undefined without touching an element", async () => {
  expect(await readMediaDuration(new File(["x"], "a.png", { type: "image/png" }))).toBeUndefined();
});

test("video resolves the loadedmetadata duration; error and timeout resolve undefined", async () => {
  const revoke = vi.fn();
  URL.createObjectURL = vi.fn(() => "blob:x"); URL.revokeObjectURL = revoke;
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const file = new File(["x"], "a.mp4", { type: "video/mp4" });
  let created: HTMLMediaElement | undefined;
  const orig = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((t: string) => { const e = orig(t); if (t === "video") created = e as HTMLMediaElement; return e; }) as never);

  const p = readMediaDuration(file);
  Object.defineProperty(created!, "duration", { value: 2.4, configurable: true });
  created!.onloadedmetadata!(new Event("loadedmetadata"));
  expect(await p).toBe(2.4);
  expect(revoke).toHaveBeenCalledWith("blob:x");

  const p2 = readMediaDuration(file);
  created!.onerror!(new Event("error"));
  expect(await p2).toBeUndefined();

  vi.useFakeTimers();
  const p3 = readMediaDuration(file);
  vi.advanceTimersByTime(5001);
  expect(await p3).toBeUndefined();
});
