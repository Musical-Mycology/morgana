import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useExternalChangePoll } from "@/lib/editor/use-external-change-poll";

let mtime = 1000;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mtime = 1000;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ mtimeMs: mtime }) } as Response)));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("flags changed once the polled mtime moves", async () => {
  const { result } = renderHook(() => useExternalChangePoll("demo", 100));
  await waitFor(() => expect(result.current.changed).toBe(false));

  mtime = 2000;
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(result.current.changed).toBe(true);
});

test("dismiss clears the flag without changing the baseline", async () => {
  const { result } = renderHook(() => useExternalChangePoll("demo", 100));
  await waitFor(() => expect(result.current.changed).toBe(false));
  mtime = 2000;
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(result.current.changed).toBe(true);
  act(() => result.current.dismiss());
  expect(result.current.changed).toBe(false);
});

test("resync adopts the current mtime as the new baseline", async () => {
  const { result } = renderHook(() => useExternalChangePoll("demo", 100));
  await waitFor(() => expect(result.current.changed).toBe(false));
  mtime = 2000;
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(result.current.changed).toBe(true);

  await act(async () => { result.current.resync(); await Promise.resolve(); await Promise.resolve(); });
  expect(result.current.changed).toBe(false);

  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(result.current.changed).toBe(false);
});

test("does nothing when deckId is null", async () => {
  const { result } = renderHook(() => useExternalChangePoll(null, 100));
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(result.current.changed).toBe(false);
});
