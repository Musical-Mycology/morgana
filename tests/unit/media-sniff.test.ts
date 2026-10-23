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

test("garbage / truncated input never throws", () => {
  for (const ext of ["mp4", "webm", "png", "mp3", "m4a"]) {
    expect(sniffMedia(ext, new Uint8Array(0)).ok).toBe(false);
    expect(sniffMedia(ext, raw(0, 0, 0, 1, "ftyp", 0xff, 0xff))).toBeDefined();
  }
});
