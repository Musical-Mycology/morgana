import { afterEach, expect, test, vi } from "vitest";
import { listDecks, loadDeck, saveDeck } from "@/lib/api/decks-client";
import type { DeckDoc } from "@/engine/deck-doc";

afterEach(() => vi.unstubAllGlobals());
function stubFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
}
test("listDecks GETs /api/decks", async () => {
  stubFetch(200, [{ id: "demo", title: "Demo" }]);
  expect(await listDecks()).toEqual([{ id: "demo", title: "Demo" }]);
  expect(fetch).toHaveBeenCalledWith("/api/decks", expect.objectContaining({ method: "GET" }));
});
test("loadDeck GETs /api/decks/:id; throws on 404", async () => {
  const doc: DeckDoc = { version: 1, meta: { id: "demo", title: "Demo" }, scenes: [] };
  stubFetch(200, doc); expect((await loadDeck("demo")).meta.id).toBe("demo");
  stubFetch(404, { error: "x" }); await expect(loadDeck("missing")).rejects.toThrow();
});
test("a failed request throws the server's error message, not just the status", async () => {
  const doc: DeckDoc = { version: 1, meta: { id: "demo", title: "Demo" }, scenes: [] };
  stubFetch(400, { error: "scenes[0].id required" });
  await expect(saveDeck(doc)).rejects.toThrow("scenes[0].id required");
});
test("a failed request with no usable body falls back to the status line", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 500 })));
  const doc: DeckDoc = { version: 1, meta: { id: "demo", title: "Demo" }, scenes: [] };
  await expect(saveDeck(doc)).rejects.toThrow("500");
});
