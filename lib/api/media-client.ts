import { withBasePath } from "@/lib/base-path";
import type { MediaInfo } from "@/lib/store/media-store";

// App-absolute path WITHOUT the base path: loadSoundtrack() applies withBasePath() itself.
// DOM consumers must use mediaUrl().
export function mediaPath(deckId: string, mediaId: string): string {
  return `/api/decks/${deckId}/media/${mediaId}`;
}

/** Base-path-prefixed URL, for anything that hands the URL straight to the DOM. */
export function mediaUrl(deckId: string, mediaId: string): string {
  return withBasePath(mediaPath(deckId, mediaId));
}

export async function uploadMedia(deckId: string, file: File, durationSec?: number): Promise<MediaInfo> {
  const body = new FormData();
  body.append("file", file);
  if (durationSec !== undefined && Number.isFinite(durationSec) && durationSec > 0) body.append("durationSec", String(durationSec));
  const res = await fetch(withBasePath(`/api/decks/${deckId}/media`), { method: "POST", body });
  if (!res.ok) {
    const msg = await res.json().then((j: { error?: string }) => j.error, () => undefined);
    throw new Error(msg ?? `upload failed (${res.status})`);
  }
  return res.json();
}

export async function listMedia(deckId: string): Promise<MediaInfo[]> {
  const res = await fetch(withBasePath(`/api/decks/${deckId}/media`));
  if (!res.ok) throw new Error(`could not list media (${res.status})`);
  return ((await res.json()) as { media: MediaInfo[] }).media;
}

export async function deleteMedia(deckId: string, mediaId: string): Promise<void> {
  const res = await fetch(withBasePath(mediaPath(deckId, mediaId)), { method: "DELETE" });
  if (!res.ok) {
    const msg = await res.json().then((j: { error?: string }) => j.error, () => undefined);
    throw new Error(msg ?? `delete failed (${res.status})`);
  }
}
