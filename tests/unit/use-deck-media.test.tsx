// @vitest-environment jsdom
// Final review M8: refresh() sets the list state AND rethrows, so a caller (MediaLibrary's
// REFRESH_FAILED row) can tell a failed refresh; the mount-time load never leaks a rejection.
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import * as client from "@/lib/api/media-client";
import { useDeckMediaState } from "@/lib/editor/use-deck-media";
import type { MediaInfo } from "@/lib/store/media-store";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const item: MediaInfo = { id: "0123456789abcdef.png", name: "a.png", mime: "image/png", bytes: 3, uploadedAt: "2026-10-23T00:00:00.000Z" };

test("refresh resolves and sets the list on success", async () => {
  vi.spyOn(client, "listMedia").mockResolvedValue([item]);
  const { result } = renderHook(() => useDeckMediaState("d1"));
  await waitFor(() => expect(result.current.media).toEqual([item]));
  await act(async () => { await expect(result.current.refresh()).resolves.toBeUndefined(); });
});

test("a failed refresh clears the list and rejects (the mount load swallows it)", async () => {
  const list = vi.spyOn(client, "listMedia").mockResolvedValueOnce([item]);
  const { result } = renderHook(() => useDeckMediaState("d1"));
  await waitFor(() => expect(result.current.media).toEqual([item]));
  list.mockRejectedValueOnce(new Error("boom"));
  await act(async () => { await expect(result.current.refresh()).rejects.toThrow("boom"); });
  expect(result.current.media).toBeNull();
});

test("the mount-time load failing leaves media null without an unhandled rejection", async () => {
  const list = vi.spyOn(client, "listMedia").mockRejectedValue(new Error("down"));
  const { result } = renderHook(() => useDeckMediaState("d1"));
  await waitFor(() => expect(list).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); });
  expect(result.current.media).toBeNull();
});
