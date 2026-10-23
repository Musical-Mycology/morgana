// @vitest-environment node
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sniffMedia } from "@/lib/store/media-sniff";

const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, "../../e2e/fixtures/media", n)));
const h264 = fx("clip-h264.mp4");
const vp9 = fx("clip-vp9.webm");
const hevc = fx("clip-hevc.mp4");
const png = fx("still.png");
const raw = (...b: (number | string)[]) => Uint8Array.from(b.flatMap((x) => (typeof x === "number" ? [x] : [...x].map((c) => c.charCodeAt(0)))));
const playlist = new Uint8Array(Buffer.from("#EXTM3U\n#EXTINF:1,\nfile:///etc/hostname\n"));

test("real fixtures pass", () => {
  expect(sniffMedia("mp4", h264)).toEqual({ ok: true });
  expect(sniffMedia("webm", vp9)).toEqual({ ok: true });
  expect(sniffMedia("png", png)).toEqual({ ok: true });
});

test("HEVC mp4 is a codec rejection carrying the sample-entry fourcc", () => {
  expect(sniffMedia("mp4", hevc)).toEqual({ ok: false, reason: "codec", fourcc: "hvc1" });
});

test.each(["mp4", "webm", "png"])("a text playlist posing as %s is a mismatch", (ext) => {
  expect(sniffMedia(ext, playlist)).toEqual({ ok: false, reason: "mismatch" });
});

test("a png given JPEG bytes is a mismatch", () => {
  expect(sniffMedia("png", raw(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toEqual({ ok: false, reason: "mismatch" });
});

test.each([
  ["jpg", raw(0xff, 0xd8, 0xff, 0xe0, 0, 0x10)],
  ["jpeg", raw(0xff, 0xd8, 0xff, 0xe0, 0, 0x10)],
  ["gif", raw("GIF89a")],
  ["gif", raw("GIF87a")],
  ["webp", raw("RIFF", 0, 0, 0, 0, "WEBP")],
  ["mp3", raw("ID3", 4, 0)],
  ["mp3", raw(0xff, 0xfb, 0x90)],
  ["wav", raw("RIFF", 0, 0, 0, 0, "WAVE")],
  ["ogg", raw("OggS", 0)],
  ["flac", raw("fLaC", 0)],
  ["m4a", raw(0, 0, 0, 0x10, "ftyp", "M4A ", 0, 0, 0, 0)],
  ["aac", raw(0xff, 0xf1, 0x50)],
])("synthetic valid %s passes", (ext, bytes) => {
  expect(sniffMedia(ext, bytes)).toEqual({ ok: true });
});

test("a wav-named file with webp bytes is a mismatch; an unknown ext is a mismatch", () => {
  expect(sniffMedia("wav", raw("RIFF", 0, 0, 0, 0, "WEBP"))).toEqual({ ok: false, reason: "mismatch" });
  expect(sniffMedia("exe", raw("MZ"))).toEqual({ ok: false, reason: "mismatch" });
});

test("an MP4 with an ftyp box but no moov is a mismatch", () => {
  expect(sniffMedia("mp4", raw(0, 0, 0, 0x10, "ftyp", "isom", 0, 0, 0, 0))).toEqual({ ok: false, reason: "mismatch" });
});

test("a WebM header with only a non-allowed CodecID is a codec rejection", () => {
  const b = raw(0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, "webm", 0, "V_MPEG4/ISO/AVC", 0);
  expect(sniffMedia("webm", b)).toEqual({ ok: false, reason: "codec", fourcc: "V_MPEG4/ISO/AVC" });
});

test("a WebM header with no video CodecID at all is a mismatch", () => {
  expect(sniffMedia("webm", raw(0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, "webm", 0))).toEqual({ ok: false, reason: "mismatch" });
});

test("empty input is a mismatch for every extension and never throws", () => {
  for (const ext of ["mp4", "webm", "png", "jpg", "gif", "webp", "mp3", "wav", "ogg", "flac", "aac", "m4a"]) {
    expect(sniffMedia(ext, new Uint8Array(0))).toEqual({ ok: false, reason: "mismatch" });
  }
});

// ---- hand-built ISO-BMFF ----
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type: string, ...body: (number[] | Uint8Array)[]): number[] => {
  const payload = body.flatMap((x) => [...x]);
  return [...u32be(8 + payload.length), ...[...type].map((c) => c.charCodeAt(0)), ...payload];
};
const ftyp = () => box("ftyp", [...raw("isom"), 0, 0, 0, 0]);
const trak = (handler: string, entry: string) =>
  box("trak", box("mdia",
    box("hdlr", [0, 0, 0, 0, 0, 0, 0, 0], [...raw(handler)], new Array(12).fill(0)),
    box("minf", box("stbl", box("stsd", [0, 0, 0, 0], u32be(1), box(entry, new Array(8).fill(0)))))));
const mp4 = (...traks: number[][]) => Uint8Array.from([...ftyp(), ...box("moov", ...traks)]);

test("hand-built avc1 vide track passes", () => {
  expect(sniffMedia("mp4", mp4(trak("vide", "avc1")))).toEqual({ ok: true });
});

test("an hvc1 track hidden under a non-vide handler is still rejected (fail-closed)", () => {
  for (const handler of ["meta", "subt", "soun", "text"]) {
    expect(sniffMedia("mp4", mp4(trak("vide", "avc1"), trak(handler, "hvc1")))).toEqual({ ok: false, reason: "codec", fourcc: "hvc1" });
  }
});

test("avc1 plus an mp4a soun track passes; avc1 plus a tmcd track passes", () => {
  expect(sniffMedia("mp4", mp4(trak("vide", "avc1"), trak("soun", "mp4a")))).toEqual({ ok: true });
  expect(sniffMedia("mp4", mp4(trak("vide", "avc1"), trak("tmcd", "tmcd")))).toEqual({ ok: true });
});

test("an audio entry under a vide handler, or an unknown entry anywhere, is a codec rejection", () => {
  expect(sniffMedia("mp4", mp4(trak("vide", "mp4a")))).toEqual({ ok: false, reason: "codec", fourcc: "mp4a" });
  expect(sniffMedia("mp4", mp4(trak("vide", "avc1"), trak("soun", "zzzz")))).toEqual({ ok: false, reason: "codec", fourcc: "zzzz" });
});

test("audio-only mp4 (no vide track) is a mismatch", () => {
  expect(sniffMedia("mp4", mp4(trak("soun", "mp4a")))).toEqual({ ok: false, reason: "mismatch" });
});

// ---- hostile input ----
const MISMATCH = { ok: false, reason: "mismatch" };
test("a zero-size box is a mismatch, not a hang", () => {
  expect(sniffMedia("mp4", Uint8Array.from([...ftyp(), ...u32be(0), ...raw("free"), 1, 2, 3]))).toEqual(MISMATCH);
  expect(sniffMedia("mp4", Uint8Array.from([...ftyp(), ...box("moov", [...u32be(0), ...raw("trak")])]))).toEqual(MISMATCH);
});

test("a 64-bit largesize box running past the buffer is a mismatch", () => {
  const big = [...u32be(1), ...raw("moov"), ...u32be(0xffff), ...u32be(0xffffffff)];
  expect(sniffMedia("mp4", Uint8Array.from([...ftyp(), ...big]))).toEqual(MISMATCH);
});

test("a child box larger than its parent is a mismatch", () => {
  const liar = box("moov", [...u32be(0x1000), ...raw("trak"), 0, 0, 0, 0]);
  expect(sniffMedia("mp4", Uint8Array.from([...ftyp(), ...liar]))).toEqual(MISMATCH);
});

test("a truncated moov is a mismatch", () => {
  const whole = mp4(trak("vide", "avc1"));
  for (const cut of [whole.length - 1, whole.length - 20, whole.length - 60]) {
    expect(sniffMedia("mp4", whole.subarray(0, cut))).toEqual(MISMATCH);
  }
});

test("a 50 MB file of ftyp + tiny free boxes with no moov is a fast mismatch", () => {
  const n = 50 * 1024 * 1024;
  const big = new Uint8Array(n);
  big.set(ftyp(), 0);
  const free = [...u32be(8), ...raw("free")];
  for (let at = ftyp().length; at + 8 <= n; at += 8) big.set(free, at);
  const t0 = performance.now();
  const r = sniffMedia("mp4", big);
  expect(performance.now() - t0).toBeLessThan(500);
  expect(r).toEqual(MISMATCH);
});

test("more than 64 stsd entries is a mismatch", () => {
  const entries = Array.from({ length: 65 }, () => box("avc1", new Array(8).fill(0))).flat();
  const t = box("trak", box("mdia",
    box("hdlr", [0, 0, 0, 0, 0, 0, 0, 0], [...raw("vide")], new Array(12).fill(0)),
    box("minf", box("stbl", box("stsd", [0, 0, 0, 0], u32be(65), entries)))));
  expect(sniffMedia("mp4", mp4(t))).toEqual(MISMATCH);
});
