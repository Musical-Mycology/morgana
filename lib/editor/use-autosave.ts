import { useCallback, useEffect, useRef } from "react";
import { saveDeck } from "@/lib/api/decks-client";
import type { DeckDoc } from "@/engine/deck-doc";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface AutosaveHandle {
  /** Records that `rev` has been persisted, so the debounce effect's guard treats it as
   *  up to date. Callers that save outside the hook (e.g. a manual retry) must call this
   *  on success or the hook will schedule a redundant PUT on its next render. */
  markSaved: (rev: number) => void;
  /** Persist the current revision NOW instead of waiting out the debounce (e.g. before opening
   *  the Player, which loads the deck from disk). Resolves once it is saved; waits for a save of
   *  this revision already in flight rather than issuing a second one; makes no request when
   *  nothing is pending (so it never moves the file's mtime for nothing). Goes through the same
   *  status reporting as a debounced save. Rejects with the save's error if it fails. */
  flush: () => Promise<void>;
}

/** Debounced PUT-on-change. Fires `delay`ms after the last doc change (skips the initial
 *  load, where revision === 0). Reports status transitions via `onStatus`. */
export function useAutosave(
  doc: DeckDoc | null,
  revision: number,
  onStatus: (s: SaveStatus, error?: string) => void,
  delay = 700,
): AutosaveHandle {
  const lastSaved = useRef(0);
  // Tracks the revision a save was *attempted* for (success or failure), independent of
  // `lastSaved`. Without this, a failed save leaves `lastSaved` stale forever, and since this
  // effect's dependencies (notably `onStatus`) can change identity on every render regardless
  // of `revision`, the effect would otherwise re-run and reschedule the same failed save
  // indefinitely. A failed revision is attempted once; the user's Retry button is the recovery
  // path, not an automatic retry storm.
  const lastAttempted = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The save currently in flight, so flush() can wait on it instead of issuing a duplicate PUT.
  // Resolves to the error (or null on success); never rejects.
  const inflight = useRef<{ rev: number; done: Promise<unknown> } | null>(null);
  // flush() is called from event handlers (after commit), so an effect-synced ref is current.
  const latest = useRef({ doc, revision, onStatus });
  useEffect(() => { latest.current = { doc, revision, onStatus }; });

  const start = useCallback((d: DeckDoc, rev: number, report: (s: SaveStatus, error?: string) => void) => {
    lastAttempted.current = rev;
    const done: Promise<unknown> = saveDeck(d)
      .then(() => {
        // A newer revision's own save may have started (and even settled) while this one
        // was in flight — the effect's cleanup can cancel a pending setTimeout but not an
        // in-flight fetch. If `lastAttempted` has since moved on, this response is stale:
        // touching `lastSaved`/`onStatus` here could mask the newer save's real outcome
        // (e.g. reporting "saved" while the latest edit is still unsaved or failed).
        if (rev !== lastAttempted.current) return null;
        lastSaved.current = rev;
        report("saved");
        return null;
      })
      .catch((e) => {
        if (rev === lastAttempted.current) report("error", e instanceof Error ? e.message : String(e));
        return e;
      })
      .finally(() => { if (inflight.current?.done === done) inflight.current = null; });
    inflight.current = { rev, done };
    return done;
  }, []);

  useEffect(() => {
    if (!doc || revision === 0 || revision === lastSaved.current || revision === lastAttempted.current) return;
    onStatus("saving");
    const rev = revision;
    lastAttempted.current = rev;
    timer.current = setTimeout(() => {
      timer.current = null;
      void start(doc, rev, onStatus);
    }, delay);
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, [doc, revision, onStatus, delay, start]);

  const markSaved = useCallback((rev: number) => { lastSaved.current = rev; }, []);

  const flush = useCallback(async () => {
    const { doc: d, revision: rev, onStatus: report } = latest.current;
    if (!d || rev === 0 || rev === lastSaved.current) return;
    let err: unknown;
    if (inflight.current?.rev === rev) {
      err = await inflight.current.done;
    } else {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      report("saving");
      err = await start(d, rev, report);
    }
    if (err) throw err;
  }, [start]);

  return { markSaved, flush };
}
