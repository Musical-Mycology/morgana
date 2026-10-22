// @vitest-environment node
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeck } from "@/lib/store/deck-store";
import { GET as listGET, POST as uploadPOST } from "@/app/api/decks/[id]/media/route";
import { GET as fileGET, DELETE as fileDELETE } from "@/app/api/decks/[id]/media/[mediaId]/route";

let dir: string;
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), "morgana-")); process.env.MORGANA_DATA_DIR = dir; await createDeck({ id: "d1", title: "D1" }); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MORGANA_DATA_DIR; delete process.env.MORGANA_MEDIA_MAX_MB; });

const deckCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const fileCtx = (id: string, mediaId: string) => ({ params: Promise.resolve({ id, mediaId }) });
const upload = (deck: string, name: string, body: string, type = "audio/mpeg") => {
  const fd = new FormData();
  fd.append("file", new File([body], name, { type }));
  return uploadPOST(new Request(`http://t/api/decks/${deck}/media`, { method: "POST", body: fd }), deckCtx(deck));
};

test("upload → list → fetch bytes → delete", async () => {
  const res = await upload("d1", "mix.mp3", "abc");
  expect(res.status).toBe(201);
  const info = await res.json();
  expect(info).toMatchObject({ name: "mix.mp3", mime: "audio/mpeg", bytes: 3 });
  expect((await (await listGET(new Request("http://t"), deckCtx("d1"))).json()).media.map((m: { id: string }) => m.id)).toEqual([info.id]);
  const file = await fileGET(new Request("http://t"), fileCtx("d1", info.id));
  expect(file.status).toBe(200);
  expect(file.headers.get("Content-Type")).toBe("audio/mpeg");
  expect(file.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
  expect(file.headers.get("Content-Disposition")).toBeNull();
  expect(await file.text()).toBe("abc");
  expect((await fileDELETE(new Request("http://t", { method: "DELETE" }), fileCtx("d1", info.id))).status).toBe(204);
  expect((await fileGET(new Request("http://t"), fileCtx("d1", info.id))).status).toBe(404);
});

test("served Content-Type comes from the extension, not the client", async () => {
  const info = await (await upload("d1", "a.wav", "x", "text/html")).json();
  expect((await fileGET(new Request("http://t"), fileCtx("d1", info.id))).headers.get("Content-Type")).toBe("audio/wav");
});

test("400 unsupported type, 400 missing file, 404 unknown deck, 413 too large", async () => {
  expect((await upload("d1", "evil.exe", "x")).status).toBe(400);
  expect((await uploadPOST(new Request("http://t", { method: "POST", body: new FormData() }), deckCtx("d1"))).status).toBe(400);
  expect((await upload("nope", "a.mp3", "x")).status).toBe(404);
  process.env.MORGANA_MEDIA_MAX_MB = "0.000001";
  expect((await upload("d1", "a.mp3", "too big")).status).toBe(413);
});

test.each(["..%2F..%2Fdecks%2Fd1.deck.json", "../../decks/d1.deck.json", "%2Fetc%2Fpasswd"])(
  "a crafted media id %s is a 404 and reads nothing", async (mediaId) => {
    mkdirSync(join(dir, "media", "d1"), { recursive: true });
    writeFileSync(join(dir, "secret.txt"), "secret");
    const res = await fileGET(new Request("http://t"), fileCtx("d1", decodeURIComponent(mediaId)));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("secret");
  });
