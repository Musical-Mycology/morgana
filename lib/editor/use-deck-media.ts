"use client";
import { createContext, useCallback, useEffect, useState } from "react";
import { listMedia } from "@/lib/api/media-client";
import type { MediaInfo } from "@/lib/store/media-store";

export interface DeckMediaState { media: MediaInfo[] | null; refresh: () => Promise<void> }
export const DeckMediaContext = createContext<DeckMediaState>({ media: null, refresh: async () => {} });

/** The deck's media list for the editor page (null until loaded or if listing fails). */
export function useDeckMediaState(deckId: string | null): DeckMediaState {
  const [media, setMedia] = useState<MediaInfo[] | null>(null);
  const refresh = useCallback(async () => {
    if (!deckId) { setMedia(null); return; }
    try { setMedia(await listMedia(deckId)); } catch { setMedia(null); }
  }, [deckId]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { media, refresh };
}
