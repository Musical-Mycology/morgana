// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as store from "@/lib/store/deck-store";
import type { DeckDoc } from "@/engine/deck-doc";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "morgana-")); process.env.MORGANA_DATA_DIR = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MORGANA_DATA_DIR; });

const doc: DeckDoc = { version: 1, meta: { id: "demo", title: "Demo" }, scenes: [] };

test("save → load → list → delete round-trips", async () => {
  await store.saveDeck(doc);
  expect((await store.loadDeck("demo")).meta.title).toBe("Demo");
  expect((await store.listDecks()).map((m) => m.id)).toEqual(["demo"]);
  await store.deleteDeck("demo");
  expect(await store.listDecks()).toEqual([]);
});

test("rejects path-traversal ids", async () => {
  await expect(store.loadDeck("../etc/passwd")).rejects.toThrow();
  await expect(store.saveDeck({ ...doc, meta: { id: "../x", title: "x" } })).rejects.toThrow();
});

test("createDeck writes an empty deck and refuses duplicates", async () => {
  const created = await store.createDeck({ id: "fresh", title: "Fresh" });
  expect(created.scenes).toEqual([]);
  await expect(store.createDeck({ id: "fresh", title: "Dup" })).rejects.toThrow();
});

test("statDeck reports the file's mtime and updates it on save", async () => {
  await store.saveDeck(doc);
  const first = await store.statDeck("demo");
  expect(typeof first.mtimeMs).toBe("number");
  await new Promise((r) => setTimeout(r, 5));
  await store.saveDeck({ ...doc, meta: { ...doc.meta, title: "Demo 2" } });
  const second = await store.statDeck("demo");
  expect(second.mtimeMs).toBeGreaterThan(first.mtimeMs);
});
