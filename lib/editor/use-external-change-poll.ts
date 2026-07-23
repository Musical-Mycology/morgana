import { useCallback, useEffect, useRef, useState } from "react";

export interface ExternalChangeState {
  changed: boolean;
  dismiss: () => void;
  resync: () => void;
}

/** Polls a deck's on-disk mtime and flags when it moves without going through `resync()` —
 *  i.e., something other than this tab's own autosave wrote the file (an MCP-driven edit).
 *  Never reloads on its own; the caller decides what "changed" means (e.g. a reload prompt). */
export function useExternalChangePoll(deckId: string | null, intervalMs = 4000): ExternalChangeState {
  const [changed, setChanged] = useState(false);
  const knownMtime = useRef<number | null>(null);
  const resyncing = useRef(false);

  const fetchMtime = useCallback(async (): Promise<number | null> => {
    if (!deckId) return null;
    try {
      const res = await fetch(`/api/decks/${deckId}/meta`);
      if (!res.ok) return null;
      return (await res.json()).mtimeMs as number;
    } catch {
      return null;
    }
  }, [deckId]);

  const resync = useCallback(() => {
    resyncing.current = true;
    fetchMtime().then((mtimeMs) => {
      if (mtimeMs != null) knownMtime.current = mtimeMs;
      setChanged(false);
      resyncing.current = false;
    });
  }, [fetchMtime]);

  useEffect(() => {
    knownMtime.current = null;
    setChanged(false);
  }, [deckId]);

  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    const tick = async () => {
      if (resyncing.current) return;
      const mtimeMs = await fetchMtime();
      if (mtimeMs == null || cancelled) return;
      if (knownMtime.current == null) knownMtime.current = mtimeMs;
      else if (mtimeMs !== knownMtime.current) setChanged(true);
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [deckId, intervalMs, fetchMtime]);

  return { changed, dismiss: () => setChanged(false), resync };
}
