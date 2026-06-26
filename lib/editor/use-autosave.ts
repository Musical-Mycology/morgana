import { useEffect, useRef } from "react";
import { saveDeck } from "@/lib/api/decks-client";
import type { DeckDoc } from "@/engine/deck-doc";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Debounced PUT-on-change. Fires `delay`ms after the last doc change (skips the initial
 *  load, where revision === 0). Reports status transitions via `onStatus`. */
export function useAutosave(
  doc: DeckDoc | null,
  revision: number,
  onStatus: (s: SaveStatus) => void,
  delay = 700,
): void {
  const lastSaved = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!doc || revision === 0 || revision === lastSaved.current) return;
    onStatus("saving");
    const rev = revision;
    timer.current = setTimeout(() => {
      saveDeck(doc)
        .then(() => { lastSaved.current = rev; onStatus("saved"); })
        .catch(() => onStatus("error"));
    }, delay);
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, [doc, revision, onStatus, delay]);
}
