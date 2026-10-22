"use client";
import { useEffect, useState } from "react";
import { loadSoundtrack, type Soundtrack } from "./soundtrack";
import { mediaPath } from "@/lib/api/media-client";

export type SoundtrackState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ready"; track: Soundtrack }
  | { status: "error"; error: string };

// One decode per URL for the whole page: the editor ruler, Deck settings and the Player share it.
const cache = new Map<string, Promise<Soundtrack>>();
/** Tests only. */
export function __resetSoundtrackCache(): void { cache.clear(); }

/** Frees decoded tracks of deck `deckId` other than `keepMediaId` (each is up to ~90 MB of PCM):
 *  called by the editor when a soundtrack is replaced or removed. Other decks' entries are untouched. */
export function releaseSoundtracksExcept(deckId: string, keepMediaId: string | undefined): void {
  const prefix = mediaPath(deckId, "");
  const keep = keepMediaId ? mediaPath(deckId, keepMediaId) : null;
  for (const [url, p] of [...cache]) {
    if (!url.startsWith(prefix) || url === keep) continue;
    cache.delete(url);
    p.then((t) => t.dispose(), () => {});
  }
}

/** Decodes deck `deckId`'s soundtrack once per URL for the page (module cache shared by the editor
 *  ruler, Deck settings and the Player). `load` is injectable for tests. The URL handed to `load`
 *  is the UNPREFIXED app path (`mediaPath`): `loadSoundtrack` applies the basePath itself. A failed
 *  load is dropped from the cache so a later mount can retry. */
export function useSoundtrack(deckId: string | null, mediaId: string | undefined, load: (url: string) => Promise<Soundtrack> = loadSoundtrack): SoundtrackState {
  const url = deckId && mediaId ? mediaPath(deckId, mediaId) : null;
  const [state, setState] = useState<SoundtrackState>(url ? { status: "loading" } : { status: "none" });
  useEffect(() => {
    if (!url) { setState({ status: "none" }); return; }
    let live = true;
    setState({ status: "loading" });
    let p = cache.get(url);
    if (!p) {
      p = load(url);
      cache.set(url, p);
      p.catch(() => { if (cache.get(url) === p) cache.delete(url); });
    }
    p.then((track) => { if (live) setState({ status: "ready", track }); },
           (e: unknown) => { if (live) setState({ status: "error", error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
    // Keyed on the URL only: the decode is cached per URL, so a caller passing a fresh `load`
    // function each render (an inline arrow) must not restart the effect — that loops forever
    // (effect → setState("loading") → render → new `load` → effect …).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return state;
}
