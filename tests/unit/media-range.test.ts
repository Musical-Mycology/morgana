// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeck } from "@/lib/store/deck-store";
import { parseRange, statMedia, MediaError } from "@/lib/store/media-store";
import { POST as uploadPOST } from "@/app/api/decks/[id]/media/route";
import { GET as fileGET } from "@/app/api/decks/[id]/media/[mediaId]/route";

describe("parseRange (size 1000)", () => {
  const p = (h: string | null) => parseRange(h, 1000);
  test("no header or non-bytes unit or multi-range -> null (full body)", () => {
    expect(p(null)).toBeNull();
    expect(p("items=0-1")).toBeNull();
    expect(p("bytes=0-1,5-6")).toBeNull();
    expect(p("bytes=abc")).toBeNull();
  });
  test("closed, open-ended, suffix and clamped ranges", () => {
    expect(p("bytes=0-99")).toEqual({ start: 0, end: 99 });
    expect(p("bytes=900-")).toEqual({ start: 900, end: 999 });
    expect(p("bytes=-100")).toEqual({ start: 900, end: 999 });
    expect(p("bytes=990-2000")).toEqual({ start: 990, end: 999 });
    expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });
  test("unsatisfiable", () => {
    expect(p("bytes=1000-")).toBe("unsatisfiable");
    expect(p("bytes=5-2")).toBe("unsatisfiable");
    expect(p("bytes=-0")).toBe("unsatisfiable");
    expect(parseRange("bytes=0-", 0)).toBe("unsatisfiable");
  });
});

let dir: string;
let mediaId: string;
const bytes = new Uint8Array(200).map((_, i) => (i * 7 + 3) % 251);
const fileCtx = (id: string, m: string) => ({ params: Promise.resolve({ id, mediaId: m }) });
const get = (range?: string) => fileGET(new Request("http://t", range ? { headers: { Range: range } } : undefined), fileCtx("d1", mediaId));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "morgana-"));
  process.env.MORGANA_DATA_DIR = dir;
  await createDeck({ id: "d1", title: "D1" });
  const body = new Uint8Array(200); body.set(new TextEncoder().encode("ID3")); body.set(bytes.subarray(3), 3);
  bytes.set(body);
  const fd = new FormData();
  fd.append("file", new File([body], "mix.mp3", { type: "audio/mpeg" }));
  const res = await uploadPOST(new Request("http://t", { method: "POST", body: fd }), { params: Promise.resolve({ id: "d1" }) });
  mediaId = (await res.json()).id;
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.MORGANA_DATA_DIR; });

describe("statMedia", () => {
  test("returns info, path and size; 404 when absent", async () => {
    const s = await statMedia("d1", mediaId);
    expect(s.size).toBe(200);
    expect(s.info.id).toBe(mediaId);
    expect(s.path.endsWith(mediaId)).toBe(true);
    await expect(statMedia("d1", "0123456789abcdef.mp3")).rejects.toBeInstanceOf(MediaError);
    await expect(statMedia("d1", "../x")).rejects.toMatchObject({ status: 404 });
  });
});

describe("media GET ranges", () => {
  const secure = (r: Response) => {
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Content-Security-Policy")).toBe("sandbox");
  };
  test("no Range: 200, Accept-Ranges, full body", async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("Accept-Ranges")).toBe("bytes");
    expect(r.headers.get("Content-Length")).toBe("200");
    expect(r.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    secure(r);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes);
  });
  test("Range bytes=10-19: 206 with the slice", async () => {
    const r = await get("bytes=10-19");
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe("bytes 10-19/200");
    expect(r.headers.get("Content-Length")).toBe("10");
    expect(r.headers.get("Accept-Ranges")).toBe("bytes");
    expect(r.headers.get("Content-Type")).toBe("audio/mpeg");
    secure(r);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes.slice(10, 20));
  });
  test("open-ended and suffix ranges", async () => {
    const a = await get("bytes=190-");
    expect(a.headers.get("Content-Range")).toBe("bytes 190-199/200");
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(bytes.slice(190));
    const b = await get("bytes=-5");
    expect(b.status).toBe(206);
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(bytes.slice(195));
  });
  test("unsatisfiable: 416 with Content-Range bytes */size", async () => {
    const r = await get("bytes=999999-");
    expect(r.status).toBe(416);
    expect(r.headers.get("Content-Range")).toBe("bytes */200");
    secure(r);
  });
  test("multi-range falls back to the full body", async () => {
    const r = await get("bytes=0-1,5-6");
    expect(r.status).toBe(200);
    expect((await r.arrayBuffer()).byteLength).toBe(200);
  });
  test("unknown media is still 404", async () => {
    expect((await fileGET(new Request("http://t"), fileCtx("d1", "0123456789abcdef.mp3"))).status).toBe(404);
  });
});
