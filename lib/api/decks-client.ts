import type { DeckDoc, DeckMeta } from "@/engine/deck-doc";
import { withBasePath } from "@/lib/base-path";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const requestedUrl = withBasePath(url);
  const res = await fetch(requestedUrl, { method: "GET", ...init });
  if (!res.ok) {
    // The API answers failures with { error }. Losing it here is what left the editor
    // showing a bare "Save failed" with no way to tell what the server objected to.
    let detail: string | null = null;
    try { detail = ((await res.json()) as { error?: string }).error ?? null; } catch { detail = null; }
    // requestedUrl (post-withBasePath()), not the un-prefixed `url` argument —
    // under a sub-path, reporting `url` here would claim a request went to
    // /api/decks/x when it really went to /morgana/api/decks/x, which is
    // exactly the wrong thing to show someone debugging a reverse-proxy
    // sub-path deployment.
    throw new Error(detail ?? `${init?.method ?? "GET"} ${requestedUrl} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const listDecks = () => req<DeckMeta[]>("/api/decks");
export const loadDeck = (id: string) => req<DeckDoc>(`/api/decks/${id}`);
export const saveDeck = (doc: DeckDoc) =>
  req<{ ok: true }>(`/api/decks/${doc.meta.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
export const createDeck = (meta: { id: string; title: string }) =>
  req<DeckDoc>("/api/decks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(meta) });
export const deleteDeck = (id: string) =>
  req<{ ok: true }>(`/api/decks/${id}`, { method: "DELETE" });
