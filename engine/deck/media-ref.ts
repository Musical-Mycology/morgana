/** `media:<mediaId>` — a reference to this deck's uploaded media, usable wherever an art panel key
 *  or a media tile src goes (spec §2). Pure. */
export const MEDIA_REF_PREFIX = "media:";
/** A stored media id: 16 hex digits + a lowercase extension. The same pattern as
 *  lib/store/media-store.ts MEDIA_ID_RE, kept here so browser code never imports the fs store. */
export const MEDIA_ID_PATTERN = /^[0-9a-f]{16}\.[a-z0-9]{1,5}$/;
export type MediaRef = `media:${string}`;
export function isMediaRef(s: unknown): s is MediaRef { return typeof s === "string" && s.startsWith(MEDIA_REF_PREFIX) && s.length > MEDIA_REF_PREFIX.length; }
export function mediaRefId(ref: MediaRef): string { return ref.slice(MEDIA_REF_PREFIX.length); }
export function toMediaRef(id: string): MediaRef { return `${MEDIA_REF_PREFIX}${id}` as MediaRef; }
export function isVideoRef(s: unknown): s is MediaRef { return isMediaRef(s) && /\.(mp4|webm)$/i.test(s); }

export type MediaKind = "audio" | "image" | "video";
/** Coarse kind from a mime type (`null` for anything else). */
export function mediaKind(mime: string): MediaKind | null {
  const k = mime.split("/")[0];
  return k === "audio" || k === "image" || k === "video" ? k : null;
}
