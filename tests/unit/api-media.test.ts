// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
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
  expect(file.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(file.headers.get("Content-Security-Policy")).toBe("sandbox");
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

test("an oversized chunked body (no content-length) is a 413, cut off while reading", async () => {
  process.env.MORGANA_MEDIA_MAX_MB = "0.0001";
  let pulled = 0;
  const chunk = new Uint8Array(64 * 1024);
  const body = new ReadableStream<Uint8Array>({
    pull(c) { if (pulled >= 16) return c.close(); pulled++; c.enqueue(chunk); },
  });
  const req = new Request("http://t/api/decks/d1/media", {
    method: "POST", body, duplex: "half", headers: { "content-type": "multipart/form-data; boundary=x" },
  } as RequestInit & { duplex: "half" });
  expect(req.headers.get("content-length")).toBeNull();
  expect((await uploadPOST(req, deckCtx("d1"))).status).toBe(413);
  expect(pulled).toBeLessThan(16); // stopped reading early, did not buffer the whole stream
});

test("a lying/huge content-length is a 413 without parsing the body", async () => {
  process.env.MORGANA_MEDIA_MAX_MB = "1";
  const req = new Request("http://t/api/decks/d1/media", {
    method: "POST", body: "not multipart", headers: { "content-length": "999999999", "content-type": "text/plain" },
  });
  expect((await uploadPOST(req, deckCtx("d1"))).status).toBe(413);
});

test("a normal upload under the cap is still a 201", async () => {
  process.env.MORGANA_MEDIA_MAX_MB = "1";
  expect((await upload("d1", "ok.mp3", "abc")).status).toBe(201);
});

describe("a crafted media id never reaches a file outside media/<deck>/", () => {
  // A real file + valid sidecar one level above media/d1: only the store's guards stand between
  // `../secret` and a 200, so these fail if the guards are removed.
  beforeEach(() => {
    mkdirSync(join(dir, "media", "d1"), { recursive: true });
    writeFileSync(join(dir, "media", "secret"), "secret-bytes");
    writeFileSync(join(dir, "media", "secret.json"), JSON.stringify({ id: "secret", name: "s.mp3", mime: "audio/mpeg", bytes: 12, uploadedAt: "2026-01-01T00:00:00.000Z" }));
  });

  test.each(["../secret", "..%2Fsecret", "/etc/passwd"])("GET %s is a 404 and reads nothing", async (mediaId) => {
    const res = await fileGET(new Request("http://t"), fileCtx("d1", mediaId));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("secret-bytes");
  });

  test("DELETE ../secret is a 404 and removes nothing", async () => {
    const res = await fileDELETE(new Request("http://t", { method: "DELETE" }), fileCtx("d1", "../secret"));
    expect(res.status).toBe(404);
    expect(existsSync(join(dir, "media", "secret"))).toBe(true);
    expect(existsSync(join(dir, "media", "secret.json"))).toBe(true);
  });
});
