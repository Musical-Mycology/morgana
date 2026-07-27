import { useCallback, useEffect, useRef } from "react";
import { saveDeck } from "@/lib/api/decks-client";
import type { DeckDoc } from "@/engine/deck-doc";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface AutosaveHandle {
  /** Records that `rev` has been persisted, so the debounce effect's guard treats it as
   *  up to date. Callers that save outside the hook (e.g. a manual retry) must call this
   *  on success or the hook will schedule a redundant PUT on its next render. */
  markSaved: (rev: number) => void;
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
  useEffect(() => {
    if (!doc || revision === 0 || revision === lastSaved.current || revision === lastAttempted.current) return;
    onStatus("saving");
    const rev = revision;
    lastAttempted.current = rev;
    timer.current = setTimeout(() => {
      saveDeck(doc)
        .then(() => {
          // A newer revision's own save may have started (and even settled) while this one
          // was in flight — the effect's cleanup can cancel a pending setTimeout but not an
          // in-flight fetch. If `lastAttempted` has since moved on, this response is stale:
          // touching `lastSaved`/`onStatus` here could mask the newer save's real outcome
          // (e.g. reporting "saved" while the latest edit is still unsaved or failed).
          if (rev !== lastAttempted.current) return;
          lastSaved.current = rev;
          onStatus("saved");
        })
        .catch((e) => {
          if (rev !== lastAttempted.current) return;
          onStatus("error", e instanceof Error ? e.message : String(e));
        });
    }, delay);
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, [doc, revision, onStatus, delay]);

  const markSaved = useCallback((rev: number) => { lastSaved.current = rev; }, []);
  return { markSaved };
}
