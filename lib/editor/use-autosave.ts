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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!doc || revision === 0 || revision === lastSaved.current) return;
    onStatus("saving");
    const rev = revision;
    timer.current = setTimeout(() => {
      saveDeck(doc)
        .then(() => { lastSaved.current = rev; onStatus("saved"); })
        .catch((e) => onStatus("error", e instanceof Error ? e.message : String(e)));
    }, delay);
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, [doc, revision, onStatus, delay]);

  const markSaved = useCallback((rev: number) => { lastSaved.current = rev; }, []);
  return { markSaved };
}
