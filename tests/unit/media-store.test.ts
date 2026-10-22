// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveMedia, listMedia, readMedia, deleteMedia, deleteDeckMedia, MediaError, MEDIA_ID_RE } from "@/lib/store/media-store";
import { createDeck, deleteDeck } from "@/lib/store/deck-store";

// Fault injection for an interrupted deleteMedia: when `unlinkBudget` is a number, only that many
// more unlink calls succeed; later ones throw (as if the process died / the fs refused mid-delete).
const fault = vi.hoisted(() => ({ unlinkBudget: null as number | null }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    unlink: (async (p: Parameters<typeof real.unlink>[0]) => {
      if (fault.unlinkBudget !== null) {
        if (fault.unlinkBudget <= 0) throw Object.assign(new Error("EIO: injected"), { code: "EIO" });
        fault.unlinkBudget--;
      }
      return real.unlink(p);
    }) as typeof real.unlink,
  };
});
afterEach(() => { fault.unlinkBudget = null; });

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

const VALID_ID = "0123456789abcdef.mp3";

/** A readable secret that the crafted ids would reach if the guards were gone: media/d1/../secret = media/secret. */
async function plantSecret(): Promise<void> {
  await saveMedia("d1", { name: "a.mp3", bytes: bytes("real") }); // creates media/d1/ so only the plant is outside it
  writeFileSync(join(dir, "media", "secret"), "SECRET");
  writeFileSync(join(dir, "media", "secret.json"), JSON.stringify({ id: "secret", name: "s", mime: "text/plain", bytes: 6, uploadedAt: "2026-01-01T00:00:00.000Z" }));
}

test.each(["../secret", "..%2Fsecret", "/etc/passwd", "0123456789abcdef.mp3/../../secret", "UPPERCASE0000000.mp3"])(
  "rejects crafted media id %s with 404 and reads nothing", async (id) => {
    await plantSecret();
    await expect(readMedia("d1", id)).rejects.toBeInstanceOf(MediaError);
    await expect(readMedia("d1", id)).rejects.toMatchObject({ status: 404 });
  });

test("deleteMedia rejects a traversal id and leaves the planted file in place", async () => {
  await plantSecret();
  await expect(deleteMedia("d1", "../secret")).rejects.toMatchObject({ status: 404 });
  expect(existsSync(join(dir, "media", "secret"))).toBe(true);
  expect(existsSync(join(dir, "media", "secret.json"))).toBe(true);
});

test.each(["", ".", "..", "../decks"])("deck id %j is rejected with 404 by every entry point", async (deckId) => {
  await expect(listMedia(deckId)).rejects.toMatchObject({ status: 404 });
  await expect(readMedia(deckId, VALID_ID)).rejects.toMatchObject({ status: 404 });
  await expect(deleteMedia(deckId, VALID_ID)).rejects.toMatchObject({ status: 404 });
  await expect(deleteDeckMedia(deckId)).rejects.toMatchObject({ status: 404 });
});

test("deleteDeckMedia with a bad deck id leaves media/ and another deck's folder intact", async () => {
  await saveMedia("d1", { name: "a.mp3", bytes: bytes("one") });
  await saveMedia("d2", { name: "b.mp3", bytes: bytes("two") });
  for (const deckId of ["", ".", "..", "../decks"]) {
    await expect(deleteDeckMedia(deckId)).rejects.toMatchObject({ status: 404 });
  }
  expect(existsSync(join(dir, "media"))).toBe(true);
  expect(await listMedia("d1")).toHaveLength(1);
  expect(await listMedia("d2")).toHaveLength(1);
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

test("after deleteMedia, re-uploading the same bytes is readable — even if the delete was interrupted", async () => {
  const info = await saveMedia("d1", { name: "a.mp3", bytes: bytes("song") });
  await deleteMedia("d1", info.id);
  const again = await saveMedia("d1", { name: "a.mp3", bytes: bytes("song") });
  expect(again.id).toBe(info.id);
  expect(new TextDecoder().decode((await readMedia("d1", info.id)).bytes)).toBe("song");

  // Only the first unlink succeeds. Sidecar-first leaves an orphan blob (harmless, healed by the
  // re-upload); bytes-first would leave an orphan sidecar that makes the re-upload skip the bytes.
  fault.unlinkBudget = 1;
  await deleteMedia("d1", info.id);
  fault.unlinkBudget = null;
  expect(await listMedia("d1")).toEqual([]);
  await saveMedia("d1", { name: "a.mp3", bytes: bytes("song") });
  expect(new TextDecoder().decode((await readMedia("d1", info.id)).bytes)).toBe("song");
});

test("deleting a deck deletes its media folder", async () => {
  await createDeck({ id: "d2", title: "D2" });
  await saveMedia("d2", { name: "a.flac", bytes: bytes("x") });
  expect(existsSync(join(dir, "media", "d2"))).toBe(true);
  await deleteDeck("d2");
  expect(existsSync(join(dir, "media", "d2"))).toBe(false);
  await deleteDeckMedia("never-had-media"); // no throw
});
