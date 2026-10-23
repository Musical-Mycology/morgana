import { readMedia, deleteMedia, MediaError } from "@/lib/store/media-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; mediaId: string }> };

// info.name is the client-supplied filename: it must never reach a response header
// (no Content-Disposition). Content-Type comes from the sidecar mime, which the store
// derived from the extension. nosniff + a sandbox CSP keep a mislabelled upload from ever being
// sniffed/rendered as an active document on this origin.
export async function GET(_req: Request, { params }: Ctx) {
  const { id, mediaId } = await params;
  try {
    const { info, bytes } = await readMedia(id, mediaId);
    return new Response(bytes, {
      headers: { "Content-Type": info.mime, "Cache-Control": "private, max-age=31536000, immutable", "Content-Length": String(bytes.byteLength),
        "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" },
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
