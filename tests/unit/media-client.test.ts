import { afterEach, expect, test, vi } from "vitest";
import { listMedia, mediaPath, mediaUrl, uploadMedia } from "@/lib/api/media-client";

afterEach(() => vi.restoreAllMocks());

test("mediaPath is the app-absolute path with no base path", () => {
  expect(mediaPath("d1", "0123456789abcdef.mp3")).toBe("/api/decks/d1/media/0123456789abcdef.mp3");
});

test("mediaUrl", () => {
  expect(mediaUrl("d1", "0123456789abcdef.mp3")).toBe("/api/decks/d1/media/0123456789abcdef.mp3");
});

test("uploadMedia posts multipart and surfaces the server's error message", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: "x" }), { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: "unsupported file type: a.exe" }), { status: 400 }));
  expect(await uploadMedia("d1", new File(["a"], "a.mp3"))).toEqual({ id: "x" });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/decks/d1/media");
  expect((init as RequestInit).body).toBeInstanceOf(FormData);
  await expect(uploadMedia("d1", new File(["a"], "a.exe"))).rejects.toThrow("unsupported file type: a.exe");
});

test("listMedia unwraps the media array", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ media: [{ id: "m" }] })));
  expect(await listMedia("d1")).toEqual([{ id: "m" }]);
});
