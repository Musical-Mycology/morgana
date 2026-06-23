import type { DeckDoc, DeckMeta } from "@/engine/deck-doc";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { method: "GET", ...init });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} → ${res.status}`);
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
