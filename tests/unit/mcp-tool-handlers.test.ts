// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeck, loadDeck } from "@/lib/store/deck-store";
import { callTool, ToolCallError } from "@/lib/mcp/tool-handlers";
import type { DeckDoc } from "@/engine/deck-doc";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "morgana-")); process.env.MORGANA_DATA_DIR = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MORGANA_DATA_DIR; });

test("list_decks returns deck metadata", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  const result = await callTool("list_decks", {}) as { decks: { id: string }[] };
  expect(result.decks.map((d) => d.id)).toEqual(["demo"]);
});

test("read_deck returns the full document", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  const doc = await callTool("read_deck", { deck_id: "demo" }) as DeckDoc;
  expect(doc.meta.title).toBe("Demo");
});

test("append_scene and delete_scene_at mutate and persist via the real store", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  const afterAppend = await callTool("append_scene", { deck_id: "demo" }) as DeckDoc;
  expect(afterAppend.scenes.length).toBe(1);
  expect((await loadDeck("demo")).scenes.length).toBe(1);

  const afterDelete = await callTool("delete_scene_at", { deck_id: "demo", beat_index: 0 }) as DeckDoc;
  expect(afterDelete.scenes.length).toBe(0);
});

test("insert_action_after, update_action, and convert_action_kind round-trip", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await callTool("append_scene", { deck_id: "demo" });
  await callTool("insert_action_after", { deck_id: "demo", beat_index: 0, action_index: null, kind: "wait" });

  const updated = await callTool("update_action", { deck_id: "demo", beat_index: 0, action_index: 1, path: "ms", value: 900 }) as DeckDoc;
  expect(updated.scenes[0].beats[0].timeline[1]).toMatchObject({ kind: "wait", ms: 900 });

  const converted = await callTool("convert_action_kind", { deck_id: "demo", beat_index: 0, action_index: 1, new_kind: "clear" }) as DeckDoc;
  expect(converted.scenes[0].beats[0].timeline[1]).toEqual({ kind: "clear" });
});

test("update_meta sets a nested field", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  const doc = await callTool("update_meta", { deck_id: "demo", path: "chrome.wordmark", value: "Acme" }) as DeckDoc;
  expect(doc.meta.chrome?.wordmark).toBe("Acme");
});

test("missing required args raise a ToolCallError, not a generic throw", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await expect(callTool("insert_beat_after", { deck_id: "demo" })).rejects.toThrow(ToolCallError);
});

test("an unknown tool name raises a ToolCallError", async () => {
  await expect(callTool("not_a_real_tool", {})).rejects.toThrow(ToolCallError);
});

test("a mutation that would invalidate the deck is rejected before saving", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await expect(callTool("update_meta", { deck_id: "demo", path: "id", value: "BAD ID" })).rejects.toThrow(ToolCallError);
  expect((await loadDeck("demo")).meta.id).toBe("demo");
});

test("update_action rejects path 'kind' — use convert_action_kind instead", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await callTool("append_scene", { deck_id: "demo" });
  await callTool("insert_action_after", { deck_id: "demo", beat_index: 0, action_index: null, kind: "wait" });

  await expect(
    callTool("update_action", { deck_id: "demo", beat_index: 0, action_index: 1, path: "kind", value: "text" })
  ).rejects.toThrow(ToolCallError);
  expect((await loadDeck("demo")).scenes[0].beats[0].timeline[1]).toMatchObject({ kind: "wait" });
});

test("update_action rejects a path containing __proto__", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await callTool("append_scene", { deck_id: "demo" });
  await callTool("insert_action_after", { deck_id: "demo", beat_index: 0, action_index: null, kind: "wait" });

  await expect(
    callTool("update_action", { deck_id: "demo", beat_index: 0, action_index: 1, path: "__proto__.polluted", value: "x" })
  ).rejects.toThrow(ToolCallError);
  expect((await loadDeck("demo")).scenes[0].beats[0].timeline[1]).toEqual({ kind: "wait", ms: 500 });
});

test("update_meta rejects a path containing __proto__", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await expect(
    callTool("update_meta", { deck_id: "demo", path: "__proto__.polluted", value: "x" })
  ).rejects.toThrow(ToolCallError);
  expect((await loadDeck("demo")).meta.id).toBe("demo");
});

test("insert_beat_after, duplicate_beat_at, delete_beat_at, and move_beat_by mutate and persist", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await callTool("append_scene", { deck_id: "demo" });

  const afterInsert = await callTool("insert_beat_after", { deck_id: "demo", beat_index: 0 }) as DeckDoc;
  expect(afterInsert.scenes[0].beats.length).toBe(2);

  const afterDuplicate = await callTool("duplicate_beat_at", { deck_id: "demo", beat_index: 0 }) as DeckDoc;
  expect(afterDuplicate.scenes[0].beats.length).toBe(3);

  const idsBeforeMove = afterDuplicate.scenes[0].beats.map((b) => b.id);
  const afterMove = await callTool("move_beat_by", { deck_id: "demo", beat_index: 0, dir: 1 }) as DeckDoc;
  expect(afterMove.scenes[0].beats.map((b) => b.id)).toEqual([idsBeforeMove[1], idsBeforeMove[0], idsBeforeMove[2]]);

  const afterDelete = await callTool("delete_beat_at", { deck_id: "demo", beat_index: 0 }) as DeckDoc;
  expect(afterDelete.scenes[0].beats.length).toBe(2);
  expect((await loadDeck("demo")).scenes[0].beats.length).toBe(2);
});

test("duplicate_action_at, move_action_by, and delete_action_at mutate and persist", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await callTool("append_scene", { deck_id: "demo" });
  await callTool("insert_action_after", { deck_id: "demo", beat_index: 0, action_index: null, kind: "wait" });

  const afterDuplicate = await callTool("duplicate_action_at", { deck_id: "demo", beat_index: 0, action_index: 1 }) as DeckDoc;
  expect(afterDuplicate.scenes[0].beats[0].timeline.length).toBe(3);
  expect(afterDuplicate.scenes[0].beats[0].timeline[2]).toMatchObject({ kind: "wait" });

  const afterMove = await callTool("move_action_by", { deck_id: "demo", beat_index: 0, action_index: 1, dir: 1 }) as DeckDoc;
  expect(afterMove.scenes[0].beats[0].timeline[1]).toMatchObject({ kind: "wait" });
  expect(afterMove.scenes[0].beats[0].timeline[2]).toMatchObject({ kind: "wait" });

  const afterDelete = await callTool("delete_action_at", { deck_id: "demo", beat_index: 0, action_index: 2 }) as DeckDoc;
  expect(afterDelete.scenes[0].beats[0].timeline.length).toBe(2);
  expect((await loadDeck("demo")).scenes[0].beats[0].timeline.length).toBe(2);
});
