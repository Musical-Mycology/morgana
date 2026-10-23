/** Content checks for uploads (spec §1): the bytes must be what the extension claims, so no
 *  consumer (browser, ffmpeg) is ever handed a disguised playlist or document. Pure. */
const ascii = (b: Uint8Array, at: number, s: string) => s.split("").every((c, i) => b[at + i] === c.charCodeAt(0));
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const VIDEO_ENTRIES = new Set(["avc1", "avc3", "vp09", "av01"]);
const WEBM_CODECS = ["V_VP8", "V_VP9", "V_AV1"];

interface Box { type: string; start: number; end: number; body: number }
function* boxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  let at = from;
  while (at + 8 <= to) {
    let size = u32(b, at);
    const type = fourcc(b, at + 4);
    let body = at + 8;
    if (size === 1) { if (at + 16 > to) return; size = u32(b, at + 8) * 2 ** 32 + u32(b, at + 12); body = at + 16; }
    else if (size === 0) size = to - at;
    if (size < body - at || at + size > to) return;
    yield { type, start: at, end: at + size, body };
    at += size;
  }
}
const child = (b: Uint8Array, box: Box, type: string) => { for (const c of boxes(b, box.body, box.end)) if (c.type === type) return c; return undefined; };

/** Every `vide` track's sample-entry fourccs; null if this isn't a parseable ISO-BMFF file. */
function mp4VideoEntries(b: Uint8Array): string[] | null {
  const top = [...boxes(b, 0, b.length)];
  if (top[0]?.type !== "ftyp") return null;
  const moov = top.find((x) => x.type === "moov");
  if (!moov) return null;
  const out: string[] = [];
  for (const trak of boxes(b, moov.body, moov.end)) {
    if (trak.type !== "trak") continue;
    const mdia = child(b, trak, "mdia");
    const hdlr = mdia && child(b, mdia, "hdlr");
    if (!mdia || !hdlr || fourcc(b, hdlr.body + 8) !== "vide") continue;
    const stbl = (() => { const minf = child(b, mdia, "minf"); return minf && child(b, minf, "stbl"); })();
    const stsd = stbl && child(b, stbl, "stsd");
    if (!stsd) { out.push("????"); continue; }
    for (const entry of boxes(b, stsd.body + 8, stsd.end)) out.push(entry.type);
  }
  return out;
}

export type SniffResult = { ok: true } | { ok: false; reason: "mismatch" } | { ok: false; reason: "codec"; fourcc: string };

export function sniffMedia(ext: string, b: Uint8Array): SniffResult {
  const bad: SniffResult = { ok: false, reason: "mismatch" };
  const ok: SniffResult = { ok: true };
  switch (ext) {
    case "png": return ascii(b, 0, "\x89PNG\r\n\x1a\n") ? ok : bad;
    case "jpg": case "jpeg": return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? ok : bad;
    case "gif": return ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a") ? ok : bad;
    case "webp": return ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP") ? ok : bad;
    case "wav": return ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE") ? ok : bad;
    case "ogg": return ascii(b, 0, "OggS") ? ok : bad;
    case "flac": return ascii(b, 0, "fLaC") ? ok : bad;
    case "mp3": return ascii(b, 0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) ? ok : bad;
    case "aac": return b[0] === 0xff && (b[1] & 0xf6) === 0xf0 ? ok : bad;
    case "m4a": return b.length >= 8 && fourcc(b, 4) === "ftyp" ? ok : bad;
    case "mp4": {
      const entries = mp4VideoEntries(b);
      if (!entries || entries.length === 0) return bad;
      const unsupported = entries.find((e) => !VIDEO_ENTRIES.has(e));
      return unsupported ? { ok: false, reason: "codec", fourcc: unsupported } : ok;
    }
    case "webm": {
      if (!(b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)) return bad;
      const head = new TextDecoder("latin1").decode(b.subarray(0, Math.min(b.length, 1 << 20)));
      if (!head.includes("webm")) return bad;
      if (WEBM_CODECS.some((c) => head.includes(c))) return ok;
      const m = /V_[A-Z0-9/._-]+/.exec(head);
      return m ? { ok: false, reason: "codec", fourcc: m[0] } : bad;
    }
    default: return bad;
  }
}
