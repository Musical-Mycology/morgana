import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAutosave } from "@/lib/editor/use-autosave";
import type { DeckDoc } from "@/engine/deck-doc";

const saveDeck = vi.fn(async (_doc: DeckDoc) => ({ ok: true as const }));
vi.mock("@/lib/api/decks-client", () => ({
  saveDeck: (doc: DeckDoc) => saveDeck(doc),
}));

beforeEach(() => {
  vi.useFakeTimers();
  saveDeck.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

const doc: DeckDoc = { version: 1, meta: { id: "demo", title: "Demo" }, scenes: [] };

test("after markSaved(rev) for the current revision, re-rendering with that revision does not schedule another save", async () => {
  const onStatusA = vi.fn();
  const { result, rerender } = renderHook(
    ({ revision, onStatus }: { revision: number; onStatus: (s: string, e?: string) => void }) =>
      useAutosave(doc, revision, onStatus),
    { initialProps: { revision: 1, onStatus: onStatusA } },
  );

  // Mark revision 1 as already saved — as a manual retry that bypasses the hook (and thus
  // never lets the hook's own debounced save fire) would do on success.
  result.current.markSaved(1);

  // Re-render with the SAME revision but a fresh `onStatus` identity — this mirrors
  // `app/editor/page.tsx`, where `onStatus` gets a new closure on every render (it depends
  // on `externalChange`, whose own identity is unstable). That dependency change re-runs the
  // debounce effect; before this fix it would blindly reschedule a save because `lastSaved`
  // was never updated by the outside-the-hook retry. With `markSaved` wired up, the guard
  // (`revision === lastSaved.current`) now correctly short-circuits it.
  const onStatusB = vi.fn();
  rerender({ revision: 1, onStatus: onStatusB });

  await vi.advanceTimersByTimeAsync(1000);

  expect(saveDeck).not.toHaveBeenCalled();
});

test("a revision change still schedules a save", async () => {
  const onStatus = vi.fn();
  const { rerender } = renderHook(
    ({ revision }: { revision: number }) => useAutosave(doc, revision, onStatus),
    { initialProps: { revision: 1 } },
  );

  rerender({ revision: 2 });

  await vi.advanceTimersByTimeAsync(1000);

  expect(saveDeck).toHaveBeenCalledTimes(1);
  expect(saveDeck).toHaveBeenCalledWith(doc);
});

test("after a failed save, the same revision is not retried", async () => {
  saveDeck.mockRejectedValueOnce(new Error("boom"));
  const { rerender } = renderHook(
    ({ revision, onStatus }: { revision: number; onStatus: (s: string, e?: string) => void }) =>
      useAutosave(doc, revision, onStatus),
    { initialProps: { revision: 1, onStatus: vi.fn() } },
  );

  await vi.advanceTimersByTimeAsync(1000);
  expect(saveDeck).toHaveBeenCalledTimes(1);

  // Re-render several times with the SAME revision but a fresh `onStatus` identity each
  // time — mirroring app/editor/page.tsx, where onStatus is rebuilt every render. Before the
  // `lastAttempted` guard, each of these re-runs the debounce effect and, because the failed
  // save never updated `lastSaved`, blindly reschedules another save.
  rerender({ revision: 1, onStatus: vi.fn() });
  rerender({ revision: 1, onStatus: vi.fn() });
  rerender({ revision: 1, onStatus: vi.fn() });

  await vi.advanceTimersByTimeAsync(1000);

  expect(saveDeck).toHaveBeenCalledTimes(1);
});

test("a new revision after a failure does save", async () => {
  saveDeck.mockRejectedValueOnce(new Error("boom"));
  const { rerender } = renderHook(
    ({ revision, onStatus }: { revision: number; onStatus: (s: string, e?: string) => void }) =>
      useAutosave(doc, revision, onStatus),
    { initialProps: { revision: 1, onStatus: vi.fn() } },
  );

  await vi.advanceTimersByTimeAsync(1000);
  expect(saveDeck).toHaveBeenCalledTimes(1);

  rerender({ revision: 2, onStatus: vi.fn() });

  await vi.advanceTimersByTimeAsync(1000);

  expect(saveDeck).toHaveBeenCalledTimes(2);
});
