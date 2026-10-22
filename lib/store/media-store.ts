import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, unlink, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { DECK_ID_RE } from "@/engine/deck-doc";
import { dataDir } from "./deck-store";

/** Per-deck, content-addressed media (spec §2). Generic: audio today, images/video later. */
export const MEDIA_ID_RE = /^[0-9a-f]{16}\.[a-z0-9]{1,5}$/;
export const AUDIO_TYPES: Record<string, string> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac",
};

export interface MediaInfo { id: string; name: string; mime: string; bytes: number; uploadedAt: string }

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

export async function saveMedia(deckId: string, file: { name: string; bytes: Uint8Array }): Promise<MediaInfo> {
  const ext = extOf(file.name);
  if (!ext || !(ext in AUDIO_TYPES)) throw new MediaError(400, `unsupported file type: ${file.name}`);
  if (file.bytes.byteLength > mediaMaxBytes()) throw new MediaError(413, `file too large (max ${mediaMaxBytes()} bytes)`);
  const id = `${createHash("sha256").update(file.bytes).digest("hex").slice(0, 16)}.${ext}`;
  const path = mediaPath(deckId, id);
  await mkdir(deckMediaDir(deckId), { recursive: true });
  const existing = await readFile(`${path}.json`, "utf8").then((s) => JSON.parse(s) as MediaInfo, () => null);
  if (existing) return existing;
  const info: MediaInfo = { id, name: file.name, mime: AUDIO_TYPES[ext], bytes: file.bytes.byteLength, uploadedAt: new Date().toISOString() };
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

export async function readMedia(deckId: string, mediaId: string): Promise<{ info: MediaInfo; bytes: Uint8Array }> {
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
  await unlink(path).catch(() => {});
  await unlink(`${path}.json`).catch(() => {});
}

export async function deleteDeckMedia(deckId: string): Promise<void> {
  await rm(deckMediaDir(deckId), { recursive: true, force: true });
}
