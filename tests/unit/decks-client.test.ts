import { afterEach, expect, test, vi } from "vitest";
import { listDecks, loadDeck } from "@/lib/api/decks-client";
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
