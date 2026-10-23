// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeck, loadDeck, saveDeck } from "@/lib/store/deck-store";
import { callTool, ToolCallError } from "@/lib/mcp/tool-handlers";
import { saveMedia } from "@/lib/store/media-store";
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

test("move_scene_by reorders scenes", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await callTool("append_scene", { deck_id: "demo" });
  await callTool("append_scene", { deck_id: "demo" });
  const before = (await loadDeck("demo")).scenes.map((s) => s.id);
  const after = await callTool("move_scene_by", { deck_id: "demo", scene_index: 0, dir: 1 }) as DeckDoc;
  expect(after.scenes.map((s) => s.id)).toEqual([before[1], before[0]]);
});

test("append_beat_to_scene fills a scene emptied by delete_beat_at", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await callTool("append_scene", { deck_id: "demo" });
  await callTool("delete_beat_at", { deck_id: "demo", beat_index: 0 });
  expect((await loadDeck("demo")).scenes[0].beats).toEqual([]);
  const filled = await callTool("append_beat_to_scene", { deck_id: "demo", scene_index: 0 }) as DeckDoc;
  expect(filled.scenes[0].beats).toHaveLength(1);
});

test("delete_scene_at addresses an empty scene by scene_index", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await callTool("append_scene", { deck_id: "demo" });
  await callTool("delete_beat_at", { deck_id: "demo", beat_index: 0 });
  const after = await callTool("delete_scene_at", { deck_id: "demo", scene_index: 0 }) as DeckDoc;
  expect(after.scenes).toEqual([]);
});

test("delete_scene_at rejects both or neither index", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await callTool("append_scene", { deck_id: "demo" });
  await expect(callTool("delete_scene_at", { deck_id: "demo" })).rejects.toThrow(ToolCallError);
  await expect(callTool("delete_scene_at", { deck_id: "demo", beat_index: 0, scene_index: 0 })).rejects.toThrow(ToolCallError);
});

async function timedFixture(): Promise<void> {
  await createDeck({ id: "demo", title: "Demo" });
  const doc = await loadDeck("demo");
  await saveDeck({ ...doc, meta: { ...doc.meta, timing: { targetSec: 10 } },
    scenes: [{ id: "s", durationSec: 0.5, beats: [{ id: "a", timeline: [{ kind: "wait", ms: 1000 }] }] }] });
}

test("set_scene_duration pins and clears a scene length", async () => {
  await timedFixture();
  await callTool("set_scene_duration", { deck_id: "demo", scene_index: 0, seconds: 15 });
  expect((await loadDeck("demo")).scenes[0].durationSec).toBe(15);
  await callTool("set_scene_duration", { deck_id: "demo", scene_index: 0, seconds: null });
  expect((await loadDeck("demo")).scenes[0].durationSec).toBeUndefined();
});

test("set_scene_duration rejects a non-positive length", async () => {
  await timedFixture();
  await expect(callTool("set_scene_duration", { deck_id: "demo", scene_index: 0, seconds: 0 })).rejects.toThrow(/durationSec/);
});

test("read_deck_timing returns layout, target, and overruns", async () => {
  await timedFixture();
  const r = await callTool("read_deck_timing", { deck_id: "demo" }) as { targetSec: number | null; total: number; scenes: { id: string; overrunSec: number; beats: { id: string }[] }[] };
  expect(r.targetSec).toBe(10);
  expect(r.total).toBeCloseTo(0.5);
  expect(r.scenes[0]).toMatchObject({ id: "s", overrunSec: 0.5, beats: [{ id: "a" }] });
});

test("list_media entries carry kind and stored durationSec", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  const audio = await saveMedia("demo", { name: "mix.mp3", bytes: new TextEncoder().encode("ID3x"), durationSec: 12.5 });
  const png = await saveMedia("demo", { name: "p.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) });
  const { media } = (await callTool("list_media", { deck_id: "demo" })) as { media: Array<{ id: string; kind: string | null; durationSec?: number }> };
  expect(media.find((m) => m.id === audio.id)).toMatchObject({ kind: "audio", durationSec: 12.5 });
  expect(media.find((m) => m.id === png.id)).toMatchObject({ kind: "image" });
  expect(media.find((m) => m.id === png.id)?.durationSec).toBeUndefined();
});

test("update_meta with path timing and value null makes the deck untimed", async () => {
  await timedFixture();
  await callTool("update_meta", { deck_id: "demo", path: "timing", value: null });
  expect((await loadDeck("demo")).meta.timing).toBeUndefined();
});

test("list_media, set_soundtrack and set_markers", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  const info = await saveMedia("demo", { name: "mix.mp3", bytes: new TextEncoder().encode("ID3x") });
  expect(await callTool("list_media", { deck_id: "demo" })).toEqual({ media: [{ ...info, kind: "audio" }] });
  await callTool("set_soundtrack", { deck_id: "demo", media_id: info.id });
  expect((await loadDeck("demo")).meta.soundtrack).toEqual({ media: info.id });
  await expect(callTool("set_soundtrack", { deck_id: "demo", media_id: "ffffffffffffffff.mp3" })).rejects.toThrow(/not in this deck's media/);
  await callTool("set_soundtrack", { deck_id: "demo", media_id: null });
  expect((await loadDeck("demo")).meta.soundtrack).toBeUndefined();
  await callTool("set_markers", { deck_id: "demo", markers: [{ id: "m1", label: "drop", t: 40.2 }] });
  expect((await loadDeck("demo")).meta.markers).toEqual([{ id: "m1", label: "drop", t: 40.2 }]);
  await expect(callTool("set_markers", { deck_id: "demo", markers: [{ id: "m1", label: "", t: 1 }] })).rejects.toThrow(/label/);
  await callTool("set_markers", { deck_id: "demo", markers: [] });
  expect((await loadDeck("demo")).meta.markers).toBeUndefined();
});

test("set_markers persists only { id, label, t } and trims labels (whitespace-only is rejected)", async () => {
  await createDeck({ id: "demo", title: "Demo" });
  await callTool("set_markers", { deck_id: "demo", markers: [{ id: "m1", label: "  drop  ", t: 40.2, color: "red", extra: { x: 1 } }] });
  expect((await loadDeck("demo")).meta.markers).toEqual([{ id: "m1", label: "drop", t: 40.2 }]);
  await expect(callTool("set_markers", { deck_id: "demo", markers: [{ id: "m2", label: "   ", t: 1 }] })).rejects.toThrow(/label/);
  expect((await loadDeck("demo")).meta.markers).toEqual([{ id: "m1", label: "drop", t: 40.2 }]);
});
