// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveMedia, listMedia, readMedia, deleteMedia, deleteDeckMedia, MediaError, MEDIA_ID_RE, mediaKind } from "@/lib/store/media-store";
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
/** Audio test bytes carry a real magic prefix so they pass the content sniffer. */
const MAGIC: Record<string, string> = { mp3: "ID3", wav: "RIFF\0\0\0\0WAVE", ogg: "OggS", flac: "fLaC" };
const audio = (ext: string, s: string) => bytes(MAGIC[ext] + s);

test("save → list → read round-trip with a content-hash id and extension-derived mime", async () => {
  const info = await saveMedia("d1", { name: "Mix Final.MP3", bytes: audio("mp3", "abc") });
  expect(info.id).toMatch(MEDIA_ID_RE);
  expect(info.id.endsWith(".mp3")).toBe(true);
  expect(info).toMatchObject({ name: "Mix Final.MP3", mime: "audio/mpeg", bytes: 6 });
  expect((await listMedia("d1")).map((m) => m.id)).toEqual([info.id]);
  const read = await readMedia("d1", info.id);
  expect(new TextDecoder().decode(read.bytes)).toBe("ID3abc");
  expect(read.info.id).toBe(info.id);
});

test("the same bytes upload once (same id, one listing entry)", async () => {
  const a = await saveMedia("d1", { name: "a.wav", bytes: audio("wav", "same") });
  const b = await saveMedia("d1", { name: "renamed.wav", bytes: audio("wav", "same") });
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
  await saveMedia("d1", { name: "a.mp3", bytes: audio("mp3", "real") }); // creates media/d1/ so only the plant is outside it
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
  await saveMedia("d1", { name: "a.mp3", bytes: audio("mp3", "one") });
  await saveMedia("d2", { name: "b.mp3", bytes: audio("mp3", "two") });
  for (const deckId of ["", ".", "..", "../decks"]) {
    await expect(deleteDeckMedia(deckId)).rejects.toMatchObject({ status: 404 });
  }
  expect(existsSync(join(dir, "media"))).toBe(true);
  expect(await listMedia("d1")).toHaveLength(1);
  expect(await listMedia("d2")).toHaveLength(1);
});

test("rejects an invalid deck id", async () => {
  await expect(saveMedia("../evil", { name: "a.mp3", bytes: audio("mp3", "x") })).rejects.toMatchObject({ status: 404 });
});

test("delete removes the file and its sidecar; listing an empty deck is []", async () => {
  const info = await saveMedia("d1", { name: "a.ogg", bytes: audio("ogg", "x") });
  await deleteMedia("d1", info.id);
  expect(await listMedia("d1")).toEqual([]);
  expect(await listMedia("nothing-here")).toEqual([]);
  await expect(readMedia("d1", info.id)).rejects.toMatchObject({ status: 404 });
});

test("after deleteMedia, re-uploading the same bytes is readable — even if the delete was interrupted", async () => {
  const info = await saveMedia("d1", { name: "a.mp3", bytes: audio("mp3", "song") });
  await deleteMedia("d1", info.id);
  const again = await saveMedia("d1", { name: "a.mp3", bytes: audio("mp3", "song") });
  expect(again.id).toBe(info.id);
  expect(new TextDecoder().decode((await readMedia("d1", info.id)).bytes)).toBe("ID3song");

  // Only the first unlink succeeds. Sidecar-first leaves an orphan blob (harmless, healed by the
  // re-upload); bytes-first would leave an orphan sidecar that makes the re-upload skip the bytes.
  fault.unlinkBudget = 1;
  await deleteMedia("d1", info.id);
  fault.unlinkBudget = null;
  expect(await listMedia("d1")).toEqual([]);
  await saveMedia("d1", { name: "a.mp3", bytes: audio("mp3", "song") });
  expect(new TextDecoder().decode((await readMedia("d1", info.id)).bytes)).toBe("ID3song");
});

test("deleting a deck deletes its media folder", async () => {
  await createDeck({ id: "d2", title: "D2" });
  await saveMedia("d2", { name: "a.flac", bytes: audio("flac", "x") });
  expect(existsSync(join(dir, "media", "d2"))).toBe(true);
  await deleteDeck("d2");
  expect(existsSync(join(dir, "media", "d2"))).toBe(false);
  await deleteDeckMedia("never-had-media"); // no throw
});

// ---- images + video: content-checked, duration recorded (spec §1) ----
const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, "../../e2e/fixtures/media", n)));

test("a video upload gets a lowercase .mp4 id and video/mp4 mime (uppercase extension accepted)", async () => {
  const info = await saveMedia("d1", { name: "Clip.MP4", bytes: fx("clip-h264.mp4") });
  expect(info.id).toMatch(MEDIA_ID_RE);
  expect(info.id.endsWith(".mp4")).toBe(true);
  expect(info.mime).toBe("video/mp4");
});

test("images are accepted with their mime", async () => {
  expect(await saveMedia("d1", { name: "S.PNG", bytes: fx("still.png") })).toMatchObject({ mime: "image/png" });
});

test("an HEVC mp4 is rejected 400 with the exact ffmpeg-fix message", async () => {
  const err = await saveMedia("d1", { name: "x.mp4", bytes: fx("clip-hevc.mp4") }).catch((e) => e);
  expect(err).toBeInstanceOf(MediaError);
  expect(err.status).toBe(400);
  expect(err.message).toBe("unsupported video codec (hvc1) — convert with: ffmpeg -i 'x.mp4' -c:v libx264 -crf 18 -pix_fmt yuv420p -an out.mp4");
  expect(await listMedia("d1")).toEqual([]);
});

test("the ffmpeg fix single-quotes the file name, so pasting it never runs shell syntax (final review M4)", async () => {
  const name = `it's "$(touch pwned)" \`id\`.mp4`;
  const err = await saveMedia("d1", { name, bytes: fx("clip-hevc.mp4") }).catch((e) => e);
  expect(err.message).toBe(`unsupported video codec (hvc1) — convert with: ffmpeg -i 'it'\\''s "$(touch pwned)" \`id\`.mp4' -c:v libx264 -crf 18 -pix_fmt yuv420p -an out.mp4`);
});

test("bytes that do not match the extension are a 400 'not a valid <ext> file'", async () => {
  await expect(saveMedia("d1", { name: "x.png", bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) }))
    .rejects.toMatchObject({ status: 400, message: "x.png is not a valid png file" });
  await expect(saveMedia("d1", { name: "x.mp3", bytes: bytes("abc") }))
    .rejects.toMatchObject({ status: 400, message: "x.mp3 is not a valid mp3 file" });
});

test("identical video bytes dedupe to one id", async () => {
  const a = await saveMedia("d1", { name: "a.mp4", bytes: fx("clip-h264.mp4") });
  expect((await saveMedia("d1", { name: "b.mp4", bytes: fx("clip-h264.mp4") })).id).toBe(a.id);
});

test("durationSec is stored when finite and positive, dropped otherwise", async () => {
  expect((await saveMedia("d1", { name: "a.mp4", bytes: fx("clip-h264.mp4"), durationSec: 2 })).durationSec).toBe(2);
  for (const d of [NaN, -1, 0, Infinity]) {
    await deleteDeckMedia("d1");
    expect("durationSec" in (await saveMedia("d1", { name: "a.mp4", bytes: fx("clip-h264.mp4"), durationSec: d }))).toBe(false);
  }
});

test("mediaKind maps by mime prefix", () => {
  expect(mediaKind("video/webm")).toBe("video");
  expect(mediaKind("audio/mpeg")).toBe("audio");
  expect(mediaKind("image/png")).toBe("image");
  expect(mediaKind("text/html")).toBeNull();
});

test("a dedupe re-upload backfills a missing durationSec but never overwrites an existing one", async () => {
  const a = await saveMedia("d1", { name: "a.mp4", bytes: fx("clip-h264.mp4") });
  expect(a.durationSec).toBeUndefined();
  const b = await saveMedia("d1", { name: "a.mp4", bytes: fx("clip-h264.mp4"), durationSec: 2 });
  expect(b.id).toBe(a.id);
  expect(b.durationSec).toBe(2);
  expect((await listMedia("d1"))[0].durationSec).toBe(2);
  expect((await saveMedia("d1", { name: "a.mp4", bytes: fx("clip-h264.mp4"), durationSec: 9 })).durationSec).toBe(2);
  expect((await saveMedia("d1", { name: "a.mp4", bytes: fx("clip-h264.mp4"), durationSec: NaN })).durationSec).toBe(2);
});
