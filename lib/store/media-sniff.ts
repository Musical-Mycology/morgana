/** Content checks for uploads (spec §1): the bytes must be what the extension claims, so no
 *  consumer (browser, ffmpeg) is ever handed a disguised playlist or text file. Pure. */
const ascii = (b: Uint8Array, at: number, s: string) => s.split("").every((c, i) => b[at + i] === c.charCodeAt(0));
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const VIDEO_ENTRIES = new Set(["avc1", "avc3", "vp09", "av01"]);
const AUDIO_ENTRIES = new Set(["mp4a", "Opus", "ac-3", "ec-3", "alac", "fLaC", ".mp3"]);
const BENIGN_ENTRIES = new Set(["tmcd", "mebx", "tx3g", "text", "wvtt", "c608"]);
const WEBM_CODECS = ["V_VP8", "V_VP9", "V_AV1"];
// Walk limits: hostile files must cost bounded CPU and memory.
const MAX_TOP_BOXES = 10_000;
const MAX_CHILD_BOXES = 1_000;
const MAX_STSD_ENTRIES = 64;

/** Thrown internally when a box walk exceeds its cap; surfaces as a plain "mismatch". */
class WalkLimit extends Error {}

interface Box { type: string; start: number; end: number; body: number }
/** Lazily yields the boxes in [from, to); throws WalkLimit past `cap` boxes. Stops at the first malformed box. */
function* boxes(b: Uint8Array, from: number, to: number, cap: number): Generator<Box> {
  let at = from;
  let n = 0;
  while (at + 8 <= to) {
    if (++n > cap) throw new WalkLimit();
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
const child = (b: Uint8Array, box: Box, type: string) => { for (const c of boxes(b, box.body, box.end, MAX_CHILD_BOXES)) if (c.type === type) return c; return undefined; };

type Mp4Verdict = SniffResult;
/** Fail-closed check of every track: any sample entry outside the allowlists is a codec rejection,
 *  whatever the track's handler claims (ffprobe sees the codec, not the handler). */
function sniffMp4(b: Uint8Array): Mp4Verdict {
  const bad: Mp4Verdict = { ok: false, reason: "mismatch" };
  let moov: Box | undefined;
  let first = true;
  for (const box of boxes(b, 0, b.length, MAX_TOP_BOXES)) {
    if (first && box.type !== "ftyp") return bad;
    first = false;
    if (box.type === "moov") { moov = box; break; }
  }
  if (!moov) return bad;
  let goodVideoTracks = 0;
  for (const trak of boxes(b, moov.body, moov.end, MAX_CHILD_BOXES)) {
    if (trak.type !== "trak") continue;
    const mdia = child(b, trak, "mdia");
    const hdlr = mdia && child(b, mdia, "hdlr");
    const minf = mdia && child(b, mdia, "minf");
    const stbl = minf && child(b, minf, "stbl");
    const stsd = stbl && child(b, stbl, "stsd");
    if (!mdia || !hdlr || !stsd || hdlr.body + 12 > hdlr.end || stsd.body + 8 > stsd.end) return bad;
    const isVideo = fourcc(b, hdlr.body + 8) === "vide";
    let entries = 0;
    for (const entry of boxes(b, stsd.body + 8, stsd.end, MAX_STSD_ENTRIES)) {
      entries++;
      const ok = VIDEO_ENTRIES.has(entry.type) || (!isVideo && (AUDIO_ENTRIES.has(entry.type) || BENIGN_ENTRIES.has(entry.type)));
      if (!ok) return { ok: false, reason: "codec", fourcc: entry.type };
    }
    if (isVideo && entries > 0) goodVideoTracks++;
  }
  return goodVideoTracks > 0 ? { ok: true } : bad;
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
    case "mp4": try { return sniffMp4(b); } catch (e) { if (e instanceof WalkLimit) return bad; throw e; }
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
