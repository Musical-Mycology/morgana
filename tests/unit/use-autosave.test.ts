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

// Flush the microtask queue without relying on fake timers (the pending saves below are
// resolved directly, not via setTimeout).
const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

test("a stale response for an older revision does not report 'saved' after a newer save has started", async () => {
  const onStatus = vi.fn();
  let resolveOld!: () => void;
  let resolveNew!: () => void;
  const oldSave = new Promise<{ ok: true }>((res) => { resolveOld = () => res({ ok: true }); });
  const newSave = new Promise<{ ok: true }>((res) => { resolveNew = () => res({ ok: true }); });
  saveDeck.mockImplementationOnce(() => oldSave);
  saveDeck.mockImplementationOnce(() => newSave);

  const { rerender } = renderHook(
    ({ revision }: { revision: number }) => useAutosave(doc, revision, onStatus),
    { initialProps: { revision: 1 } },
  );

  // Revision 1's save fires and is left in flight (slow request).
  await vi.advanceTimersByTimeAsync(700);
  expect(saveDeck).toHaveBeenCalledTimes(1);

  // The user edits again 700ms later: revision 2's save fires while revision 1's is still
  // outstanding — two saves now in flight at once.
  rerender({ revision: 2 });
  await vi.advanceTimersByTimeAsync(700);
  expect(saveDeck).toHaveBeenCalledTimes(2);

  // The NEWER save resolves first.
  resolveNew();
  await flushMicrotasks();
  expect(onStatus).toHaveBeenCalledWith("saved");
  const savedCallsAfterNew = onStatus.mock.calls.filter((c) => c[0] === "saved").length;
  expect(savedCallsAfterNew).toBe(1);

  // The OLDER (stale) save resolves after — it must not re-report "saved" and hide the
  // fact that the latest revision's own save already settled.
  resolveOld();
  await flushMicrotasks();
  const savedCallsAfterOld = onStatus.mock.calls.filter((c) => c[0] === "saved").length;
  expect(savedCallsAfterOld).toBe(1);
});
