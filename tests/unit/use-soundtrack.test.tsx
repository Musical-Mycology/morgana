import { afterEach, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSoundtrack, __resetSoundtrackCache } from "@/lib/audio/use-soundtrack";
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
