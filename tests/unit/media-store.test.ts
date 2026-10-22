// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveMedia, listMedia, readMedia, deleteMedia, deleteDeckMedia, MediaError, MEDIA_ID_RE } from "@/lib/store/media-store";
import { createDeck, deleteDeck } from "@/lib/store/deck-store";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "morgana-")); process.env.MORGANA_DATA_DIR = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MORGANA_DATA_DIR; delete process.env.MORGANA_MEDIA_MAX_MB; });

const bytes = (s: string) => new TextEncoder().encode(s);

test("save → list → read round-trip with a content-hash id and extension-derived mime", async () => {
  const info = await saveMedia("d1", { name: "Mix Final.MP3", bytes: bytes("abc") });
  expect(info.id).toMatch(MEDIA_ID_RE);
  expect(info.id.endsWith(".mp3")).toBe(true);
  expect(info).toMatchObject({ name: "Mix Final.MP3", mime: "audio/mpeg", bytes: 3 });
  expect((await listMedia("d1")).map((m) => m.id)).toEqual([info.id]);
  const read = await readMedia("d1", info.id);
  expect(new TextDecoder().decode(read.bytes)).toBe("abc");
  expect(read.info.id).toBe(info.id);
});

test("the same bytes upload once (same id, one listing entry)", async () => {
  const a = await saveMedia("d1", { name: "a.wav", bytes: bytes("same") });
  const b = await saveMedia("d1", { name: "renamed.wav", bytes: bytes("same") });
  expect(b.id).toBe(a.id);
  expect(await listMedia("d1")).toHaveLength(1);
});

test.each(["virus.exe", "noext", "song.MP3X", ".mp3"])("rejects unsupported file %s with 400", async (name) => {
  await expect(saveMedia("d1", { name, bytes: bytes("x") })).rejects.toMatchObject({ status: 400 });
});

test("enforces the size cap from MORGANA_MEDIA_MAX_MB with 413", async () => {
  process.env.MORGANA_MEDIA_MAX_MB = "0.000001"; // ~1 byte
  await expect(saveMedia("d1", { name: "a.mp3", bytes: bytes("too big") })).rejects.toMatchObject({ status: 413 });
});

test.each(["../x", "..%2Fx", "/etc/passwd", "0123456789abcdef.mp3/../../x", "UPPERCASE0000000.mp3"])(
  "rejects crafted media id %s with 404 and reads nothing", async (id) => {
    mkdirSync(join(dir, "decks"), { recursive: true });
    writeFileSync(join(dir, "decks", "x.deck.json"), "secret");
    await expect(readMedia("d1", id)).rejects.toBeInstanceOf(MediaError);
    await expect(readMedia("d1", id)).rejects.toMatchObject({ status: 404 });
  });

test("rejects an invalid deck id", async () => {
  await expect(saveMedia("../evil", { name: "a.mp3", bytes: bytes("x") })).rejects.toMatchObject({ status: 404 });
});

test("delete removes the file and its sidecar; listing an empty deck is []", async () => {
  const info = await saveMedia("d1", { name: "a.ogg", bytes: bytes("x") });
  await deleteMedia("d1", info.id);
  expect(await listMedia("d1")).toEqual([]);
  expect(await listMedia("nothing-here")).toEqual([]);
  await expect(readMedia("d1", info.id)).rejects.toMatchObject({ status: 404 });
});

test("deleting a deck deletes its media folder", async () => {
  await createDeck({ id: "d2", title: "D2" });
  await saveMedia("d2", { name: "a.flac", bytes: bytes("x") });
  expect(existsSync(join(dir, "media", "d2"))).toBe(true);
  await deleteDeck("d2");
  expect(existsSync(join(dir, "media", "d2"))).toBe(false);
  await deleteDeckMedia("never-had-media"); // no throw
});
