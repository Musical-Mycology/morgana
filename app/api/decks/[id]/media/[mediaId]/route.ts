import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { statMedia, parseRange, deleteMedia, MediaError } from "@/lib/store/media-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; mediaId: string }> };

// info.name is the client-supplied filename: it must never reach a response header
// (no Content-Disposition). Content-Type comes from the sidecar mime, which the store
// derived from the extension. nosniff + a sandbox CSP keep a mislabelled upload from ever being
// sniffed/rendered as an active document on this origin.
export async function GET(req: Request, { params }: Ctx) {
  const { id, mediaId } = await params;
  try {
    const { info, path, size } = await statMedia(id, mediaId);
    const base = { "Content-Type": info.mime, "Cache-Control": "private, max-age=31536000, immutable", "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" };
    const r = parseRange(req.headers.get("range"), size);
    if (r === "unsatisfiable") return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
    const [start, end] = r ? [r.start, r.end] : [0, size - 1];
    // Stream the slice from disk — never buffer the whole file. (Zero-byte files: empty body.)
    const body = size === 0 ? null : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>);
    return new Response(body, {
      status: r ? 206 : 200,
      headers: { ...base, "Content-Length": String(size === 0 ? 0 : end - start + 1), ...(r ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}) },
    });
  } catch (e) {
    return Response.json({ error: e instanceof MediaError ? e.message : "not found" }, { status: 404 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, mediaId } = await params;
  try { await deleteMedia(id, mediaId); return new Response(null, { status: 204 }); }
  catch (e) { return Response.json({ error: e instanceof MediaError ? e.message : "not found" }, { status: 404 }); }
}
