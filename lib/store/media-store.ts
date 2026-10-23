import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, unlink, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { DECK_ID_RE } from "@/engine/deck-doc";
import { dataDir } from "./deck-store";
import { sniffMedia } from "./media-sniff";

/** Per-deck, content-addressed media (spec §2). Generic: audio, images, video. */
export const MEDIA_ID_RE = /^[0-9a-f]{16}\.[a-z0-9]{1,5}$/;
export const AUDIO_TYPES: Record<string, string> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac",
};

export const IMAGE_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};
export const VIDEO_TYPES: Record<string, string> = { mp4: "video/mp4", webm: "video/webm" };
const ALL_TYPES: Record<string, string> = { ...AUDIO_TYPES, ...IMAGE_TYPES, ...VIDEO_TYPES };

export type MediaKind = "audio" | "image" | "video";
export function mediaKind(mime: string): MediaKind | null {
  const k = mime.split("/")[0];
  return k === "audio" || k === "image" || k === "video" ? k : null;
}

export interface MediaInfo { id: string; name: string; mime: string; bytes: number; uploadedAt: string; durationSec?: number }

export class MediaError extends Error {
  constructor(readonly status: 400 | 404 | 413, message: string) { super(message); }
}

export function mediaMaxBytes(): number {
  const mb = Number(process.env.MORGANA_MEDIA_MAX_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 200) * 1024 * 1024;
}

function deckMediaDir(deckId: string): string {
  if (typeof deckId !== "string" || !DECK_ID_RE.test(deckId)) throw new MediaError(404, `unknown deck: ${deckId}`);
  return join(dataDir(), "media", deckId);
}

/** The on-disk path for a media id, or a 404 — never a path outside the deck's media folder. */
function mediaPath(deckId: string, mediaId: string): string {
  if (typeof mediaId !== "string" || !MEDIA_ID_RE.test(mediaId)) throw new MediaError(404, "unknown media");
  const dir = resolve(deckMediaDir(deckId));
  const p = resolve(dir, mediaId);
  if (!p.startsWith(dir + sep)) throw new MediaError(404, "unknown media");
  return p;
}

function extOf(name: string): string | null {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  return m && m.index > 0 ? m[1].toLowerCase() : null;
}

export async function saveMedia(deckId: string, file: { name: string; bytes: Uint8Array; durationSec?: number }): Promise<MediaInfo> {
  const ext = extOf(file.name);
  if (!ext || !(ext in ALL_TYPES)) throw new MediaError(400, `unsupported file type: ${file.name}`);
  if (file.bytes.byteLength > mediaMaxBytes()) throw new MediaError(413, `file too large (max ${mediaMaxBytes()} bytes)`);
  // Content check before hashing and before the dedupe early-return: the bytes must be what the extension claims.
  const sniffed = sniffMedia(ext, file.bytes);
  if (!sniffed.ok) {
    if (sniffed.reason === "codec") {
      throw new MediaError(400, `unsupported video codec (${sniffed.fourcc}) — convert with: ffmpeg -i "${file.name}" -c:v libx264 -crf 18 -pix_fmt yuv420p -an out.mp4`);
    }
    throw new MediaError(400, `${file.name} is not a valid ${ext} file`);
  }
  const id = `${createHash("sha256").update(file.bytes).digest("hex").slice(0, 16)}.${ext}`;
  const path = mediaPath(deckId, id);
  await mkdir(deckMediaDir(deckId), { recursive: true });
  const existing = await readFile(`${path}.json`, "utf8").then((s) => JSON.parse(s) as MediaInfo, () => null);
  // Client-supplied: kept only if sane, and used for lint/display only.
  const d = file.durationSec;
  const duration = typeof d === "number" && Number.isFinite(d) && d > 0 ? d : undefined;
  if (existing) {
    // Dedupe: bytes are already stored. Backfill a duration the first upload lacked.
    if (existing.durationSec === undefined && duration !== undefined) {
      existing.durationSec = duration;
      await writeFile(`${path}.json`, JSON.stringify(existing), "utf8");
    }
    return existing;
  }
  const info: MediaInfo = { id, name: file.name, mime: ALL_TYPES[ext], bytes: file.bytes.byteLength, uploadedAt: new Date().toISOString() };
  if (duration !== undefined) info.durationSec = duration;
  await writeFile(path, file.bytes);
  await writeFile(`${path}.json`, JSON.stringify(info), "utf8");
  return info;
}

export async function listMedia(deckId: string): Promise<MediaInfo[]> {
  const dir = deckMediaDir(deckId);
  const files = await readdir(dir).catch(() => [] as string[]);
  const out: MediaInfo[] = [];
  for (const f of files.filter((n) => n.endsWith(".json"))) {
    try { out.push(JSON.parse(await readFile(join(dir, f), "utf8")) as MediaInfo); } catch { /* skip corrupt sidecar */ }
  }
  return out.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt) || a.id.localeCompare(b.id));
}

export async function readMedia(deckId: string, mediaId: string): Promise<{ info: MediaInfo; bytes: Uint8Array<ArrayBuffer> }> {
  const path = mediaPath(deckId, mediaId);
  try {
    const info = JSON.parse(await readFile(`${path}.json`, "utf8")) as MediaInfo;
    return { info, bytes: new Uint8Array(await readFile(path)) };
  } catch {
    throw new MediaError(404, "unknown media");
  }
}

export async function deleteMedia(deckId: string, mediaId: string): Promise<void> {
  const path = mediaPath(deckId, mediaId);
  // Sidecar first: if we stop halfway, an orphan blob is harmless (a re-upload rewrites it), whereas
  // an orphan sidecar would make saveMedia think the file exists and skip writing the bytes.
  await unlink(`${path}.json`).catch(() => {});
  await unlink(path).catch(() => {});
}

export async function deleteDeckMedia(deckId: string): Promise<void> {
  const root = resolve(dataDir(), "media");
  const dir = resolve(deckMediaDir(deckId));
  if (!dir.startsWith(root + sep)) throw new MediaError(404, `unknown deck: ${deckId}`);
  await rm(dir, { recursive: true, force: true });
}
