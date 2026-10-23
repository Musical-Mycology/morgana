"use client";
import { createContext, useCallback, useEffect, useState } from "react";
import { listMedia } from "@/lib/api/media-client";
import type { MediaInfo } from "@/lib/store/media-store";

export interface DeckMediaState { media: MediaInfo[] | null; refresh: () => Promise<void> }
export const DeckMediaContext = createContext<DeckMediaState>({ media: null, refresh: async () => {} });

/** The deck's media list for the editor page (null until loaded or if listing fails).
 *  `refresh` sets the list (null on failure) AND rejects when listing fails, so a caller can
 *  report it (MediaLibrary's "could not refresh" row); every caller must handle the rejection. */
export function useDeckMediaState(deckId: string | null): DeckMediaState {
  const [media, setMedia] = useState<MediaInfo[] | null>(null);
  const refresh = useCallback(async () => {
    if (!deckId) { setMedia(null); return; }
    try { setMedia(await listMedia(deckId)); } catch (e) { setMedia(null); throw e; }
  }, [deckId]);
  // The mount-time load has no one to tell: a failure just leaves the list null.
  useEffect(() => { refresh().catch(() => {}); }, [refresh]);
  return { media, refresh };
}
