import { afterEach, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSoundtrack, releaseSoundtracksExcept, __resetSoundtrackCache } from "@/lib/audio/use-soundtrack";
import type { Soundtrack } from "@/lib/audio/soundtrack";

afterEach(() => __resetSoundtrackCache());
const track = { duration: 3, peaks: new Float32Array(4) } as unknown as Soundtrack;

test("none without a media id; loading → ready; one decode shared across hooks", async () => {
  const load = vi.fn(() => Promise.resolve(track));
  expect(renderHook(() => useSoundtrack("d", undefined, load)).result.current).toEqual({ status: "none" });
  const a = renderHook(() => useSoundtrack("d", "0123456789abcdef.mp3", load));
  const b = renderHook(() => useSoundtrack("d", "0123456789abcdef.mp3", load));
  expect(a.result.current.status).toBe("loading");
  await act(async () => {});
  expect(a.result.current).toEqual({ status: "ready", track });
  expect(b.result.current).toEqual({ status: "ready", track });
  expect(load).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledWith("/api/decks/d/media/0123456789abcdef.mp3");
});

test("a failed decode is an error state, not a throw", async () => {
  const { result } = renderHook(() => useSoundtrack("d", "0123456789abcdef.mp3", () => Promise.reject(new Error("bad audio"))));
  await act(async () => {});
  expect(result.current).toEqual({ status: "error", error: "bad audio" });
});

test("releaseSoundtracksExcept disposes and evicts only the deck's other tracks", async () => {
  const mk = () => ({ duration: 1, peaks: new Float32Array(1), dispose: vi.fn() });
  const keep = mk(), old = mk(), other = mk();
  const byUrl: Record<string, ReturnType<typeof mk>> = {
    "/api/decks/d/media/0123456789abcdef.mp3": keep,
    "/api/decks/d/media/fedcba9876543210.mp3": old,
    "/api/decks/e/media/0123456789abcdef.mp3": other,
  };
  const load = vi.fn((url: string) => Promise.resolve(byUrl[url] as unknown as Soundtrack));
  for (const [deck, id] of [["d", "0123456789abcdef.mp3"], ["d", "fedcba9876543210.mp3"], ["e", "0123456789abcdef.mp3"]])
    renderHook(() => useSoundtrack(deck, id, load));
  await act(async () => {});
  releaseSoundtracksExcept("d", "0123456789abcdef.mp3");
  await act(async () => {});
  expect(old.dispose).toHaveBeenCalledTimes(1);
  expect(keep.dispose).not.toHaveBeenCalled();
  expect(other.dispose).not.toHaveBeenCalled();
  // evicted: a new mount decodes again; the kept one does not
  load.mockClear();
  renderHook(() => useSoundtrack("d", "fedcba9876543210.mp3", load));
  renderHook(() => useSoundtrack("d", "0123456789abcdef.mp3", load));
  expect(load).toHaveBeenCalledTimes(1);
  // removing the soundtrack (undefined) releases everything of the deck
  releaseSoundtracksExcept("d", undefined);
  await act(async () => {});
  expect(keep.dispose).toHaveBeenCalledTimes(1);
  expect(other.dispose).not.toHaveBeenCalled();
});
