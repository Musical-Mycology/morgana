import { afterEach, expect, test, vi } from "vitest";
import { deleteMedia, listMedia, mediaPath, mediaUrl, uploadMedia } from "@/lib/api/media-client";

afterEach(() => { vi.restoreAllMocks(); });

test("mediaPath is the app-absolute path with no base path", () => {
  expect(mediaPath("d1", "0123456789abcdef.mp3")).toBe("/api/decks/d1/media/0123456789abcdef.mp3");
});

test("mediaUrl applies the base path; mediaPath never does", async () => {
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/m");
  vi.resetModules();
  try {
    const c = await import("@/lib/api/media-client");
    expect(c.mediaUrl("d1", "0123456789abcdef.mp3")).toBe("/m/api/decks/d1/media/0123456789abcdef.mp3");
    expect(c.mediaPath("d1", "0123456789abcdef.mp3")).toBe("/api/decks/d1/media/0123456789abcdef.mp3");
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
  }
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

test("uploadMedia sends durationSec only when finite and positive", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 201 }));
  await uploadMedia("d1", new File(["a"], "a.mp4"), 2.5);
  await uploadMedia("d1", new File(["a"], "a.mp4"), 0);
  await uploadMedia("d1", new File(["a"], "a.mp4"));
  const dur = (i: number) => ((fetchMock.mock.calls[i][1] as RequestInit).body as FormData).get("durationSec");
  expect(dur(0)).toBe("2.5");
  expect(dur(1)).toBeNull();
  expect(dur(2)).toBeNull();
});

test("deleteMedia DELETEs the media path and surfaces the server error", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: "not found" }), { status: 404 }));
  await deleteMedia("d1", "0123456789abcdef.png");
  expect(fetchMock.mock.calls[0][0]).toBe("/api/decks/d1/media/0123456789abcdef.png");
  expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
  await expect(deleteMedia("d1", "0123456789abcdef.png")).rejects.toThrow("not found");
});
